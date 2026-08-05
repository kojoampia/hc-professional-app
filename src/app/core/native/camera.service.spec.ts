import { TestBed } from '@angular/core/testing';

import { CameraService } from './camera.service';

const plugin = {
  getPhoto: jest.fn(async () => ({ webPath: 'blob:x', format: 'jpeg', saved: false })),
  checkPermissions: jest.fn(async () => ({ camera: 'granted', photos: 'granted' })),
  requestPermissions: jest.fn(async () => ({ camera: 'granted', photos: 'granted' })),
};

jest.mock('@capacitor/camera', () => ({
  Camera: {
    getPhoto: (...a: unknown[]) => plugin.getPhoto(...(a as [])),
    checkPermissions: (...a: unknown[]) => plugin.checkPermissions(...(a as [])),
    requestPermissions: (...a: unknown[]) => plugin.requestPermissions(...(a as [])),
  },
  CameraResultType: { Uri: 'uri', Base64: 'base64', DataUrl: 'dataUrl' },
  CameraSource: { Prompt: 'PROMPT', Camera: 'CAMERA', Photos: 'PHOTOS' },
}));

describe('CameraService', () => {
  let service: CameraService;

  beforeEach(() => {
    jest.clearAllMocks();
    TestBed.configureTestingModule({});
    service = TestBed.inject(CameraService);
  });

  it('requests a URI result, never base64', async () => {
    // Base64 inflates a capture ~3x in memory on a low-end handset.
    await service.capture();
    expect(plugin.getPhoto).toHaveBeenCalledWith(expect.objectContaining({ resultType: 'uri' }));
  });

  it('corrects orientation and caps the long edge, so licences are not sideways or huge', async () => {
    await service.capture();
    expect(plugin.getPhoto).toHaveBeenCalledWith(expect.objectContaining({ correctOrientation: true, width: 2000 }));
  });

  it('lets the user pick camera or library', async () => {
    await service.capture();
    expect(plugin.getPhoto).toHaveBeenCalledWith(expect.objectContaining({ source: 'PROMPT' }));
  });

  it('does not re-prompt when permissions are already granted', async () => {
    await expect(service.ensurePermissions()).resolves.toBe(true);
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
  });

  it('requests permissions when the platform reports prompt', async () => {
    plugin.checkPermissions.mockResolvedValueOnce({ camera: 'prompt', photos: 'prompt' });
    await expect(service.ensurePermissions()).resolves.toBe(true);
    expect(plugin.requestPermissions).toHaveBeenCalled();
  });

  it('reports false when the user denies', async () => {
    plugin.checkPermissions.mockResolvedValueOnce({ camera: 'prompt', photos: 'prompt' });
    plugin.requestPermissions.mockResolvedValueOnce({ camera: 'denied', photos: 'denied' });
    await expect(service.ensurePermissions()).resolves.toBe(false);
  });
});
