# SnapCut

SnapCut is an offline Android audio editor for assembling precise ranges from local audio and
video. Each project has a private media library and one ordered Clip list: the Clip array is the
final playback and export order, every Clip starts immediately after the previous one, and edits
never rewrite the imported source.

## What it does

- Imports one local M4A/AAC, MP3, FLAC, WAV, supported MP4/MOV audio track, or self-contained M4S
  source at a time through Android's system document picker.
- Treats picker MIME types, names, extensions, and reported sizes as hints; Android media tracks
  and decoder availability are authoritative.
- Extracts a compatible AAC soundtrack from video into an audio-only private M4A without copying
  the full video or re-encoding the AAC payload.
- Copies supported audio into project-private storage so the project does not depend on the
  original picker URI after import.
- Adds an import to the Sources library only; importing does not silently create a Clip. New sources
  receive a project-local `S1`, `S2`, ... name and can be renamed after import. Provider file names are
  not persisted.
- Lets the Sources library preview or pause a complete source, rename it, or delete it when no Clip
  references it. Referenced sources return the stable `SOURCE_IN_USE` failure and must remain until
  their Clips are removed; new Clip ranges are added from the editor's `+ Clip` action.
- Adds a per-Source comparison workspace after waveform generation. Two independently positioned
  views share a 1–10 second integer display span and keep their cut-point playheads centered. It
  can audition the five seconds before the first point directly into the five seconds after the
  second point, or play the fit-width retained result from its white cursor. One saved pair can
  atomically append the two retained ranges to the ordered Clips.
- Generates an 8,192-bin RMS/peak waveform in the background without transferring media bytes or
  decoded PCM into JavaScript.
- Shows one full-width composition waveform assembled from the ordered Clip ranges. Each segment
  is proportional to its duration, missing source waveforms use a placeholder, and the entire
  composition always fits the available width without zoom or pan.
- Moves the composition cursor by tapping or dragging the waveform. Scrubbing pauses first, sends
  one seek when it ends, and does not resume playback automatically.
- Shows a compact ordered Clip list. Every row displays `Clip N`, the source name, and millisecond-
  precise Start and End values. A dedicated long-press drag handle reorders rows; TalkBack exposes
  equivalent Move earlier and Move later actions.
- Opens a compact Clip editor when a row or `+ Clip` is selected. The editor chooses a source,
  shows its full fit-to-width waveform, can play or scrub from an exact millisecond cursor, and
  can set Start or End from that cursor. Separate `M`, `SS`, and `mmm` inputs remain available; the
  range must stay inside its source and be at least 100 milliseconds. The keyboard-adjusting
  scroll layout keeps End and the actions reachable on small screens.
- Adds an optional `1`, `2`, `4`, `6`, or `8` second equal-power crossfade to an eligible adjacent
  Clip boundary. The preceding and following Source ranges must provide half of that duration as
  unused audio around the stored cut, and neighboring crossfades cannot consume more than the Clip
  duration. Crossfade rows can be edited, removed, or moved to another legal boundary.
- Keeps the playback row limited to current/total time, graphical Play/Pause, Undo, and Redo.
  Session history stores up to 50 Clip add, edit, reorder, and delete operations; it is not
  persisted and does not undo import, source rename, or source deletion.
- Derives the native preview and export timeline from the ordered list. Ordinary boundaries use a
  continuous Track 1 prefix sum. A crossfade privately alternates the two native tracks, extends
  each Source range by half the selected duration, overlaps them around the original seam, and
  applies matching equal-power fade envelopes without changing the public project duration. The
  app exposes no freeform multitrack editing, silence gaps, per-Clip volume, split, or timeline
  zoom controls.
- Exports the composition as:
  - `M4A · No re-encoding` when compatible AAC ranges pass access-unit preflight;
  - explicitly labeled re-encoded AAC M4A when that existing native path is required and the
    device exposes the required encoder;
  - 320 kbps CBR MP3 through one continuous encoder.

FLAC remains an input format, not an export format. MP3 and re-encoded M4A use bounded native PCM
streaming and do not create a full temporary WAV composition.

## Architecture

```text
Expo Router / React Native / strict TypeScript
  -> project state, ordered Clips, waveform UI, Zod contracts
  -> SnapCutMedia local Expo Module (Kotlin)
     -> opaque content URI, inspection, bounded import, waveform, preview/export
     -> Android MediaExtractor / MediaCodec / MediaMuxer
     -> Media3 ExoPlayer 1.10.1
     -> JNI: LAME 4.0 / libsamplerate 0.2.2
```

The public project model is deliberately small:

```ts
interface SnapCutClip {
  id: string;
  sourceId: string;
  startMs: number;
  endMs: number;
}

interface SnapCutProject {
  schemaVersion: 9;
  sourceComparisons: Array<{ sourceId: string; firstMs: number; secondMs: number }>;
  crossfades: Array<{
    id: string;
    leftClipId: string;
    rightClipId: string;
    durationMs: 1000 | 2000 | 4000 | 6000 | 8000;
  }>;
  // identity, name, timestamps, sources, ordered clips, last export
}
```

Media bytes, decoded PCM, transcoding, waveform accumulation, and export encoding stay native.
Production code does not use Expo Go, `expo-audio`, `expo-av`, FFmpeg, JavaScript media
processing, Base64 media transfer, a network service, or broad Android storage permissions.

## Local-file safety

The selected `content://` URI is a short-lived capability, not a file path:

- `SnapCutMedia` opens Android's single-file `ACTION_OPEN_DOCUMENT` picker without requesting
  broad storage or media-library access.
- JavaScript never converts the URI to a “real path” and never reads, copies, deletes, or logs it.
- Native code opens the capability through `ContentResolver`; file names, query tokens, raw URIs,
  and original exception messages are excluded from diagnostics.
- Unknown or contradictory source size metadata is verified with a cancellable 64 KiB,
  limit-plus-one stream. Exactly 600 MiB is accepted; one additional byte is rejected.
- A non-seekable provider may be spooled once into bounded app-private staging.
- Failed or cancelled work removes only SnapCut-owned partial files. The provider source is never
  modified or deleted.
- Project metadata references only validated private media and never persists the provider URI.
- Staging output is inspected again before project commit, and private output URI equality, file
  size, SHA-256, schema, and relevant media properties remain validated.

Names, extensions, picker MIME values, and reported sizes remain hints. For example, a renamed
MP3 or M4A with an `.m4s` suffix is identified from its media track, while a genuine fragmented
M4S that lacks initialization metadata is rejected with a stable error.

## Storage

App-owned data is stored below `Documents/SnapCut` in the application sandbox:

```text
Documents/SnapCut/
  storage-generation.json          # app-private layout marker
  index.json                       # rebuildable project index
  diagnostics.json                 # bounded, redacted local log
  projects/<project-id>/
    project.json
    sources/<source-id>/
      source.json                  # immutable media-identity manifest
      source.m4a|mp3|flac|wav
      waveform.json
  staging/                         # import/delete journals and app-owned partials
```

SnapCut accepts only the current schema-v9 project format. The storage-generation marker protects
the app-private directory
layout; when the marker is absent, SnapCut performs a bounded, restartable cleanup before writing
it atomically. Cleanup does **not** delete the system-picker source, published MediaStore exports
under `Music/SnapCut`, or `diagnostics.json`.

`source.json` stores immutable media identity, hash, size, duration, and codec properties.
The mutable source display name and waveform job status live in `project.json`, so renaming a
source does not create a false repair state. Source deletion is transactional and is allowed only
after preview and waveform work for that source have stopped and a fresh project check confirms
that no Clip references it.

## Requirements

- Node.js 22.13 or newer within Node 22 (Node 23/24 is outside the checked engine range)
- npm with the committed lockfile
- JDK 17
- Android SDK 36 and Build Tools 36.0.0
- Android NDK 27.1 and CMake 3.22.1
- Android 10 (API 29) or newer

The committed dependency baseline is Expo `57.0.14`, React Native `0.86.2`, React `19.2.3`, and
Media3 `1.10.1`. Native codecs are built from pinned source: LAME `4.0` and libsamplerate `0.2.2`.
`npm ci` installs the exact JavaScript dependency graph from
`package-lock.json`.

The generated root `android/` directory is intentionally ignored. Native source belongs in
`modules/snap-cut-media`; regenerate Android after native or app-config changes.

## Install and verify

Use Node 22 and install from the lockfile. `npm run format` is a formatting check, while
`npm run audit` is SnapCut's prohibited-implementation audit rather than `npm audit`.

```powershell
npm ci
npm run typecheck
npm run lint
npm run cpd
npm test
npm run format
npm run audit
npm run doctor
npx expo prebuild --clean --platform android --no-install
```

Run the native gates from the generated Android project with JDK 17:

```powershell
Push-Location .\android
.\gradlew.bat :snap-cut-media:testDebugUnitTest --stacktrace --no-daemon
.\gradlew.bat :snap-cut-media:verifyMedia3Versions --stacktrace --no-daemon
.\gradlew.bat :snap-cut-media:verifyNativeCodecSources --stacktrace --no-daemon
.\gradlew.bat :app:assembleDebug --stacktrace --no-daemon
.\gradlew.bat :app:assembleRelease --stacktrace --no-daemon
Pop-Location
```

On macOS or Linux, change into `android` and use `./gradlew` with the same tasks. APK outputs are:

```text
android/app/build/outputs/apk/debug/app-debug.apk
android/app/build/outputs/apk/release/app-release.apk
```

These local gates do not replace connected-emulator or physical-device acceptance.

## Debug APK and Metro

SnapCut contains a custom Android module and cannot run in Expo Go. Generate and install the Debug
APK, then start Metro:

```powershell
npx expo prebuild --clean --platform android --no-install
Push-Location .\android
.\gradlew.bat :app:assembleDebug
Pop-Location
adb install -r .\android\app\build\outputs\apk\debug\app-debug.apk
npm start
```

The Debug APK loads JavaScript from Metro. A JavaScript/TypeScript-only change can normally use
Fast Refresh; Kotlin, C/C++, Gradle, native-library, permission, or app-config changes require a
new APK. Do not uninstall during ordinary iteration because uninstalling removes app-private
data.

A locally signed Release APK does not establish production signing or runtime acceptance. A
historical APK does not validate the schema-v9 working tree.

## Verification boundary

Passing TypeScript, Jest, Gradle, or APK assembly proves only its corresponding build or test
contract. It does not prove real-device media behavior. API 29/36 instrumentation, repeated
audio/video and M4A import, waveform completion, ordered playback, exact-range export, pause and
seek races, MediaStore publication, background interruption, near-600 MiB import, 30-minute
export, low-storage handling, memory stability, and overwrite-install behavior require their own
recorded emulator or physical-device results.

## Third-party software

Pinned source provenance, archive hashes, build options, and required licenses are documented in
`THIRD_PARTY_NOTICES.md`. SnapCut builds the required libraries from source and excludes the LAME
frontend and MPGLIB decoder.

## License

SnapCut application code is available under the MIT License. Third-party components retain their
respective licenses.
