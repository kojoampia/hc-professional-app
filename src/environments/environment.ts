/**
 * Production. Unlike `web/`, which is served same-origin and uses a relative
 * prefix (`ApplicationConfigService.endpointPrefix = ''`), a Capacitor app has no
 * origin to be relative to — every URL must be absolute.
 */
export const environment = {
  production: true,
  /** Trailing slash required: getEndpointFor() concatenates directly onto it. */
  apiBaseUrl: 'https://professional.abofonsa.com/',
  /** MOB7 confirms this path against the deployed nginx before wiring STOMP. */
  wsBaseUrl: 'wss://professional.abofonsa.com/websocket/messages',
};
