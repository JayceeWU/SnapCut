# SnapCut implementation status

Status snapshot: 2026-08-12. A checked phase means its code milestone and the recorded local gates
below passed. It does **not** replace the emulator, offline-install, EAS, or physical-device
acceptance criteria that remain explicitly untested.

- [x] Phase 1 — Project shell, domain model, and atomic metadata storage
- [x] Phase 2 — Local Expo Module, pinned native dependency build, and Android autolinking
- [ ] Phase 3 — Source inspection, audio extraction, and waveform generation (implementation and
      unit tests pass; connected real-media execution is pending)
- [x] Phase 4 — Source editor and non-destructive clip model
- [ ] Phase 5 — Native composition preview (implementation and build pass; emulator/device runtime
      behavior is pending)
- [ ] Phase 6 — M4A, FLAC, and MP3 export (implementation and build pass; complete real-media
      export fixtures and device acceptance are pending)
- [ ] Phase 7 — Failure recovery and APK delivery (local automation and internal APKs pass;
      emulator, offline-install, and physical-device acceptance are pending)

## Implemented code paths

- Android-only Expo Router application with strict TypeScript, Zod persistence contracts, Zustand
  runtime stores, deep-purple theme, and app-private `Documents/SnapCut` storage.
- Atomic project/source metadata, journal-backed import commit, native final-file size/SHA-256
  verification, safe rollback, startup recovery, repair/corrupt visibility, bounded redacted
  diagnostics, and guarded deletion.
- Native `ACTION_OPEN_DOCUMENT` picker, opaque `content://` inspection, unknown/contradictory size
  handling, cancellable provider opening, AAC extraction or supported audio copy, and 8,192-bin
  RMS/peak waveform generation with progress, cancellation, retry, and lifecycle handling.
- Non-destructive clip editing and ordering, one native Media3 preview player, command/session
  generation, interruption handling, and committed-source-only playback.
- Immutable M4A preflight and access-unit stream copy with exact payload proof plus MP4-timebase
  timeline tolerance; shared decoded FLAC/MP3 path with bounded resampling and one continuous
  encoder; MediaStore pending publication, cancellation commit gate, cleanup, and sharing.
- Node 22 CI plus a separately dispatched API 29/API 36 Android instrumentation workflow.

## Final local verification record

All results below are for the frozen source tree after a clean `npm ci` under Node `22.13.1` and a
clean Expo Android prebuild.

### JavaScript and configuration

- `npm ci`: passed from the committed lockfile.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run cpd`: passed; 1.20% duplicated lines, below the 3% threshold.
- `npm test`: 20 suites and 119 tests passed.
- `npm run format`: passed.
- `npm run audit`: prohibited-implementation audit passed, including active Kotlin/Java sources.
- `npm run doctor`: Expo Doctor passed 20/20 checks.

`npm audit --omit=dev` still reports upstream advisories through the Expo/React Native build and
configuration graph (`image-size@1.2.1` and `uuid@7.0.3`). npm offers only breaking downgrades
outside the SDK 57 baseline as automatic fixes. The decision and exposure boundary are recorded in
`IMPLEMENTATION_NOTES.md`; no forced dependency rewrite was applied.

### Android, Kotlin, and native code

- `npx expo prebuild --clean --platform android --no-install`: passed under Node 22.13.1.
- `:snap-cut-media:compileDebugKotlin`: passed.
- `:snap-cut-media:testDebugUnitTest`: 100 tests discovered; 99 passed, 0 failed, and 1 Windows-only
  symlink test skipped because symbolic links were unavailable in the test environment.
- `:snap-cut-media:compileReleaseKotlin`: passed.
- `:snap-cut-media:verifyMedia3Versions`: passed with one Media3 `1.10.1` graph.
- `:snap-cut-media:verifyNativeCodecSources`: passed for pinned source-only libFLAC 1.5.0,
  LAME 4.0, and libsamplerate 0.2.2.
- `:snap-cut-media:assembleDebugAndroidTest`: passed; the instrumentation APK compiled and was
  packaged, but it was not executed on an emulator or device.
- `:app:assembleDebug` and minified `:app:assembleRelease`: passed under JDK 17 for arm64-v8a and
  x86_64.

### Internal APK inspection

- Debug APK: `206,159,852` bytes; SHA-256
  `F1362E50721D8A31DEAEC7932475CE98EB76F8AB374BF6CA68048D8427AE3549`.
- Release APK: `71,277,930` bytes; SHA-256
  `508E213CB32013E59DB11A4EADFA4957C463E4595E2D11A35CD6CF7F07091304`.
- Instrumentation APK: `116,692,978` bytes; SHA-256
  `1A101269B808141924E6AAA53FF4BDAC692093B4CCF2DD80159B5A0A723A3FF2`.
- Release APK contains `assets/index.android.bundle`, `libsnapcut_codec.so`, and `libmp3lame.so`
  for both arm64-v8a and x86_64.
- Release APK passed 16 KiB zip alignment and APK Signature Scheme v2 verification.
- Package is `com.snapcut.app` version `1.0.0` (`versionCode` 1), min SDK 29, target SDK 36.
- Release manifest does not contain camera, microphone, overlay, legacy/external-storage, or broad
  Android media-read permissions.
- The local Release APK uses the generated Android debug certificate. It is an internal test
  artifact, not a production-signed release.

Generated APK paths (the root `android/` tree is intentionally ignored):

- `android/app/build/outputs/apk/debug/app-debug.apk`
- `android/app/build/outputs/apk/release/app-release.apk`

## Not initialized or not tested

- EAS account/project link, EAS Android credentials, Development build, and Preview build:
  **Not initialized/tested**.
- API 29/API 36 connected instrumentation: **Not tested locally**. The current Windows Android SDK
  has no command-line tools, emulator system images, or configured AVDs. The manual GitHub workflow
  is present but has not been run.
- Installation and launch of the fresh Release APK without Metro and in airplane mode:
  **Not tested** because no emulator or connected Android device is available in this environment.
- Full real-media M4A/FLAC/MP3 export sequences, MediaStore publication, native preview, and
  waveform playback on an emulator/device: **Not tested**.
- Physical-device import, preview, export, interruption, and overwrite-install flows:
  **Not tested**.
- Near-600 MiB provider import, long cancellation, 30-minute exports, low-storage behavior,
  headphone/Bluetooth/phone-call interruption, memory growth, and long-running stress:
  **Not tested**.

SnapCut version 1 is not release-certified until the required connected instrumentation,
offline-installed APK, real-media export, and physical-device results are recorded. Unit, Gradle,
and APK inspection success must not be presented as proof of those unexecuted scenarios.
