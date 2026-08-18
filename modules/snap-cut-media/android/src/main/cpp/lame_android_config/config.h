/* Build-generated equivalent configuration for the pinned LAME 4.0
 * encoder-only Android target. This file is intentionally outside the
 * upstream source tree. Optional x86 SSE, MPGLIB, analyzer, NASM and CLI
 * features remain disabled for identical portable behavior on both ABIs. */
#ifndef SNAPCUT_LAME_ANDROID_CONFIG_H
#define SNAPCUT_LAME_ANDROID_CONFIG_H

#define HAVE_ERRNO_H 1
#define HAVE_FCNTL_H 1
#define HAVE_INTTYPES_H 1
#define HAVE_STDINT_H 1
#define HAVE_STDIO_H 1
#define HAVE_STDLIB_H 1
#define HAVE_STRING_H 1
#define HAVE_SYS_STAT_H 1
#define HAVE_SYS_TYPES_H 1
#define HAVE_UNISTD_H 1
#define LAME_LIBRARY_BUILD 1
#define NOANALYSIS 1
#define STDC_HEADERS 1

/* Android's libc does not expose these historical configure typedefs. */
typedef float ieee754_float32_t;
typedef double ieee754_float64_t;

#endif
