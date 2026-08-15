# SnapCut implementation status

Status snapshot: 2026-08-14. This file separates source implementation from verified runtime
behavior. A feature listed as present in source is **not** release-certified until the matching
quality gates, APK build, emulator checks, and required physical-device checks are recorded as
passing for the same revision.

## Current schema-v7 single sequential Clip revision

The current working tree implements the user-approved schema-v7 editor. The previous schema-v6
state was preserved first in local `dev` commit `ba18acc` (`chore: checkpoint schema v6 editor`).
The v7 changes intentionally remain uncommitted while they are being tested, and no push is
recorded here.

Present in the v7 source tree:

- `SnapCutClip` persists only `id`, `sourceId`, `startMs`, and `endMs`. `clips[]` array order is the
  canonical composition order, and duration is the sum of every `endMs - startMs` range.
- The app derives one continuous native timeline at preview/export time. Each native Clip uses
  Track 1, unity gain, zero fade, and a prefix-sum `timelineStartMs`; multitrack, gap, overlap,
  gain, Fade, Split, and zoom controls are no longer exposed by the editor.
- Import commits a validated private Source only. It does not create a full-length Clip. Sources
  receive collision-safe project-local `Source N` names rather than provider file names.
- Source rename accepts 1-255 trimmed Unicode code points and permits duplicate names. Source
  deletion stops matching preview/waveform work, rechecks the current project, rejects referenced
  media with `SOURCE_IN_USE`, and transactionally removes unused private media.
- Source metadata schema v2 stores only immutable media identity. The mutable display name and
  waveform status remain authoritative in `project.json`, so source rename does not cause a
  source-manifest mismatch.
- Schema v7 does not migrate older project data. Before normal recovery, a generation service
  removes SnapCut-owned old `projects`, `staging`, transaction data, and index metadata, verifies
  cleanup, recreates the base directories, and atomically writes the v7 marker. An interrupted
  reset is retried. Diagnostics, picker sources, and public MediaStore exports are outside its
  deletion targets.
- The editor begins with a fit-to-width composition waveform assembled from ordered Clip slices.
  Segment width follows duration, missing waveform data has a placeholder, boundaries remain
  visible, and tap/drag scrub pauses before issuing one non-resuming seek at gesture completion.
- The compact Clip list shows `Clip N`, source name, and exact Start/End values. A 48 dp long-press
  handle reorders Clips with edge auto-scroll, and TalkBack exposes Move earlier/later actions.
- The Clip editor selects a Source and accepts `SS.mmm`, `M:SS.mmm`, or `H:MM:SS.mmm` values. It
  enforces source bounds and a 100 ms minimum, saves the entire edit atomically, cancels from the
  backdrop/Android Back, and has no preview.
- The Media dialog provides Import, full-source Preview/Pause, Rename, Add Clip, and unused-source
  Delete. After import commits and the project reloads, progress closes, Media reopens, and a
  source-name dialog is offered; cancelling retains the generated name.
- The playback row contains current/total, graphical Play/Pause, Undo, and Redo. The current
  editing session keeps at most 50 Clip add/edit/reorder/delete states; import and Source metadata
  operations are deliberately outside history.
- Project-list Rename/Delete and the first-export project-name confirmation remain. The editor
  header retains Back, project title, `+ Media`, and `EXP`.
- Existing native import validation, revisioned Pause, bounded waveform generation, Media3
  preview, M4A preflight/stream copy, decoded M4A, FLAC, MP3, MediaStore publication, cancellation,
  and redacted diagnostics remain behind the simplified application contract.

These implementation statements describe reviewed source shape only. They are not a claim that
the v7 integration or media runtime has passed.

## Current schema-v7 verification

The following local gates passed on 2026-08-14 for the current uncommitted v7 working tree:

- [x] Clean `npm ci` from the synchronized `package-lock.json` under Node 22.13.1 and npm 10.9.2.
- [x] `npm run typecheck`.
- [x] `npm run lint` with zero warnings.
- [x] `npm run cpd`: 28 reported clones and 1.36% duplicated lines, within the configured
      threshold.
- [x] Complete `npm test`: 22 suites and 162 tests passed.
- [x] `npm run format`.
- [x] `npm run audit` prohibited-implementation scan.
- [x] Expo Doctor: 21/21 checks passed; `expo install --check` reported all dependencies current.
- [x] Clean Expo Android prebuild.
- [x] Kotlin Debug compilation and unit tests: 128 test entries across 35 reports, with zero
      failures/errors and one existing Windows symlink test skipped.
- [x] Media3 single-version, native-codec source, and explicit 16 KiB linker configuration gates.
- [x] Debug APK assembly for arm64-v8a and x86_64.
- [x] Debug APK inspection: package `com.snapcut.app`, min SDK 29, target SDK 36, no broad
      storage/media-library/microphone/camera permission, valid v2 Debug signature, valid 16 KiB
      ZIP alignment, and 16,384-byte ELF LOAD alignment for `libsnapcut_codec.so` and
      `libmp3lame.so` in both packaged ABIs.
- [ ] API 29 and API 36 connected instrumentation execution.

Current schema-v7 iteration artifact:

- Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`, 206,274,548 bytes, SHA-256
  `0A3A33885C18351BDBFCED9BE4CB8A163B6FE3B383F9E46EA5A0B4C43BDB539E`.
- Debug signer certificate SHA-256:
  `FAC61745DC0903786FB9EDE62A962B399F7348F0BB6F899B8332667591033B9C`.

This revision is strictly Debug-only. No schema-v7 Release or Preview task may be run or claimed
until the user explicitly says SnapCut is finalized.

## Historical schema-v6 checkpoint verification

Before the v7 redesign, the schema-v6 revision completed these local gates on 2026-08-14. These
results remain historical evidence for commit `ba18acc`; they do **not** validate schema v7:

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
- [ ] Debug instrumentation APK assembly and connected execution were not included in that
      Debug-only iteration.
- [x] Debug APK assembly for arm64-v8a and x86_64.
- [x] Debug APK inspection: no broad storage/media-library/microphone/camera permission, v2
      signature valid, APK ZIP alignment valid for 16 KiB pages, and every SnapCut-owned shared
      library had 16,384-byte ELF LOAD alignment for both packaged ABIs.

Historical schema-v6 artifact:

- Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`, 210,352,484 bytes, SHA-256
  `5AB5B0B9E1E83979A35AA48D574A0489151E00A59087FFA23A0604969C74BDB1`.
- Package: `com.snapcut.app`, min SDK 29, target SDK 36, signed with the existing Android debug
  certificate (`FAC61745DC0903786FB9EDE62A962B399F7348F0BB6F899B8332667591033B9C`).

That artifact contains the superseded two-track schema-v6 editor and must not be delivered as the
v7 Debug APK.

## Historical schema-v5 local verification

Before schema-v6 work began, the schema-v5 revision completed the following local gates on
2026-08-14. These results remain truthful historical evidence, but they validate neither schema
v6 nor schema v7:

- [x] Clean `npm ci` from `package-lock.json` under Node 22.13.1 and npm 10.9.2.
- [x] `npm run typecheck`.
- [x] `npm run lint`.
- [x] `npm run cpd`: 29 reported clones and 1.34% duplicated lines, within the configured
      threshold.
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

Those app APKs contained arm64-v8a and x86_64 builds of `libsnapcut_codec.so`,
`libmp3lame.so`, and `libc++_shared.so`. They used the same internal Android debug certificate
(SHA-256 `FAC61745DC0903786FB9EDE62A962B399F7348F0BB6F899B8332667591033B9C`) and were not
production-store artifacts. Their manifests had no broad storage, media-library, microphone, or
camera permission. None should be presented as a schema-v7 build.

## Runtime acceptance not yet established for schema v7

The following must not be inferred from source, Jest, Gradle, or APK-assembly success:

- API 29 and API 36 connected instrumentation execution for the current revision.
- The first-start v7 reset, interrupted reset retry, and preservation of Diagnostics and public
  MediaStore exports on a real upgrade installation.
- First and repeated audio, M4A, and video imports; failure retry; automatic progress dismissal;
  default naming; rename/cancel; and background waveform completion.
- Source preview/pause switching, deletion resource release, unused-source removal, and referenced-
  source rejection on a device.
- Composition waveform slicing, placeholder behavior, exact cursor scrub/seek, ordered playback,
  immediate Pause, stale `controlRevision` rejection, and 50-step session Undo/Redo.
- Exact-time Clip add/edit/delete, long-press reordering with edge auto-scroll, and TalkBack actions
  on the approximately 360 × 748 dp Huawei Mate 20 viewport.
- Real-media M4A stream copy or re-encode, FLAC, and MP3 duration/order, MediaStore publication,
  sharing, and cancellation cleanup.
- Headphone/Bluetooth disconnect, audio-focus loss, app backgrounding, phone-call interruption,
  low-storage handling, memory growth, near-600 MiB import, and 30-minute export.
- Overwrite-install behavior and any embedded-JavaScript Release, EAS Development, or Preview APK.

SnapCut is not release-certified until the applicable connected-emulator, real-media,
offline-install, and physical-device results are recorded here for one final revision.
