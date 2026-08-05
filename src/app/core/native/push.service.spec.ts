import { TestBed } from '@angular/core/testing';

import { PushService } from './push.service';

const capacitor = { isNativePlatform: jest.fn(() => true) };
const registered = new Map<string, (payload: unknown) => void>();
const plugin = {
  checkPermissions: jest.fn(async () => ({ receive: 'granted' })),
  requestPermissions: jest.fn(async () => ({ receive: 'granted' })),
  addListener: jest.fn(async (event: string, cb: (payload: unknown) => void) => {
    registered.set(event, cb);
    return { remove: jest.fn() };
  }),
  register: jest.fn(async () => undefined),
  unregister: jest.fn(async () => undefined),
  removeAllListeners: jest.fn(async () => undefined),
  removeAllDeliveredNotifications: jest.fn(async () => undefined),
};

jest.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => capacitor.isNativePlatform() },
}));
jest.mock('@capacitor/push-notifications', () => ({
  PushNotifications: new Proxy(
    {},
    {
      get:
        (_t, prop: string) =>
        (...args: unknown[]) =>
          (plugin as unknown as Record<string, (...a: unknown[]) => unknown>)[prop](...args),
    },
  ),
}));

const callbacks = () => ({
  onToken: jest.fn(),
  onReceived: jest.fn(),
  onActionPerformed: jest.fn(),
});

describe('PushService', () => {
  let service: PushService;

  beforeEach(() => {
    jest.clearAllMocks();
    registered.clear();
    capacitor.isNativePlatform.mockReturnValue(true);
    plugin.checkPermissions.mockResolvedValue({ receive: 'granted' });
    TestBed.configureTestingModule({});
    service = TestBed.inject(PushService);
  });

  describe('on web', () => {
    beforeEach(() => capacitor.isNativePlatform.mockReturnValue(false));

    it('reports itself unsupported instead of throwing', () => {
      // @capacitor/push-notifications has no web implementation — every call throws.
      expect(service.supported).toBe(false);
    });

    it('short-circuits register/unregister/clear so ionic serve and Playwright keep working', async () => {
      await expect(service.register(callbacks())).resolves.toBe(false);
      await service.clearDelivered();
      await service.unregister();

      expect(plugin.checkPermissions).not.toHaveBeenCalled();
      expect(plugin.register).not.toHaveBeenCalled();
      expect(plugin.removeAllDeliveredNotifications).not.toHaveBeenCalled();
    });
  });

  describe('on a native platform', () => {
    it('registers and surfaces the FCM token', async () => {
      const cb = callbacks();
      await expect(service.register(cb)).resolves.toBe(true);

      registered.get('registration')?.({ value: 'fcm-token-123' });

      expect(cb.onToken).toHaveBeenCalledWith('fcm-token-123');
      expect(service.token()).toBe('fcm-token-123');
      expect(service.permission()).toBe('granted');
      expect(plugin.register).toHaveBeenCalled();
    });

    it('asks for permission only when the platform says prompt', async () => {
      await service.register(callbacks());
      expect(plugin.requestPermissions).not.toHaveBeenCalled();

      jest.clearAllMocks();
      plugin.checkPermissions.mockResolvedValueOnce({ receive: 'prompt' });
      await service.register(callbacks());
      expect(plugin.requestPermissions).toHaveBeenCalled();
    });

    it('does not register listeners when permission is denied', async () => {
      plugin.checkPermissions.mockResolvedValueOnce({ receive: 'prompt' });
      plugin.requestPermissions.mockResolvedValueOnce({ receive: 'denied' });

      await expect(service.register(callbacks())).resolves.toBe(false);

      expect(service.permission()).toBe('denied');
      expect(plugin.addListener).not.toHaveBeenCalled();
      expect(plugin.register).not.toHaveBeenCalled();
    });

    it('wires foreground receipt and tap separately — they behave differently', async () => {
      const cb = callbacks();
      await service.register(cb);

      registered.get('pushNotificationReceived')?.({ id: '1' });
      registered.get('pushNotificationActionPerformed')?.({ notification: { id: '1' } });

      expect(cb.onReceived).toHaveBeenCalledWith({ id: '1' });
      expect(cb.onActionPerformed).toHaveBeenCalledWith({ notification: { id: '1' } });
    });

    it('drops listeners and the token on unregister', async () => {
      await service.register(callbacks());
      registered.get('registration')?.({ value: 'fcm-token-123' });

      await service.unregister();

      expect(plugin.removeAllListeners).toHaveBeenCalled();
      expect(plugin.unregister).toHaveBeenCalled();
      expect(service.token()).toBeNull();
    });

    it('clears the tray on demand', async () => {
      await service.clearDelivered();
      expect(plugin.removeAllDeliveredNotifications).toHaveBeenCalled();
    });
  });
});
