/**
 * Development, and it points at the **quality stack on jacserver**, not at a gateway on this laptop.
 *
 * <p>That is deliberate and mirrors `hc-patient/mobile`, whose default does the same: quality is what
 * phase acceptance runs against, so it is what you get unless you deliberately change it. Pointing the
 * default at a local gateway means the common case — open the app, sign in, look at real seeded data —
 * requires a running Consul, MongoDB, Kafka, gateway and api first.
 *
 * <p><b>A hostname rather than an IP, and port 80 rather than the gateway's own port.</b> Both matter:
 *
 * <ul>
 *   <li>`professional.abofonsa.local` resolves through LAN DNS to `jacserver` (192.168.1.2). It is in
 *       this workstation's `/etc/hosts` as 127.0.0.1 too, which is a local override — a phone or
 *       emulator on the LAN gets the real address. `professional.healthconnect.local` is the same
 *       vhost under its other name.</li>
 *   <li>The quality gateway and api publish on <b>127.0.0.1</b> only (`15507` and `18090`), so
 *       `http://192.168.1.2:15507/` cannot work from anywhere but jacserver itself. Port 80 goes
 *       through the vhost to the web container, whose nginx proxies `/api`, `/services`, `/management`
 *       and `/auth` on to the gateway — the same hop the browser SPA uses.</li>
 * </ul>
 *
 * <p>There is no `Capacitor.getPlatform()` branch any more. It existed to send the Android emulator to
 * `10.0.2.2` for the host's loopback; a hostname needs no such translation and resolves identically on
 * an emulator, a physical device and a desktop browser. The trap it guarded against is real and is
 * still recorded in `mobile/CLAUDE.md` — it just no longer applies to this default.
 *
 * <p><b>Running a gateway locally instead?</b> Use `http://localhost:5505/` in a desktop browser or the
 * iOS simulator, and `http://10.0.2.2:5505/` from the Android emulator, which is where that branch
 * went. Note that a browser at `http://localhost:4300` is not on the gateway's CORS allowlist and never
 * will be; on a device the Capacitor origin is allowlisted and works.
 */
export const environment = {
  production: false,
  /** Trailing slash required: getEndpointFor() concatenates directly onto it. */
  apiBaseUrl: 'http://professional.abofonsa.local/',
  wsBaseUrl: 'ws://professional.abofonsa.local/websocket/messages',
};
