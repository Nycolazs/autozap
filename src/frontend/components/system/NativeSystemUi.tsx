'use client';

// Legacy mobile-webview status bar integration was removed after migrating to Expo React Native.
// This component remains as a no-op to preserve layout compatibility on web/desktop routes.
export function NativeSystemUi() {
  return null;
}
