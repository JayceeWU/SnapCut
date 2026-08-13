# Third-party notices

SnapCut includes the following source-built native libraries. The pinned
release URLs and SHA-256 checksums are recorded in
`modules/snap-cut-media/android/src/main/cpp/third_party/SOURCES.lock.json`.

## FLAC 1.5.0

- Project: https://xiph.org/flac/
- Source: https://downloads.xiph.org/releases/flac/flac-1.5.0.tar.xz
- Archive SHA-256: `f2c1c76592a82ffff8413ba3c4a1299b6c7ab06c734dee03fd88630485c2b920`
- License: Xiph.org BSD-style license for libFLAC
- License text: `modules/snap-cut-media/android/src/main/cpp/third_party/flac-1.5.0/COPYING.Xiph`

SnapCut builds only the libFLAC library target. FLAC command-line programs,
tests, examples, documentation, C++ bindings, and Ogg support are disabled.

## LAME 4.0

- Project: https://lame.sourceforge.io/
- Source: https://sourceforge.net/projects/lame/files/lame/4.0/lame-4.0.tar.gz/download
- Archive SHA-256: `3df5124d5ad3a98312ffd7ba6a9b36230e4f8a3e66d3ce0f425e336c32d216eb`
- License: GNU Library General Public License, version 2 or later
- License text: `modules/snap-cut-media/android/src/main/cpp/third_party/lame-4.0/COPYING`

SnapCut builds the LAME encoder library from source as a separate shared
library. MPGLIB/mpg123, `mpglib_interface.c`, the command-line frontend, NASM,
and SIMD vector implementation sources are neither vendored nor built. The
official `vector/lame_intrin.h` declaration header required by portable
`fft.c` is retained unchanged. Android configure results are supplied from a
SnapCut-owned build header outside the upstream tree; the vendored LAME files
are not modified.

## libsamplerate 0.2.2

- Project: https://libsndfile.github.io/libsamplerate/
- Source: https://github.com/libsndfile/libsamplerate/releases/download/0.2.2/libsamplerate-0.2.2.tar.xz
- Archive SHA-256: `3258da280511d24b49d6b08615bbe824d0cacc9842b0e4caf11c52cf2b043893`
- License: BSD 2-Clause
- License text: `modules/snap-cut-media/android/src/main/cpp/third_party/libsamplerate-0.2.2/COPYING`

SnapCut builds only the libsamplerate library target. Examples, tests,
documentation installation, and package installation are disabled.
