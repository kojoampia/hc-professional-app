import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.abofonsa.bridgecare.professional',
  appName: 'Abofonsa BridgeCare Professional',
  webDir: 'dist/hc-professional-app/browser',
  server: {
    // Explicit, though it is the Capacitor default since v6, because the gateway's
    // CORS allowlist depends on it: Android sends Origin `https://localhost`, NOT
    // `http://localhost`. It is also what makes the WebView a secure context, which
    // `crypto.subtle` (the MOB6 cache encryption) and the camera both require.
    androidScheme: 'https',
  },
  ios: {
    contentInset: 'automatic',
  },
};

export default config;
