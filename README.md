# SnapCut

SnapCut is an offline Android audio editor for arranging precise ranges from local audio and
video on a two-track timeline. It keeps imported working media in the app's private storage,
renders interactive waveforms, previews overlapping clips, and exports M4A, FLAC, or MP3 without
sending media to a server.

> **Engineering status:** the current working tree targets the schema-v6 fixed-center editor
> revision. Its local JavaScript, Kotlin, native-codec, and Debug APK gates pass; connected
> emulator and physical-device acceptance has not yet passed for this revision. See
> [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) for the exact verification boundary;
> source or compilation alone is not treated as proof that a native media path works at runtime.

## What it does

- Imports one local M4A/AAC, MP3, FLAC, WAV, supported MP4 audio track, or self-contained M4S
  source at a time through Android's system document picker.
- Treats picker MIME types, names, extensions, and reported sizes as hints; Android media tracks
  and decoder availability are authoritative.
- Creates an application-private working source before a project references the media.
- Commits each imported source and its full-length timeline Clip together. The first Clip starts
  at zero on Track 1; later imports also append to Track 1 and can then be dragged to Track 2. After
  the committed project is reloaded successfully, the import progress modal closes automatically
  and the new Clip appears.
- Generates an 8,192-bin RMS/peak waveform without transferring PCM or media bytes into
  JavaScript.
- Presents the composition in a fixed `248dp` editor stage: an `80dp` upper scrub/ruler zone, two
  permanently visible `56dp` tracks, and a `56dp` lower scrub zone. A fixed red playhead stays at
  the exact horizontal center while the ruler, waveforms, and Clips move below it.
- Uses the upper and lower zones only for tap/scrub positioning. Scrubbing pauses immediately and
  never resumes automatically. Inside a track, dragging moves or changes the track of a Clip and
  does not change playback time; white edge handles trim the source range directly.
- Uses an overview bar below the tracks as the only viewport control. Its two handles resize the
  visible interval, its body moves that interval, and a tap recenters it. The default visible span
  is 30 seconds, the minimum is 1 second, and the main stage has no pinch-to-zoom gesture.
- Supports split, delete, per-Clip gain from 0% to 100%, and independent equal-power fade-in and
  fade-out operations. Volume uses one inline slider; Fade uses two inline sliders in 0.5-second
  steps from 0 through 6 seconds. Fade-in plus fade-out cannot exceed the Clip duration.
- Allows silent gaps and cross-track overlap while preventing overlap within one track. Editing
  operations have a 50-step session-only Undo/Redo history; imported Sources remain available
  when their automatically added Clip is undone.
- Keeps Rename and Delete on the project list. The editor has no project overflow menu, and its
  selected-Clip action rail contains one icon and one label for Volume, Fade, Split, and Delete.
- Uses up to two synchronized native Media3 ExoPlayer instances, one per track, for composition
  preview. Pause is an explicit revisioned command: the UI freezes immediately, stale load/play/
  seek results cannot revive playback, and preview and decoded export apply the same Clip timing,
  gain, and fade envelope.
- Exports one composition as:
  - `M4A · No re-encoding` when a contiguous, non-overlapping sequence uses compatible AAC,
    unity gain, no fades, and safely aligned access-unit boundaries;
  - `M4A · Re-encoded AAC` when the timeline requires mixing or processing, using AAC-LC at
    320 kbps stereo or 160 kbps mono when the device exposes the required encoder;
  - 24-bit FLAC through one continuous encoder; or
  - 320 kbps CBR MP3 through one continuous encoder.

FLAC, MP3, and re-encoded M4A share a bounded streaming two-track PCM mixer. They do not create a
full temporary WAV composition. Overlapping tracks are summed after per-Clip gain and equal-power
fades; values outside the valid PCM range are hard-clamped and the UI warns when overlap may clip.

Converting AAC or MP3 input to FLAC does not restore information already lost by the source
codec. MP3 output is not bit-perfect.

## Architecture

```text
Expo Router / React Native / strict TypeScript
        │  project state, clips, UI, Zod contracts
        ▼
SnapCutMedia local Expo Module (Kotlin)
        │  opaque content URI, inspection, bounded I/O, waveform, two-track preview/export
        ├── Android MediaExtractor / MediaCodec / MediaMuxer
        ├── Media3 ExoPlayer 1.10.1 (at most one player per track)
        └── JNI: libFLAC 1.5.0 / LAME 4.0 / libsamplerate 0.2.2
```

Media bytes, decoded PCM, transcoding, waveform accumulation, and export encoding stay native.
Production code does not use Expo Go, `expo-audio`, `expo-av`, FFmpeg, JavaScript media
processing, Base64 media transfer, a network service, or broad Android storage permissions.

## Local-file safety

The selected `content://` URI is a short-lived capability, not a file path:

- `SnapCutMedia` opens Android's single-file `ACTION_OPEN_DOCUMENT` picker. It requests audio,
  video, `application/octet-stream`, and `video/iso.segment` candidates without requesting broad
  storage or media-library access.
- JavaScript never converts it to a “real path” and never reads, copies, deletes, or logs it.
- Native code opens it through `ContentResolver`; file names, query tokens, and raw URIs are not
  written to diagnostics.
- Unknown or contradictory source size metadata is verified with a cancellable 64 KiB,
  limit-plus-one stream. Exactly 600 MiB is accepted; one additional byte is rejected.
- A non-seekable provider may be spooled once into bounded app-private staging.
- Failed or cancelled work removes only SnapCut-owned partial files. The provider source is never
  modified or deleted.
- Projects persist only private relative media paths and validated media metadata, so deleting the
  original source after import does not break a committed project.
- Opening the system picker may temporarily pause the host Activity. That picker stage remains
  alive; once native media processing starts, backgrounding cancels the active job safely.
- Staging output is verified with a fresh native extractor or decoder. It is never attached to the
  preview player, and every private output URI is compared using the original URI string.

Names, extensions, picker MIME values, and picker-reported sizes are hints only. A renamed MP3 or
M4A file with an `.m4s` suffix is identified from its media track. A genuine fragmented M4S that
lacks initialization metadata is rejected with a stable error instead of being guessed or joined
to another file.

Project visibility is transactional: validated media and metadata are committed before
`project.json`, which is the visibility point. Recovery uses valid committed metadata first, then
a valid backup, and promotes a temporary file only when a transaction journal proves completion.

## Storage

App-owned data is stored below `Documents/SnapCut` in the application sandbox:

```text
Documents/SnapCut/
├── index.json                    # rebuildable cache
├── diagnostics.json              # bounded, redacted local log
├── projects/<project-id>/
│   ├── project.json
│   └── sources/<source-id>/
│       ├── source.json
│       ├── source.m4a|mp3|flac|wav
│       └── waveform.json
└── staging/.import-<job-id>/     # app-owned transactional partials
```

Completed exports are published through Android MediaStore under `Music/SnapCut` and can be
shared with a temporary read grant.

## Theme

SnapCut uses a fixed dark purple interface derived from TempoLoop's semantic color system while
retaining its own name and iconography. Tokens are centralized in
`src/constants/theme.ts`; the primary button uses dark `#120A24` text on `#A970FF` for normal-text
contrast.

## Requirements

- Node.js 22.13 or newer within Node 22 (Node 23/24 is outside the checked project engine range)
- npm with the committed lockfile
- JDK 17
- Android SDK 36 and Build Tools 36.0.0
- Android NDK 27.1 and CMake 3.22.1
- Android 10 (API 29) or newer

The committed dependency baseline is Expo `57.0.13`, React Native `0.86.2`, React `19.2.3`, and
Media3 `1.10.1`. Native codecs are built from pinned source: libFLAC `1.5.0`, LAME `4.0`, and
libsamplerate `0.2.2`. `npm ci` installs the exact JavaScript dependency graph from
`package-lock.json`.

The generated root `android/` directory is intentionally ignored. Native source belongs in
`modules/snap-cut-media`; regenerate the Android project after native or app-config changes.

## Install and verify

Use Node 22 and install from the lockfile. `npm run format` is a formatting check, while
`npm run audit` is SnapCut's prohibited-implementation audit (it is not `npm audit`).

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

Run native tests and builds from the generated Android project with JDK 17:

```powershell
Push-Location .\android
.\gradlew.bat :snap-cut-media:testDebugUnitTest --stacktrace --no-daemon
.\gradlew.bat :snap-cut-media:verifyMedia3Versions --stacktrace --no-daemon
.\gradlew.bat :snap-cut-media:verifyNativeCodecSources --stacktrace --no-daemon
.\gradlew.bat :app:assembleDebug --stacktrace --no-daemon
Pop-Location
```

On macOS or Linux, change into `android` and use `./gradlew` with the same tasks. During active
iteration, the only APK output to deliver is
`android/app/build/outputs/apk/debug/app-debug.apk`.

## Development APK

SnapCut contains a custom Android module and cannot run in Expo Go.

For local Android development, generate and install a Debug APK, then start Metro:

```powershell
npx expo prebuild --clean --platform android --no-install
Push-Location .\android
.\gradlew.bat :app:assembleDebug
Pop-Location
# Install app-debug.apk with Android Studio or: adb install -r .\android\app\build\outputs\apk\debug\app-debug.apk
npm start
```

For an EAS Development APK, log in and link this independent project once before its first cloud
build (`npx eas-cli@latest login`, then `npx eas-cli@latest init`):

Because the Expo configuration is TypeScript, EAS may print a new project ID without editing
`app.config.ts`. In that case, add the returned ID as `extra.eas.projectId` and add the owning Expo
account as `owner`, then verify with `npx eas-cli@latest project:info`. Never reuse a TempoLoop
project ID or Android keystore.

```powershell
npx eas-cli@latest build --platform android --profile development
npx expo start --dev-client
```

The Development APK loads JavaScript from Metro. If the phone cannot reach the computer over the
LAN, use a tunnel or Android Debug Bridge port reversal. Any Kotlin, C/C++, Gradle, native-library,
permission, or app-config change requires a new APK; Fast Refresh is sufficient only for
JavaScript/TypeScript changes.

## Release and Preview APKs after finalization

Do not run or deliver a Release or Preview build while this revision is still being iterated. The
current delivery contract is Debug-only until the user explicitly says SnapCut is finalized. The
commands below are retained for that later acceptance stage, not for routine revision testing.

A local Release APK embeds the JavaScript bundle and does not require Metro at runtime:

```powershell
npm ci
npx expo prebuild --clean --platform android --no-install
$env:NODE_ENV = 'production'
Push-Location .\android
.\gradlew.bat :app:assembleRelease --stacktrace --no-daemon
Pop-Location
```

The generated Expo Android project signs this local Release build with its generated development
key unless you deliberately configure another signing identity. Treat it as an internal test APK.
An APK can replace an installed copy and preserve private projects only when both the package ID
and signing key match.

The EAS Preview profile is the recommended independently installable daily-use build:

```powershell
npx eas-cli@latest build --platform android --profile preview
```

Preview embeds the JavaScript bundle and is intended to start without Metro or internet access.
Remote Expo updates are disabled. The cloud build itself requires internet access; the installed
APK does not. Keep the application ID `com.snapcut.app`, EAS project, and Android keystore
unchanged, then install updates over the existing app to preserve private projects. Do not
uninstall as part of a normal update.

To record an offline acceptance result, install the Release or Preview APK, stop Metro, force-stop
SnapCut, enable airplane mode, and launch it again. Verify project discovery, local picker import,
selection/composition preview, one available export path, and reopening the exported file. Record
the device/API level and result in `IMPLEMENTATION_STATUS.md`; a successful build alone is not an
offline runtime test.

## Quality and verification boundary

The current schema-v6 gate set covers the Node 22 quality suite, regenerated Android project,
Kotlin unit tests, Media3/native-source gates, and a Debug APK built with JDK 17. Release and
Preview packaging remain deferred until explicit finalization. A separate manually dispatched
instrumentation workflow targets x86_64 API 29 and API 36 emulators. Workflow configuration is
not recorded as a passing result until the corresponding GitHub run completes.

`IMPLEMENTATION_STATUS.md` records which implementation phases and local gates have actually
passed. Physical-device results are recorded separately; emulator, Jest, and Gradle success must
not be reported as proof of near-600 MiB import, 30-minute export, phone-call/headset interruption,
low-storage behavior, memory targets, overwrite-install retention, or EAS Preview behavior.

## Third-party software

Pinned source provenance, archive hashes, build options, and required licenses are documented in
`THIRD_PARTY_NOTICES.md`. SnapCut builds the required libraries from source and excludes the FLAC
command-line tools, LAME frontend, and MPGLIB decoder.

## License

SnapCut application code is available under the MIT License. Third-party components retain their
respective licenses.
