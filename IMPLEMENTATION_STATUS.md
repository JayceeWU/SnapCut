# SnapCut implementation status

Status snapshot: 2026-08-14. This file separates source implementation from verified runtime
behavior. A feature listed as present in source is **not** release-certified until the integrated
quality gates, APK builds, emulator tests, and required physical-device checks below are recorded
as passing for the same revision.

## Current schema-v6 fixed-center editor revision

The current working tree targets schema v6 and builds on schema v5 without changing persisted
media or Clip fields. These changes are user-approved amendments to the original version 1
technical guide. The local source, unit, native-build, and Debug APK gates recorded below pass;
connected emulator and physical-device acceptance is still pending:

- Clips persist an absolute timeline position, `track-1` or `track-2`, gain from 0 to 1, and
  independent fade-in/fade-out durations.
- Clips on one track cannot overlap. Clips on different tracks may overlap, and the timeline may
  contain silence.
- Fade durations use 0.5-second steps from 0 through 6 seconds. Fade-in plus fade-out cannot
  exceed the Clip duration. Preview and decoded export use the same equal-power envelope.
- Existing schema-v3 Clips migrate sequentially onto Track 1 with unity gain and no fades. A
  project that contains Sources but no Clips receives full-source Track 1 Clips during migration.
- Schema-v4 projects migrate to v5 by enabling Track 2 while preserving every Source, Clip,
  timeline position, gain, fade, waveform, name, timestamp, and export record. The v5-to-v6
  migration changes only the schema version; every v5 Fade value remains valid in v6.
- The main editor is a fixed 248 dp stage: an 80 dp upper scrub/ruler zone, two permanent 56 dp
  waveform lanes, and a 56 dp lower scrub zone. A fixed red playhead spans the complete stage at
  its exact horizontal center while ruler, waveforms, and Clips move beneath it.
- Upper and lower zones select the cursor and pause immediately on drag. Track gestures only move,
  reassign, or edge-trim Clips and never change playback time. The stage has no pinch-to-zoom or
  independent pan gesture.
- One overview bar below the tracks owns viewport navigation. It defaults to a 30-second span,
  permits a 1-second minimum span, supports left/right edge resizing and body dragging, and can
  recenter the visible interval from a tap.
- Volume and Fade are inline controls rather than dialogs. Volume uses one 0-to-100% slider; Fade
  uses separate Fade In and Fade Out sliders with the schema-v6 0.5-second step constraint. Clip
  actions are one icon plus one label for Volume, Fade, Split, and Delete.
- Pause is an explicit control revision. The UI freezes optimistically, native progress stops, and
  stale load, play, seek, or status results cannot resume playback after a newer Pause.
- Rename and Delete remain on the project list. The editor project overflow menu is removed; the
  first-export name confirmation remains available.
- Clip movement, track changes, edge trims, Volume, Fade, Split, Delete, and Add Clip have a
  failure-atomic, 50-step session-only Undo/Redo history.
- A successful import commits the Source and its full-length Clip in one project transaction.
  The progress modal closes only after the committed project reload confirms both records.
- `source.json` remains an immutable import manifest. Recovery ignores only the mutable
  `waveformStatus` when relating it to `project.json`; media identity, hash, size, duration, codec,
  sample rate, channels, and AAC metadata remain strict. A ready waveform still requires a valid
  8,192-bin waveform file.
- Composition preview uses at most one Media3 ExoPlayer per track, with shared transport and drift
  correction. Each track applies the Clip gain and equal-power fade envelope.
- FLAC, MP3, and re-encoded M4A use one bounded streaming two-track PCM mixer. Cross-track samples
  are summed and hard-clamped; no full temporary WAV composition is created.
- M4A exposes two truthful modes:
  - `M4A · No re-encoding` copies compatible AAC access units only for a contiguous,
    non-overlapping timeline with unity gain, no fades, and valid access-unit boundaries.
  - `M4A · Re-encoded AAC` processes other eligible timelines as AAC-LC at 320 kbps stereo or
    160 kbps mono. The mode is unavailable when the device cannot provide the required encoder;
    SnapCut does not silently lower the bitrate.

## Current schema-v6 verification

The following local gates passed on 2026-08-14 for this working tree:

- [x] Isolated clean `npm ci` from `package-lock.json` with Node 22.13.1 and npm 11.6.1.
- [x] `npm run typecheck`.
- [x] `npm run lint`, with zero warnings.
- [x] `npm run cpd`: 27 reported clones and 1.04% duplicated lines, within the configured
      threshold.
- [x] Complete `npm test`: 23 suites and 196 tests passed.
- [x] `npm run format`.
- [x] `npm run audit` prohibited-implementation scan.
- [x] Expo Doctor: 21/21 checks passed; `expo install --check` reported all dependencies current.
- [x] Clean Expo Android prebuild.
- [x] Kotlin Debug compilation and unit tests: 128 test entries across 35 reports, with zero
      failures/errors and one existing Windows symlink test skipped.
- [x] Media3 single-version, native-codec source, and explicit 16 KiB linker configuration gates.
- [ ] Debug instrumentation APK assembly and connected execution were not included in this
      Debug-only iteration.
- [x] Debug APK assembly for arm64-v8a and x86_64.
- [x] Debug APK inspection: no broad storage/media-library/microphone/camera permission, v2
      signature valid, APK zip alignment valid for 16 KiB pages, and every SnapCut-owned shared
      library has 16,384-byte ELF LOAD alignment for both packaged ABIs.

Current schema-v6 artifact:

- Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`, 210,352,484 bytes, SHA-256
  `5AB5B0B9E1E83979A35AA48D574A0489151E00A59087FFA23A0604969C74BDB1`.
- Package: `com.snapcut.app`, min SDK 29, target SDK 36, signed with the existing Android debug
  certificate (`FAC61745DC0903786FB9EDE62A962B399F7348F0BB6F899B8332667591033B9C`).

This iteration is Debug-only. No schema-v6 Release or Preview APK is scheduled or recorded until
the user explicitly declares SnapCut finalized.

## Historical schema-v5 local verification

Before schema-v6 work began, the schema-v5 revision completed the following local gates on
2026-08-14. These results remain truthful historical evidence, but they do not validate schema v6:

- [x] Clean `npm ci` from `package-lock.json` under Node 22.13.1 and npm 10.9.2.
- [x] `npm run typecheck`.
- [x] `npm run lint`.
- [x] `npm run cpd`: 29 reported clones, 1.34% duplicated lines, within the configured threshold.
- [x] Complete `npm test`: 23 suites and 179 tests passed.
- [x] `npm run format`.
- [x] `npm run audit` prohibited-implementation scan.
- [x] Expo Doctor: 21/21 checks passed; `expo install --check` reported all dependencies current.
- [x] Clean Expo Android prebuild under Node 22.13.1.
- [x] Kotlin Debug and Release compilation.
- [x] Kotlin unit tests: 123 passed across 34 reports, with one existing Windows symlink test
      skipped; Media3 single-version and native-codec source gates passed.
- [x] Debug instrumentation APK assembly.
- [x] Debug and Release APK assembly for arm64-v8a and x86_64.
- [x] APK contents, permissions, v2 signature, and 16 KiB page-alignment inspection.

That historical Gradle run used JDK 17 and executed
`:snap-cut-media:compileDebugKotlin`, `:snap-cut-media:testDebugUnitTest`,
`:snap-cut-media:compileReleaseKotlin`, `:snap-cut-media:verifyMedia3Versions`,
`:snap-cut-media:verifyNativeCodecSources`, `:snap-cut-media:assembleDebugAndroidTest`,
`:app:assembleDebug`, and `:app:assembleRelease`. The Release task was then repeated incrementally
with `NODE_ENV=production`.

Historical schema-v5 artifacts:

- Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`, 206,258,164 bytes, SHA-256
  `66075B408FE16ACB26DC57CFC63A02A7D94EBC4AFC9B275E29CDBB81FD23AB20`.
- Release APK: `android/app/build/outputs/apk/release/app-release.apk`, 72,307,466 bytes, SHA-256
  `C4B94FA82B5FF653F29C70A7C20C67593F5852B78353AE82BA24C4730ED36E9C`.
- Instrumentation APK:
  `modules/snap-cut-media/android/build/outputs/apk/androidTest/debug/snap-cut-media-debug-androidTest.apk`,
  116,807,666 bytes, SHA-256
  `AE39A729D6157181A700F8A348446B04F6FD1062A12985E1AE0AA7D3D685D08C`.

The historical app APKs contain arm64-v8a and x86_64 builds of `libsnapcut_codec.so`,
`libmp3lame.so`, and `libc++_shared.so`. They use the same internal Android debug certificate
(SHA-256 `FAC61745DC0903786FB9EDE62A962B399F7348F0BB6F899B8332667591033B9C`) and are not
production-store artifacts. The schema-v5 manifest contained no broad storage, media-library,
microphone, or camera permission, targeted API 36, supported API 29 and newer, and packaged only
arm64-v8a and x86_64. None of these artifacts should be presented as the schema-v6 Debug APK.

## Runtime acceptance not yet established

The following remain unverified for the schema-v6 revision and must not be inferred from source,
unit-test, Gradle, or APK-assembly success:

- API 29 and API 36 connected instrumentation execution.
- First and repeated audio/video import, failed-import retry, import modal dismissal, background
  waveform completion, and automatic recovery of projects previously misclassified as repair.
- Fixed-center cursor scrubbing, overview-only viewport resizing and movement, direct Clip drag and
  edge trim, inline Volume/Fade adjustment, and session Undo/Redo on a device.
- Immediate Pause while loading or playing, stale `controlRevision` rejection, two-track preview
  synchronization, seeks, gaps, gain, fades, audio-focus loss, backgrounding, headphone
  disconnect, and Bluetooth disconnect on a device.
- Real-media M4A stream copy, M4A AAC re-encode, FLAC, and MP3 output, including duration, gain,
  fade, overlap, clipping, MediaStore publication, sharing, and cancellation cleanup.
- Installation and airplane-mode startup of an embedded-JavaScript Release or EAS Preview APK.
- Huawei Mate 20 acceptance, near-600 MiB import, 30-minute export, low-storage handling, memory
  growth, phone-call interruption, and overwrite-install project retention.
- EAS project initialization, credentials, Development APK, and Preview APK unless separately
  recorded after successful cloud runs.

SnapCut is not release-certified until the applicable connected emulator, offline-install,
real-media, and physical-device results are added to this file.
