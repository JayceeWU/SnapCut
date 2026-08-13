# SnapCut implementation notes

This file records approved changes to the original technical guide and implementation decisions
that must remain visible during review. It does not record a validation result; those belong in
`IMPLEMENTATION_STATUS.md`.

## Approved implementation-contract revisions

- SnapCut uses the TempoLoop-inspired deep-purple semantic color system while retaining its own
  name and iconography. Primary accent buttons use `#120A24` text on `#A970FF` to meet
  normal-text contrast requirements.
- All Media3 artifacts use the approved stable `1.10.1` baseline instead of the guide's `1.11.0`
  baseline. Release-candidate artifacts and dynamic Gradle versions are not used.
- The native `SnapCutMedia` module owns the single-file `ACTION_OPEN_DOCUMENT` picker instead of
  `expo-document-picker`. This lets one owner control opaque URI lifetime, provider metadata,
  `.m4s` MIME fallbacks, cancellation, and Activity-result cleanup. No broad gallery or storage
  permission is added.
- FLAC is accepted as a source when Android exposes one supported mono/stereo decodable audio
  track. As with every source type, its filename, extension, and picker MIME remain hints only.
- External picker URIs are transient opaque capabilities. Native import materializes and validates
  app-private media before project commit; projects never persist a provider URI as their media
  dependency. The original display name is not persisted as source metadata; the UI uses a
  non-sensitive generic source label.
- Inspection requests carry an internal `jobId` and `generation` in addition to the source URI and
  size limit. This makes inspection cancellable and lets late native results be rejected without
  persisting provider capability data.
- Showing `ACTION_OPEN_DOCUMENT` temporarily pauses the host Activity. App lifecycle handling
  therefore keeps the picker stage alive and cancels only after native media processing has
  started.
- Unknown, zero, negative, or contradictory provider sizes are checked with a cancellable 64 KiB
  `limit + 1` stream instead of being rejected only because metadata is unavailable. Exactly
  600 MiB is allowed and the next byte fails with `SOURCE_TOO_LARGE`.
- Stable revised error names include `SOURCE_UNREADABLE`, `SOURCE_TOO_LARGE`, and
  `M4S_INIT_MISSING`. TypeScript may map legacy guide names to these values at the UI boundary,
  but production native results use the revised names.
- Caller-provided private output URIs are canonicalized for containment and symlink safety, but a
  successful native result echoes the original URI string verbatim. This avoids treating `file:/`
  and `file:///` spellings as different transaction outputs.
- Recovery precedence is valid final metadata, then valid backup, then a temporary file only when
  its journal, media size/hash, target state, and missing staging state prove that commit finished.
  Damaged committed projects remain visible as repair/corrupt entries and are never deleted
  automatically.
- Import and export staging media are verified with fresh native extractors/codecs and are never
  attached to the preview player. The singleton preview player loads committed app-private media
  only and must release a matching source before deletion.
- JavaScript never opens, copies, hashes, decodes, or Base64-encodes provider media. All media bytes
  remain in bounded native streams or app-private native staging files.
- SnapCut keeps its generated root Android project out of version control. Native verification
  regenerates it with Expo prebuild and then runs Gradle with JDK 17.
- Expo and React Native's current Metro/configuration dependency graph reports upstream npm
  advisories for `image-size@1.2.1` and `uuid@7.0.3`. npm only offers breaking downgrades outside
  the SDK 57 baseline as automatic fixes, so the lockfile is kept intact pending compatible
  upstream releases. SnapCut never passes untrusted user media to Metro's build-time image parser,
  and it does not call the affected UUID v3/v5/v6 buffer APIs in production.

## Delivery configuration

- Remote Expo updates are disabled. Development APKs use Metro; Preview and local Release APKs
  embed their JavaScript bundle.
- EAS configuration contains only internal Development and Preview APK profiles. Account/project
  linking, cloud credentials, and EAS build results must remain `Not initialized/tested` until
  they are actually created or executed.
- EAS uses a remote Android version source. The first cloud build initializes remote versioning
  from the local `versionCode`; later EAS builds increment the remote value even though local
  Gradle builds continue to use the app-config value.
- A same-package APK preserves app-private projects only when it is signed by the same Android
  keystore. Local generated Release builds and EAS builds must not be treated as interchangeable
  unless their signing identity is deliberately aligned.
