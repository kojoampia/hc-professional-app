import { TestBed } from '@angular/core/testing';

import { NetworkService } from './network.service';

const listeners: ((status: { connected: boolean }) => void)[] = [];
const remove = jest.fn(async () => undefined);
const plugin = {
  getStatus: jest.fn(async () => ({ connected: true, connectionType: 'wifi' })),
  addListener: jest.fn(async (_event: string, cb: (s: { connected: boolean }) => void) => {
    listeners.push(cb);
    return { remove };
  }),
};

jest.mock('@capacitor/network', () => ({
  Network: {
    getStatus: (...a: unknown[]) => plugin.getStatus(...(a as [])),
    addListener: (...a: unknown[]) => plugin.addListener(...(a as [never, never])),
  },
}));

describe('NetworkService', () => {
  let service: NetworkService;

  beforeEach(() => {
    jest.clearAllMocks();
    listeners.length = 0;
    plugin.getStatus.mockResolvedValue({ connected: true, connectionType: 'wifi' });
    TestBed.configureTestingModule({});
    service = TestBed.inject(NetworkService);
  });

  it('defaults to connected so a first paint is never blocked on a plugin round-trip', () => {
    expect(service.connected()).toBe(true);
  });

  it('adopts the initial platform status', async () => {
    plugin.getStatus.mockResolvedValue({ connected: false, connectionType: 'none' });
    await service.initialize();
    expect(service.connected()).toBe(false);
  });

  it('tracks status changes after initialize()', async () => {
    await service.initialize();

    listeners[0]({ connected: false });
    expect(service.connected()).toBe(false);

    listeners[0]({ connected: true });
    expect(service.connected()).toBe(true);
  });

  it('registers exactly one listener even if initialize() is called repeatedly', async () => {
    await service.initialize();
    await service.initialize();
    expect(plugin.addListener).toHaveBeenCalledTimes(1);
  });

  it('re-reads status on refresh()', async () => {
    plugin.getStatus.mockResolvedValue({ connected: false, connectionType: 'none' });
    await expect(service.refresh()).resolves.toBe(false);
    expect(service.connected()).toBe(false);
  });

  it('removes the listener on destroy()', async () => {
    await service.initialize();
    await service.destroy();
    expect(remove).toHaveBeenCalled();

    await service.initialize();
    expect(plugin.addListener).toHaveBeenCalledTimes(2);
  });
});
