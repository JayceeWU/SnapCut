cmake_minimum_required(VERSION 3.22.1)

project(snapcut_codec VERSION 1.0.0 LANGUAGES C CXX)

if(NOT ANDROID)
  message(FATAL_ERROR "snapcut_codec is an Android-only native library")
endif()

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

set(SNAPCUT_THIRD_PARTY_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party")
set(SNAPCUT_FLAC_VERSION "1.5.0" CACHE STRING "Pinned libFLAC source version")
set(SNAPCUT_LAME_VERSION "4.0" CACHE STRING "Pinned LAME source version")
set(
  SNAPCUT_LIBSAMPLERATE_VERSION
  "0.2.2"
  CACHE STRING
  "Pinned libsamplerate source version"
)

if(NOT SNAPCUT_FLAC_VERSION STREQUAL "1.5.0")
  message(FATAL_ERROR "SnapCut requires libFLAC 1.5.0")
endif()
if(NOT SNAPCUT_LAME_VERSION STREQUAL "4.0")
  message(FATAL_ERROR "SnapCut requires LAME 4.0")
endif()
if(NOT SNAPCUT_LIBSAMPLERATE_VERSION STREQUAL "0.2.2")
  message(FATAL_ERROR "SnapCut requires libsamplerate 0.2.2")
endif()

# libFLAC is built from the pinned official source tree. SnapCut only uses the
# library: command-line programs, examples, tests, docs, C++ bindings, Ogg, and
# install/package targets are disabled.
set(BUILD_SHARED_LIBS OFF CACHE BOOL "Build static third-party libraries" FORCE)
set(BUILD_CXXLIBS OFF CACHE BOOL "Do not build libFLAC++" FORCE)
set(BUILD_PROGRAMS OFF CACHE BOOL "Do not build FLAC command-line programs" FORCE)
set(BUILD_EXAMPLES OFF CACHE BOOL "Do not build FLAC examples" FORCE)
set(BUILD_TESTING OFF CACHE BOOL "Do not build third-party tests" FORCE)
set(BUILD_DOCS OFF CACHE BOOL "Do not build FLAC documentation" FORCE)
set(BUILD_UTILS OFF CACHE BOOL "Do not build FLAC utilities" FORCE)
set(WITH_OGG OFF CACHE BOOL "SnapCut does not use Ogg-FLAC" FORCE)
set(WITH_ASM OFF CACHE BOOL "Use portable libFLAC sources" FORCE)
set(INSTALL_MANPAGES OFF CACHE BOOL "Do not install FLAC man pages" FORCE)
set(INSTALL_PKGCONFIG_MODULES OFF CACHE BOOL "Do not install FLAC pkg-config files" FORCE)
set(INSTALL_CMAKE_CONFIG_MODULE OFF CACHE BOOL "Do not install FLAC CMake files" FORCE)
add_subdirectory(
  "${SNAPCUT_THIRD_PARTY_DIR}/flac-${SNAPCUT_FLAC_VERSION}"
  "${CMAKE_CURRENT_BINARY_DIR}/flac-${SNAPCUT_FLAC_VERSION}"
  EXCLUDE_FROM_ALL
)

# libsamplerate's official CMake target is library-only with these switches.
set(LIBSAMPLERATE_EXAMPLES OFF CACHE BOOL "Do not build libsamplerate examples" FORCE)
set(LIBSAMPLERATE_INSTALL OFF CACHE BOOL "Do not install libsamplerate" FORCE)
set(LIBSAMPLERATE_ENABLE_SANITIZERS OFF CACHE BOOL "Sanitizers are controlled by the app" FORCE)
add_subdirectory(
  "${SNAPCUT_THIRD_PARTY_DIR}/libsamplerate-${SNAPCUT_LIBSAMPLERATE_VERSION}"
  "${CMAKE_CURRENT_BINARY_DIR}/libsamplerate-${SNAPCUT_LIBSAMPLERATE_VERSION}"
  EXCLUDE_FROM_ALL
)

# LAME 4.0 does not ship CMake metadata. Keep the encoder target explicit so
# an upstream source update cannot silently add MPGLIB, mpg123, a CLI, NASM,
# or analyzer executables. mpglib_interface.c is deliberately absent. The
# portable fft.c still includes the official vector/lame_intrin.h declaration
# header; no SIMD implementation source is compiled by this target.
set(SNAPCUT_LAME_DIR "${SNAPCUT_THIRD_PARTY_DIR}/lame-${SNAPCUT_LAME_VERSION}")
set(SNAPCUT_LAME_SOURCES
  "${SNAPCUT_LAME_DIR}/libmp3lame/VbrTag.c"
  "${SNAPCUT_LAME_DIR}/libmp3lame/bitstream.c"
  "${SNAPCUT_LAME_DIR}/libmp3lame/encoder.c"
  "${SNAPCUT_LAME_DIR}/libmp3lame/fft.c"
  "${SNAPCUT_LAME_DIR}/libmp3lame/gain_analysis.c"
  "${SNAPCUT_LAME_DIR}/libmp3lame/id3tag.c"
  "${SNAPCUT_LAME_DIR}/libmp3lame/lame.c"
  "${SNAPCUT_LAME_DIR}/libmp3lame/newmdct.c"
  "${SNAPCUT_LAME_DIR}/libmp3lame/presets.c"
  "${SNAPCUT_LAME_DIR}/libmp3lame/psymodel.c"
  "${SNAPCUT_LAME_DIR}/libmp3lame/quantize.c"
  "${SNAPCUT_LAME_DIR}/libmp3lame/quantize_pvt.c"
  "${SNAPCUT_LAME_DIR}/libmp3lame/reservoir.c"
  "${SNAPCUT_LAME_DIR}/libmp3lame/set_get.c"
  "${SNAPCUT_LAME_DIR}/libmp3lame/tables.c"
  "${SNAPCUT_LAME_DIR}/libmp3lame/takehiro.c"
  "${SNAPCUT_LAME_DIR}/libmp3lame/util.c"
  "${SNAPCUT_LAME_DIR}/libmp3lame/vbrquantize.c"
  "${SNAPCUT_LAME_DIR}/libmp3lame/version.c"
)

# LAME is LGPL-2.0-or-later. Build it as its own replaceable shared library
# from source instead of folding it into SnapCut's JNI binary.
add_library(mp3lame SHARED ${SNAPCUT_LAME_SOURCES})
set_target_properties(mp3lame PROPERTIES OUTPUT_NAME "mp3lame")
target_include_directories(mp3lame
  PUBLIC "${SNAPCUT_LAME_DIR}/include"
  PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/lame_android_config"
    "${SNAPCUT_LAME_DIR}/libmp3lame"
)
target_compile_definitions(mp3lame PRIVATE HAVE_CONFIG_H=1)
target_compile_options(mp3lame PRIVATE -ffunction-sections -fdata-sections)
target_link_options(mp3lame PRIVATE "LINKER:--gc-sections")
target_link_libraries(mp3lame PRIVATE m)

add_library(snapcut_codec SHARED
  snapcut_codec_jni.cpp
  export_codec_jni.cpp
)
set_target_properties(snapcut_codec PROPERTIES
  CXX_VISIBILITY_PRESET hidden
  VISIBILITY_INLINES_HIDDEN YES
)
target_compile_options(snapcut_codec PRIVATE
  -Wall
  -Wextra
  -Wpedantic
  -ffunction-sections
  -fdata-sections
  $<$<CONFIG:Debug>:-Werror>
)
target_link_options(snapcut_codec PRIVATE "LINKER:--gc-sections")

find_library(ANDROID_LOG_LIBRARY log REQUIRED)
target_link_libraries(snapcut_codec PRIVATE
  FLAC
  mp3lame
  samplerate
  ${ANDROID_LOG_LIBRARY}
  m
)
