import { Capacitor } from '@capacitor/core';

/**
 * The Android emulator cannot see the host's `localhost` — the host loopback is
 * mapped to 10.0.2.2 inside the emulator. The iOS simulator shares the host's
 * network stack, so `localhost` is correct there and in a desktop browser.
 * Getting this wrong is a classic day-one time sink; see mobile/CLAUDE.md.
 */
const host = Capacitor.getPlatform() === 'android' ? '10.0.2.2' : 'localhost';

export const environment = {
  production: false,
  apiBaseUrl: `http://${host}:5505/`,
  wsBaseUrl: `ws://${host}:5505/websocket/messages`,
};
