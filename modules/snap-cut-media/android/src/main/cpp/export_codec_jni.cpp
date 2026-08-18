#include <jni.h>

#include <lame.h>
#include <samplerate.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstdio>
#include <limits>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

#include <unistd.h>

namespace {

constexpr jint kStatusOk = 0;
constexpr jint kStatusAlreadyClosed = 1;
constexpr jint kStatusError = -1;
constexpr jint kMaxChunkFrames = 8192;
constexpr jint kMaxChannels = 2;
constexpr jint kMinInputSampleRate = 8000;
constexpr jint kMaxInputSampleRate = 384000;
constexpr jint kMaxOutputSampleRate = 48000;
constexpr jsize kMaxUtf16StringUnits = 4096;
constexpr long kResamplerInputGuardFrames = 4096;
constexpr long kResamplerOutputGuardFrames = 4096;
constexpr long kMinResamplerOutputFrames = 4096;
constexpr long kMaxResampleRatioNumerator = kMaxOutputSampleRate;
constexpr long kMaxResampleRatioDenominator = kMinInputSampleRate;
constexpr long kMaxResampledFrames =
    ((static_cast<long>(kMaxChunkFrames) + kResamplerInputGuardFrames) *
         kMaxResampleRatioNumerator +
     kMaxResampleRatioDenominator - 1) /
        kMaxResampleRatioDenominator +
    kResamplerOutputGuardFrames;

static_assert(kMaxResampledFrames == 77824,
              "Resampler capacity must cover 8192 frames at the legal 8kHz-to-48kHz ratio");

constexpr int StandardUtf8Width(uint32_t code_point) {
  if (code_point == 0 || code_point > 0x10FFFF ||
      (code_point >= 0xD800 && code_point <= 0xDFFF)) {
    return 0;
  }
  if (code_point <= 0x7F) return 1;
  if (code_point <= 0x7FF) return 2;
  if (code_point <= 0xFFFF) return 3;
  return 4;
}

static_assert(StandardUtf8Width('S') == 1, "ASCII must remain one-byte UTF-8");
static_assert(StandardUtf8Width(0x2702) == 3, "BMP symbols must use standard UTF-8");
static_assert(StandardUtf8Width(0x1F49C) == 4, "non-BMP emoji must use four-byte UTF-8");
static_assert(StandardUtf8Width(0) == 0, "embedded NUL must be rejected");
static_assert(StandardUtf8Width(0xD83D) == 0, "isolated surrogates must be rejected");
static_assert(StandardUtf8Width(0x110000) == 0, "out-of-range code points must be rejected");

bool IsSupportedOutputRate(jint sample_rate) {
  return sample_rate == 32000 || sample_rate == 44100 || sample_rate == 48000;
}

long RequiredResamplerOutputFrames(
    jint input_frames,
    jint input_rate,
    jint output_rate) {
  if (input_frames < 0 || input_frames > kMaxChunkFrames ||
      input_rate < kMinInputSampleRate || input_rate > kMaxInputSampleRate ||
      !IsSupportedOutputRate(output_rate)) {
    return -1;
  }
  const int64_t guarded_input =
      static_cast<int64_t>(input_frames) + kResamplerInputGuardFrames;
  const int64_t numerator = guarded_input * output_rate;
  const int64_t scaled_frames =
      (numerator + static_cast<int64_t>(input_rate) - 1) / input_rate;
  const int64_t required_frames = std::max<int64_t>(
      kMinResamplerOutputFrames,
      scaled_frames + kResamplerOutputGuardFrames);
  return required_frames <= kMaxResampledFrames
      ? static_cast<long>(required_frames)
      : -1;
}

std::atomic<jlong> g_next_resampler_handle{1};
std::atomic<jlong> g_next_encoder_handle{1};
std::mutex g_resampler_registry_mutex;
std::mutex g_encoder_registry_mutex;

struct SrcStateDeleter {
  void operator()(SRC_STATE* state) const {
    if (state != nullptr) {
      src_delete(state);
    }
  }
};

struct ResamplerState {
  explicit ResamplerState(
      SRC_STATE* raw_state,
      int channel_count,
      int input_rate_value,
      int output_rate_value)
      : state(raw_state),
        channels(channel_count),
        input_rate(input_rate_value),
        output_rate(output_rate_value),
        ratio(static_cast<double>(output_rate_value) / input_rate_value) {}

  std::unique_ptr<SRC_STATE, SrcStateDeleter> state;
  int channels;
  int input_rate;
  int output_rate;
  double ratio;
  std::mutex mutex;
};

std::unordered_map<jlong, std::shared_ptr<ResamplerState>> g_resamplers;

float sanitize_sample(float sample) {
  if (!std::isfinite(sample)) {
    return 0.0F;
  }
  return std::clamp(sample, -1.0F, 1.0F);
}

class EncoderState {
 public:
  virtual ~EncoderState() = default;

  virtual int Channels() const = 0;

  jint Write(const std::vector<float>& pcm, int frame_count) {
    std::lock_guard<std::mutex> guard(mutex_);
    if (finished_) {
      return kStatusError;
    }
    return WriteLocked(pcm, frame_count) ? kStatusOk : kStatusError;
  }

  jint Finish() {
    std::lock_guard<std::mutex> guard(mutex_);
    if (finished_) {
      return kStatusOk;
    }
    if (!FinishLocked()) {
      return kStatusError;
    }
    finished_ = true;
    return kStatusOk;
  }

 protected:
  virtual bool WriteLocked(const std::vector<float>& pcm, int frame_count) = 0;
  virtual bool FinishLocked() = 0;

  std::mutex mutex_;
  bool finished_ = false;
};

class Mp3EncoderState final : public EncoderState {
 public:
  static std::shared_ptr<Mp3EncoderState> Create(
      const char* path,
      int sample_rate,
      int channels,
      const char* title) {
    std::shared_ptr<Mp3EncoderState> state(new Mp3EncoderState());
    state->lame_ = lame_init();
    state->file_ = std::fopen(path, "wb+");
    if (state->lame_ == nullptr || state->file_ == nullptr) {
      return nullptr;
    }

    id3tag_init(state->lame_);
    id3tag_v2_4_UTF8_only(state->lame_);
    if (id3tag_set_textinfo_utf8(state->lame_, "TIT2", title) != 0 ||
        id3tag_set_comment_utf8(
            state->lame_, "eng", "", "Exported by SnapCut") != 0) {
      return nullptr;
    }
    const bool configured =
        lame_set_in_samplerate(state->lame_, sample_rate) == 0 &&
        lame_set_out_samplerate(state->lame_, sample_rate) == 0 &&
        lame_set_num_channels(state->lame_, channels) == 0 &&
        lame_set_mode(state->lame_, channels == 1 ? MONO : JOINT_STEREO) == 0 &&
        lame_set_VBR(state->lame_, vbr_off) == 0 &&
        lame_set_brate(state->lame_, 320) == 0 &&
        lame_set_quality(state->lame_, 0) == 0 &&
        lame_set_bWriteVbrTag(state->lame_, 1) == 0 &&
        lame_init_params(state->lame_) == 0;
    if (!configured) {
      return nullptr;
    }
    state->channels_ = channels;
    return state;
  }

  int Channels() const override { return channels_; }

  ~Mp3EncoderState() override {
    if (file_ != nullptr) {
      std::fclose(file_);
    }
    if (lame_ != nullptr) {
      lame_close(lame_);
    }
  }

 protected:
  bool WriteLocked(const std::vector<float>& pcm, int frame_count) override {
    if (lame_ == nullptr || file_ == nullptr) {
      return false;
    }
    std::vector<float> sanitized(pcm.size());
    std::transform(pcm.begin(), pcm.end(), sanitized.begin(), sanitize_sample);
    const int output_capacity = frame_count * 5 / 4 + 7200;
    std::vector<unsigned char> encoded(static_cast<size_t>(output_capacity));
    const int encoded_bytes = channels_ == 1
        ? lame_encode_buffer_ieee_float(
              lame_, sanitized.data(), sanitized.data(), frame_count,
              encoded.data(), output_capacity)
        : lame_encode_buffer_interleaved_ieee_float(
              lame_, sanitized.data(), frame_count, encoded.data(), output_capacity);
    return encoded_bytes >= 0 && WriteBytes(encoded.data(), encoded_bytes);
  }

  bool FinishLocked() override {
    if (lame_ == nullptr || file_ == nullptr) {
      return false;
    }
    std::vector<unsigned char> encoded(7200);
    const int encoded_bytes = lame_encode_flush(
        lame_, encoded.data(), static_cast<int>(encoded.size()));
    if (encoded_bytes < 0 || !WriteBytes(encoded.data(), encoded_bytes) ||
        std::fflush(file_) != 0) {
      return false;
    }
    lame_mp3_tags_fid(lame_, file_);
    return std::fflush(file_) == 0 && ::fsync(::fileno(file_)) == 0;
  }

 private:
  bool WriteBytes(const unsigned char* data, int size) {
    if (size == 0) {
      return true;
    }
    return std::fwrite(data, 1, static_cast<size_t>(size), file_) ==
        static_cast<size_t>(size);
  }

  lame_t lame_ = nullptr;
  FILE* file_ = nullptr;
  int channels_ = 0;
};

std::unordered_map<jlong, std::shared_ptr<EncoderState>> g_encoders;

template <typename T>
std::shared_ptr<T> Lookup(
    const std::unordered_map<jlong, std::shared_ptr<T>>& registry,
    std::mutex& mutex,
    jlong handle) {
  std::lock_guard<std::mutex> guard(mutex);
  const auto found = registry.find(handle);
  return found == registry.end() ? nullptr : found->second;
}

template <typename T>
jint RemoveAndCancel(
    std::unordered_map<jlong, std::shared_ptr<T>>* registry,
    std::mutex* registry_mutex,
    jlong handle) {
  std::shared_ptr<T> removed;
  {
    std::lock_guard<std::mutex> guard(*registry_mutex);
    const auto found = registry->find(handle);
    if (found == registry->end()) {
      return kStatusAlreadyClosed;
    }
    removed = std::move(found->second);
    registry->erase(found);
  }
  // Destruction may finish/close files or codec state and must never hold the
  // registry lock, otherwise an active write could block all other handles.
  removed.reset();
  return kStatusOk;
}

bool AppendStandardUtf8(uint32_t code_point, std::string* output) {
  const int width = StandardUtf8Width(code_point);
  if (output == nullptr || width == 0) {
    return false;
  }
  if (width == 1) {
    output->push_back(static_cast<char>(code_point));
  } else if (width == 2) {
    output->push_back(static_cast<char>(0xC0 | (code_point >> 6)));
    output->push_back(static_cast<char>(0x80 | (code_point & 0x3F)));
  } else if (width == 3) {
    output->push_back(static_cast<char>(0xE0 | (code_point >> 12)));
    output->push_back(static_cast<char>(0x80 | ((code_point >> 6) & 0x3F)));
    output->push_back(static_cast<char>(0x80 | (code_point & 0x3F)));
  } else {
    output->push_back(static_cast<char>(0xF0 | (code_point >> 18)));
    output->push_back(static_cast<char>(0x80 | ((code_point >> 12) & 0x3F)));
    output->push_back(static_cast<char>(0x80 | ((code_point >> 6) & 0x3F)));
    output->push_back(static_cast<char>(0x80 | (code_point & 0x3F)));
  }
  return true;
}

bool ReadUtf8(JNIEnv* env, jstring value, std::string* output) {
  if (value == nullptr || output == nullptr) {
    return false;
  }
  const jsize length = env->GetStringLength(value);
  if (length <= 0 || length > kMaxUtf16StringUnits || env->ExceptionCheck()) {
    return false;
  }
  const jchar* chars = env->GetStringChars(value, nullptr);
  if (chars == nullptr) {
    return false;
  }

  output->clear();
  output->reserve(static_cast<size_t>(length) * 3U);
  bool valid = true;
  for (jsize index = 0; index < length && valid; ++index) {
    uint32_t code_point = chars[index];
    if (code_point >= 0xD800 && code_point <= 0xDBFF) {
      if (index + 1 >= length) {
        valid = false;
        break;
      }
      const uint32_t low = chars[++index];
      if (low < 0xDC00 || low > 0xDFFF) {
        valid = false;
        break;
      }
      code_point = 0x10000 + ((code_point - 0xD800) << 10) + (low - 0xDC00);
    } else if (code_point >= 0xDC00 && code_point <= 0xDFFF) {
      valid = false;
      break;
    }
    valid = AppendStandardUtf8(code_point, output);
  }
  env->ReleaseStringChars(value, chars);
  if (env->ExceptionCheck()) {
    valid = false;
  }
  if (!valid) {
    output->clear();
  }
  return valid && !output->empty();
}

bool ReadPcm(
    JNIEnv* env,
    jfloatArray pcm,
    jint frame_count,
    int channels,
    std::vector<float>* output) {
  if (pcm == nullptr || output == nullptr || frame_count < 0 ||
      frame_count > kMaxChunkFrames || channels < 1 || channels > kMaxChannels) {
    return false;
  }
  const jlong sample_count = static_cast<jlong>(frame_count) * channels;
  if (sample_count != env->GetArrayLength(pcm)) {
    return false;
  }
  output->resize(static_cast<size_t>(sample_count));
  if (sample_count > 0) {
    env->GetFloatArrayRegion(pcm, 0, static_cast<jsize>(sample_count), output->data());
  }
  return !env->ExceptionCheck();
}

}  // namespace

extern "C" JNIEXPORT jlong JNICALL
Java_expo_modules_snapcutmedia_export_NativeExportCodecBridge_nativeCreateResampler(
    JNIEnv*, jobject, jint input_rate, jint output_rate, jint channels) {
  if (input_rate < kMinInputSampleRate || input_rate > kMaxInputSampleRate ||
      !IsSupportedOutputRate(output_rate) || channels < 1 || channels > kMaxChannels) {
    return 0;
  }
  int error = 0;
  SRC_STATE* state = src_new(SRC_SINC_BEST_QUALITY, channels, &error);
  if (state == nullptr || error != 0) {
    if (state != nullptr) {
      src_delete(state);
    }
    return 0;
  }
  const jlong handle = g_next_resampler_handle.fetch_add(1);
  auto owned = std::make_shared<ResamplerState>(
      state, channels, input_rate, output_rate);
  std::lock_guard<std::mutex> guard(g_resampler_registry_mutex);
  g_resamplers.emplace(handle, std::move(owned));
  return handle;
}

extern "C" JNIEXPORT jint JNICALL
Java_expo_modules_snapcutmedia_export_NativeExportCodecBridge_nativeResamplerMaxOutputFrames(
    JNIEnv*, jobject) {
  return static_cast<jint>(kMaxResampledFrames);
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_expo_modules_snapcutmedia_export_NativeExportCodecBridge_nativeStandardUtf8Bytes(
    JNIEnv* env, jobject, jstring value) {
  std::string utf8;
  if (!ReadUtf8(env, value, &utf8) ||
      utf8.size() > static_cast<size_t>(std::numeric_limits<jsize>::max())) {
    return nullptr;
  }
  const jsize size = static_cast<jsize>(utf8.size());
  jbyteArray result = env->NewByteArray(size);
  if (result != nullptr && size > 0) {
    env->SetByteArrayRegion(
        result, 0, size, reinterpret_cast<const jbyte*>(utf8.data()));
  }
  return env->ExceptionCheck() ? nullptr : result;
}

extern "C" JNIEXPORT jfloatArray JNICALL
Java_expo_modules_snapcutmedia_export_NativeExportCodecBridge_nativeProcessResampler(
    JNIEnv* env,
    jobject,
    jlong handle,
    jfloatArray pcm,
    jint frame_count,
    jboolean end_of_input) {
  const auto state = Lookup(g_resamplers, g_resampler_registry_mutex, handle);
  if (state == nullptr) {
    return nullptr;
  }
  std::vector<float> input;
  if (!ReadPcm(env, pcm, frame_count, state->channels, &input)) {
    return nullptr;
  }
  const long output_frames = RequiredResamplerOutputFrames(
      frame_count, state->input_rate, state->output_rate);
  if (output_frames < 0) {
    return nullptr;
  }
  std::vector<float> output(
      static_cast<size_t>(output_frames) * static_cast<size_t>(state->channels));

  SRC_DATA data{};
  data.data_in = input.empty() ? nullptr : input.data();
  data.input_frames = frame_count;
  data.data_out = output.data();
  data.output_frames = output_frames;
  data.src_ratio = state->ratio;
  data.end_of_input = end_of_input == JNI_TRUE ? 1 : 0;

  std::lock_guard<std::mutex> guard(state->mutex);
  if (src_process(state->state.get(), &data) != 0 ||
      data.input_frames_used != frame_count || data.output_frames_gen < 0 ||
      data.output_frames_gen > output_frames) {
    return nullptr;
  }
  const jsize generated_samples = static_cast<jsize>(
      data.output_frames_gen * static_cast<long>(state->channels));
  jfloatArray result = env->NewFloatArray(generated_samples);
  if (result != nullptr && generated_samples > 0) {
    env->SetFloatArrayRegion(result, 0, generated_samples, output.data());
  }
  return env->ExceptionCheck() ? nullptr : result;
}

extern "C" JNIEXPORT jint JNICALL
Java_expo_modules_snapcutmedia_export_NativeExportCodecBridge_nativeResetResampler(
    JNIEnv*, jobject, jlong handle) {
  const auto state = Lookup(g_resamplers, g_resampler_registry_mutex, handle);
  if (state == nullptr) {
    return kStatusAlreadyClosed;
  }
  std::lock_guard<std::mutex> guard(state->mutex);
  return src_reset(state->state.get()) == 0 ? kStatusOk : kStatusError;
}

extern "C" JNIEXPORT jint JNICALL
Java_expo_modules_snapcutmedia_export_NativeExportCodecBridge_nativeCloseResampler(
    JNIEnv*, jobject, jlong handle) {
  return RemoveAndCancel(&g_resamplers, &g_resampler_registry_mutex, handle);
}

extern "C" JNIEXPORT jlong JNICALL
Java_expo_modules_snapcutmedia_export_NativeExportCodecBridge_nativeCreateMp3Encoder(
    JNIEnv* env,
    jobject,
    jstring path,
    jint sample_rate,
    jint channels,
    jstring title) {
  if (sample_rate <= 0 || channels < 1 || channels > kMaxChannels) {
    return 0;
  }
  std::string native_path;
  std::string native_title;
  if (!ReadUtf8(env, path, &native_path) || !ReadUtf8(env, title, &native_title)) {
    return 0;
  }
  auto encoder = Mp3EncoderState::Create(
      native_path.c_str(), sample_rate, channels, native_title.c_str());
  if (encoder == nullptr) {
    return 0;
  }
  const jlong handle = g_next_encoder_handle.fetch_add(1);
  std::lock_guard<std::mutex> guard(g_encoder_registry_mutex);
  g_encoders.emplace(handle, std::move(encoder));
  return handle;
}

extern "C" JNIEXPORT jint JNICALL
Java_expo_modules_snapcutmedia_export_NativeExportCodecBridge_nativeWriteEncoder(
    JNIEnv* env,
    jobject,
    jlong handle,
    jfloatArray pcm,
    jint frame_count) {
  const auto encoder = Lookup(g_encoders, g_encoder_registry_mutex, handle);
  if (encoder == nullptr) {
    return kStatusAlreadyClosed;
  }
  const jsize samples = pcm == nullptr ? -1 : env->GetArrayLength(pcm);
  if (frame_count <= 0 || frame_count > kMaxChunkFrames ||
      samples != frame_count * encoder->Channels()) {
    return kStatusError;
  }
  std::vector<float> input;
  if (!ReadPcm(env, pcm, frame_count, encoder->Channels(), &input)) {
    return kStatusError;
  }
  return encoder->Write(input, frame_count);
}

extern "C" JNIEXPORT jint JNICALL
Java_expo_modules_snapcutmedia_export_NativeExportCodecBridge_nativeFinishEncoder(
    JNIEnv*, jobject, jlong handle) {
  const auto encoder = Lookup(g_encoders, g_encoder_registry_mutex, handle);
  return encoder == nullptr ? kStatusAlreadyClosed : encoder->Finish();
}

extern "C" JNIEXPORT jint JNICALL
Java_expo_modules_snapcutmedia_export_NativeExportCodecBridge_nativeCloseEncoder(
    JNIEnv*, jobject, jlong handle) {
  return RemoveAndCancel(&g_encoders, &g_encoder_registry_mutex, handle);
}
