#include <jni.h>

#include <lame.h>
#include <samplerate.h>

#include <atomic>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <utility>

namespace {

constexpr char kBridgeClassName[] =
    "expo/modules/snapcutmedia/codec/NativeCodecBridge";
constexpr jint kCloseResultClosed = 0;
constexpr jint kCloseResultAlreadyClosedOrUnknown = 1;

struct CodecSmokeHandle final {
  lame_t lame = nullptr;
  SRC_STATE* sample_rate = nullptr;

  CodecSmokeHandle() = default;
  CodecSmokeHandle(const CodecSmokeHandle&) = delete;
  CodecSmokeHandle& operator=(const CodecSmokeHandle&) = delete;

  ~CodecSmokeHandle() {
    if (sample_rate != nullptr) {
      src_delete(sample_rate);
    }
    if (lame != nullptr) {
      lame_close(lame);
    }
  }

  bool Initialize() {
    lame = lame_init();
    if (lame == nullptr) {
      return false;
    }

    int sample_rate_error = 0;
    sample_rate = src_new(SRC_SINC_FASTEST, 1, &sample_rate_error);
    return sample_rate != nullptr && sample_rate_error == 0;
  }
};

std::atomic<jlong> g_next_handle{1};
std::mutex g_handles_mutex;
std::unordered_map<jlong, std::unique_ptr<CodecSmokeHandle>> g_handles;

jstring NewUtfString(JNIEnv* env, const char* value) {
  return env->NewStringUTF(value == nullptr ? "" : value);
}

jstring NativeLameVersion(JNIEnv* env, jobject /* receiver */) {
  return NewUtfString(env, get_lame_version());
}

jstring NativeSampleRateVersion(JNIEnv* env, jobject /* receiver */) {
  const char* raw_version = src_get_version();
  if (raw_version == nullptr) {
    return NewUtfString(env, "");
  }

  // Upstream returns "libsamplerate-<version> (...)". Keep the public bridge
  // stable while deriving the value from the linked library at runtime.
  std::string normalized(raw_version);
  constexpr char kPrefix[] = "libsamplerate-";
  if (normalized.rfind(kPrefix, 0) == 0) {
    normalized.erase(0, sizeof(kPrefix) - 1);
  }
  const std::size_t suffix = normalized.find(' ');
  if (suffix != std::string::npos) {
    normalized.erase(suffix);
  }
  return NewUtfString(env, normalized.c_str());
}

jlong NativeCreateSmokeHandle(JNIEnv* /* env */, jobject /* receiver */) {
  auto handle = std::make_unique<CodecSmokeHandle>();
  if (!handle->Initialize()) {
    return 0;
  }

  jlong id = g_next_handle.fetch_add(1, std::memory_order_relaxed);
  if (id <= 0) {
    // Wraparound is not realistically reachable, but zero and negative values
    // are reserved as invalid handles at the Kotlin boundary.
    g_next_handle.store(2, std::memory_order_relaxed);
    id = 1;
  }

  std::lock_guard<std::mutex> lock(g_handles_mutex);
  g_handles.emplace(id, std::move(handle));
  return id;
}

jint NativeCloseSmokeHandle(
    JNIEnv* /* env */,
    jobject /* receiver */,
    jlong handle_id) {
  if (handle_id <= 0) {
    return kCloseResultAlreadyClosedOrUnknown;
  }

  std::unique_ptr<CodecSmokeHandle> handle;
  {
    std::lock_guard<std::mutex> lock(g_handles_mutex);
    auto found = g_handles.find(handle_id);
    if (found == g_handles.end()) {
      return kCloseResultAlreadyClosedOrUnknown;
    }
    handle = std::move(found->second);
    g_handles.erase(found);
  }

  // Destroy codec state outside the registry lock. A second close observes an
  // absent handle and returns a stable idempotent result.
  handle.reset();
  return kCloseResultClosed;
}

JNINativeMethod kBridgeMethods[] = {
    {const_cast<char*>("nativeLameVersion"),
     const_cast<char*>("()Ljava/lang/String;"),
     reinterpret_cast<void*>(NativeLameVersion)},
    {const_cast<char*>("nativeSampleRateVersion"),
     const_cast<char*>("()Ljava/lang/String;"),
     reinterpret_cast<void*>(NativeSampleRateVersion)},
    {const_cast<char*>("nativeCreateSmokeHandle"),
     const_cast<char*>("()J"),
     reinterpret_cast<void*>(NativeCreateSmokeHandle)},
    {const_cast<char*>("nativeCloseSmokeHandle"),
     const_cast<char*>("(J)I"),
     reinterpret_cast<void*>(NativeCloseSmokeHandle)},
};

}  // namespace

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* java_vm, void* /* reserved */) {
  JNIEnv* env = nullptr;
  if (java_vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
    return JNI_ERR;
  }

  jclass bridge = env->FindClass(kBridgeClassName);
  if (bridge == nullptr) {
    return JNI_ERR;
  }

  const jint method_count =
      static_cast<jint>(sizeof(kBridgeMethods) / sizeof(kBridgeMethods[0]));
  if (env->RegisterNatives(bridge, kBridgeMethods, method_count) != JNI_OK) {
    env->DeleteLocalRef(bridge);
    return JNI_ERR;
  }
  env->DeleteLocalRef(bridge);
  return JNI_VERSION_1_6;
}

JNIEXPORT void JNICALL JNI_OnUnload(JavaVM* /* java_vm */, void* /* reserved */) {
  std::lock_guard<std::mutex> lock(g_handles_mutex);
  g_handles.clear();
}
