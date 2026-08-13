# SnapCut

SnapCut is an offline Android audio editor for arranging precise ranges from local audio and
video into a new composition. It keeps imported working media in the app's private storage,
renders an interactive waveform, previews selections and clip order, and exports M4A, FLAC, or
MP3 without sending media to a server.

> **Engineering status:** the version 1 code and local automated Android builds are complete.
> Connected emulator, offline-install, EAS, and physical-device acceptance remain pending. See
> [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) for the exact verification boundary;
> compiled source is not treated as proof that a native media path passed runtime validation.

## What it does

- Imports one local M4A/AAC, MP3, FLAC, WAV, supported MP4 audio track, or self-contained M4S
  source at a time through Android's system document picker.
- Treats picker MIME types, names, extensions, and reported sizes as hints; Android media tracks
  and decoder availability are authoritative.
- Creates an application-private working source before a project references the media.
- Generates an 8,192-bin RMS/peak waveform without transferring PCM or media bytes into
  JavaScript.
- Supports non-destructive clip add, edit, duplicate, delete, and reorder operations. Source
  ranges may overlap and may be reused.
- Uses one native Media3 ExoPlayer for selection and composition preview.
- Exports one composition as:
  - M4A stream copy when every selected AAC source is compatible and clip boundaries can be
    aligned safely;
  - 24-bit FLAC through one continuous encoder; or
  - 320 kbps CBR MP3 through one continuous encoder.

Converting AAC or MP3 input to FLAC does not restore information already lost by the source
codec. MP3 output is not bit-perfect.

## Architecture

```text
Expo Router / React Native / strict TypeScript
        │  project state, clips, UI, Zod contracts
        ▼
SnapCutMedia local Expo Module (Kotlin)
        │  opaque content URI, inspection, bounded I/O, waveform, preview, export
        ├── Android MediaExtractor / MediaCodec / MediaMuxer
        ├── Media3 ExoPlayer 1.10.1
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

The committed dependency baseline is Expo `57.0.12`, React Native `0.86.2`, React `19.2.3`, and
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
.\android\gradlew.bat :snap-cut-media:testDebugUnitTest --stacktrace --no-daemon
.\android\gradlew.bat :snap-cut-media:verifyMedia3Versions --stacktrace --no-daemon
.\android\gradlew.bat :snap-cut-media:verifyNativeCodecSources --stacktrace --no-daemon
.\android\gradlew.bat :app:assembleDebug :app:assembleRelease --stacktrace --no-daemon
```

On macOS or Linux, use `./android/gradlew` with the same tasks. The local outputs are generated at
`android/app/build/outputs/apk/debug/app-debug.apk` and
`android/app/build/outputs/apk/release/app-release.apk`.

## Development APK

SnapCut contains a custom Android module and cannot run in Expo Go.

For local Android development, generate and install a Debug APK, then start Metro:

```powershell
npx expo prebuild --clean --platform android --no-install
.\android\gradlew.bat :app:assembleDebug
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

## Offline Release and Preview APKs

A local Release APK embeds the JavaScript bundle and does not require Metro at runtime:

```powershell
npm ci
npx expo prebuild --clean --platform android --no-install
$env:NODE_ENV = 'production'
.\android\gradlew.bat :app:assembleRelease --stacktrace --no-daemon
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

The main GitHub Actions workflow is configured to run the Node 22 quality suite, regenerate
Android, run Kotlin unit tests plus Media3/native-source gates, and compile Debug plus minified
Release APKs with JDK 17. A separate manually dispatched instrumentation workflow targets
x86_64 API 29 and API 36 emulators. Workflow configuration is not recorded as a passing result
until the corresponding GitHub run completes.

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
