import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'SnapCut',
  slug: 'snapcut',
  scheme: 'snapcut',
  version: '1.0.0',
  orientation: 'portrait',
  platforms: ['android'],
  userInterfaceStyle: 'dark',
  newArchEnabled: true,
  icon: './assets/images/snapcut-icon.png',
  updates: {
    enabled: false,
  },
  android: {
    package: 'com.snapcut.app',
    versionCode: 3,
    adaptiveIcon: {
      foregroundImage: './assets/images/snapcut-adaptive-foreground.png',
      backgroundColor: '#120A24',
    },
    blockedPermissions: [
      'android.permission.CAMERA',
      'android.permission.RECORD_AUDIO',
      'android.permission.MANAGE_EXTERNAL_STORAGE',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.READ_MEDIA_AUDIO',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
      'android.permission.ACCESS_MEDIA_LOCATION',
      'android.permission.SYSTEM_ALERT_WINDOW',
    ],
  },
  plugins: [
    'expo-router',
    'expo-sharing',
    [
      'expo-splash-screen',
      {
        image: './assets/images/snapcut-splash.png',
        imageWidth: 160,
        resizeMode: 'contain',
        backgroundColor: '#120A24',
        dark: {
          backgroundColor: '#120A24',
        },
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          minSdkVersion: 29,
          compileSdkVersion: 36,
          targetSdkVersion: 36,
          buildToolsVersion: '36.0.0',
          buildArchs: ['arm64-v8a', 'x86_64'],
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
