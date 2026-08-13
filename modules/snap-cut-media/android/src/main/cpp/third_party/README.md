# Pinned native codec sources

`SOURCES.lock.json` records the official release URL, archive byte size, and
SHA-256 for every vendored dependency. The values were computed from the
downloaded release archives before extraction. Each entry also pins a
deterministic SHA-256 over every vendored relative path and file byte, so
post-extraction changes fail the build gate. No prebuilt `.so`, `.a`, AAR, or
unofficial mirror artifact is accepted by the Gradle verification task.

The FLAC and libsamplerate directories come from their complete official
release archives. Build flags keep only their library targets in the Android
graph. LAME intentionally contains only the public/internal headers and
encoder-library sources needed by the explicit CMake target. This includes the
official `vector/lame_intrin.h` declaration header referenced unconditionally
by portable `fft.c`; SIMD implementation sources remain excluded. In
particular, MPGLIB/mpg123, `mpglib_interface.c`, CLI/frontend, and NASM are
absent. Android configure results live outside the upstream tree in
`../lame_android_config/config.h`.

LAME is built from source as a separate shared library so it remains
replaceable under LGPL-2.0-or-later. SnapCut's JNI library dynamically links
that build; libFLAC and libsamplerate use their permissive licenses and are
linked statically.
