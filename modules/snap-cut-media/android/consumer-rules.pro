-keep class expo.modules.snapcutmedia.SnapCutMediaModule { *; }
-keep class expo.modules.snapcutmedia.codec.NativeCodecBridge { *; }
-keep class expo.modules.snapcutmedia.export.NativeExportCodecBridge { *; }
-keepclasseswithmembernames,includedescriptorclasses class * {
    native <methods>;
}
