const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      '.expo/**',
      'coverage/**',
      'copypaste/**',
      'dist/**',
      'android/**',
      'ios/**',
      'modules/**/android/build/**',
    ],
  },
]);
