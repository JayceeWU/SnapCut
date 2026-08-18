# SnapCut connected Android tests

Canonical module task from `android/`:

```text
.\gradlew.bat :snap-cut-media:connectedDebugAndroidTest
```

The test APK registers a non-exported `ContentProvider` with the fixed authority
`expo.modules.snapcutmedia.test.fixtures`. It can return seekable files or non-seekable pipes,
independent cursor/asset/stat sizes, delayed streams, revoked access, missing names and missing
MIME values. Provider URI/query values are never written to diagnostics.

Runtime media coverage is intentionally small and explicit:

- `RuntimeMediaFixtures.pcmWav` is a generated, legal 250 ms PCM WAV and is passed through the
  platform extractor plus the full WAV import/verification path.
- A short codec-valid MP3 is generated on-device through SnapCut's pinned production LAME bridge.
  The provider exposes those bytes with a `.m4s` display name and `video/iso.segment` MIME; the
  connected test verifies that platform extractor content still classifies it as MP3.
- `fragmentWithoutInitialization` has a standards-shaped styp/moof/mdat box layout and no moov.
  Its payload is not claimed to be a codec-valid AAC sample; it verifies deterministic
  `M4S_INIT_MISSING` classification only.

The 600 MiB boundary itself stays in local `SourceSizePolicyTest`; connected tests exercise the
same bounded-reader sentinel behavior with a 128 KiB exact-limit pipe and a 128 KiB + 1 byte pipe
so the suite remains suitable for API 29 and API 36 emulators.
