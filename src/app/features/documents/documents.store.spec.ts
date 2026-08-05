import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';

import { OnboardingApiService } from '../../core/api/onboarding-api.service';
import { ImageCompressor } from '../../core/media/image-compressor';
import { CameraService } from '../../core/native/camera.service';
import { PreferencesService } from '../../core/native/preferences.service';
import { CacheStore } from '../../core/offline/cache-store.service';
import { DocumentsStore, SERVER_MAX_BYTES } from './documents.store';

const disk = new Map<string, unknown>();
jest.mock('idb-keyval', () => ({
  get: jest.fn(async (key: string) => disk.get(key)),
  set: jest.fn(async (key: string, value: unknown) => void disk.set(key, value)),
  del: jest.fn(async (key: string) => void disk.delete(key)),
  keys: jest.fn(async () => [...disk.keys()]),
  clear: jest.fn(async () => disk.clear()),
}));

describe('DocumentsStore', () => {
  let store: DocumentsStore;
  let api: { myDocuments: jest.Mock; uploadDocument: jest.Mock };
  let camera: { capture: jest.Mock };
  let compressor: { compress: jest.Mock };

  const uploadEvents = (): Observable<{ fraction: number | null; done: boolean; document: unknown }> =>
    of(
      { fraction: 0.5, done: false, document: null },
      { fraction: 1, done: true, document: { id: 'd9', type: 'LICENSE', verificationStatus: 'PENDING' } },
    );

  beforeEach(async () => {
    disk.clear();
    global.fetch = jest.fn(async () => ({ blob: async () => new Blob([new Uint8Array(9_000_000)]) })) as never;

    api = {
      myDocuments: jest.fn(() => of([{ id: 'd1', type: 'LICENSE', verificationStatus: 'VERIFIED', expiryDate: '2027-01-01' }])),
      uploadDocument: jest.fn(() => uploadEvents()),
    };
    camera = { capture: jest.fn(async () => ({ webPath: 'blob:photo', format: 'jpeg' })) };
    compressor = {
      compress: jest.fn(async () => ({
        blob: new Blob([new Uint8Array(1_200_000)], { type: 'image/jpeg' }),
        width: 2000,
        height: 1500,
        quality: 0.85,
        overTarget: false,
      })),
    };

    const prefs = new Map<string, string>();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: OnboardingApiService, useValue: api },
        { provide: CameraService, useValue: camera },
        { provide: ImageCompressor, useValue: compressor },
        {
          provide: PreferencesService,
          useValue: {
            get: async (key: string) => prefs.get(key) ?? null,
            set: async (key: string, value: string) => void prefs.set(key, value),
          },
        },
      ],
    });
    await TestBed.inject(CacheStore).initialize('nurse');
    store = TestBed.inject(DocumentsStore);
  });

  describe('capture and upload', () => {
    it('ALWAYS re-encodes the capture before uploading', async () => {
      // Not an optimisation: the re-encode is what guarantees image/jpeg for the
      // server's magic-byte check, converts HEIC, strips EXIF/GPS and fixes
      // orientation. Uploading photo.webPath directly would skip all four.
      await store.captureAndUpload('CERTIFICATE');

      expect(compressor.compress).toHaveBeenCalled();
      expect(api.uploadDocument).toHaveBeenCalledWith(expect.objectContaining({ type: 'CERTIFICATE', filename: 'certificate.jpg' }));
    });

    it('uploads the COMPRESSED blob, not the original', async () => {
      await store.captureAndUpload('CERTIFICATE');

      const uploaded = api.uploadDocument.mock.calls[0][0].file as Blob;
      expect(uploaded.size).toBe(1_200_000);
      expect(uploaded.type).toBe('image/jpeg');
    });

    it('reports progress and then success', async () => {
      await store.captureAndUpload('CERTIFICATE');
      expect(store.upload().stage).toBe('done');
    });

    it('refuses to upload when even the lowest quality is too large', async () => {
      compressor.compress.mockResolvedValue({
        blob: new Blob([new Uint8Array(8_000_000)]),
        width: 2000,
        height: 1500,
        quality: 0.4,
        overTarget: true,
      });

      await store.captureAndUpload('CERTIFICATE');

      expect(api.uploadDocument).not.toHaveBeenCalled();
      expect(store.upload().stage).toBe('error');
      // The message must be actionable, not a byte count.
      expect(store.upload().message).toContain('background');
    });

    it('explains an undecodable image rather than surfacing a decode error', async () => {
      // An Android WebView asked to decode a HEIC synced from an iPhone, typically.
      compressor.compress.mockRejectedValue(new Error('decode failed'));

      await store.captureAndUpload('CERTIFICATE');

      expect(store.upload().stage).toBe('error');
      expect(store.upload().message).toContain('Could not read that image');
    });

    it('passes the licence expiry through, which the server requires', async () => {
      await store.captureAndUpload('LICENSE', { expiryDate: '2027-03-01' });

      expect(api.uploadDocument).toHaveBeenCalledWith(expect.objectContaining({ expiryDate: '2027-03-01' }));
    });

    it('surfaces an upload failure without losing the error', async () => {
      api.uploadDocument.mockReturnValue(throwError(() => new Error('offline')));

      await store.captureAndUpload('CERTIFICATE');

      expect(store.upload().stage).toBe('error');
      expect(store.upload().message).toContain('Check your connection');
    });
  });

  describe('picked files', () => {
    const file = (type: string, size: number, name = 'scan') => {
      const blob = new File([new Uint8Array(size)], name, { type });
      return blob;
    };

    it('sends a PDF through untouched — no re-encode, no quality loss', async () => {
      await store.uploadPicked(file('application/pdf', 1000, 'licence.pdf'), 'LICENSE', { expiryDate: '2027-01-01' });

      expect(compressor.compress).not.toHaveBeenCalled();
      expect(api.uploadDocument).toHaveBeenCalledWith(expect.objectContaining({ filename: 'licence.pdf' }));
    });

    it('re-encodes a picked IMAGE, since it carries EXIF just like a capture', async () => {
      await store.uploadPicked(file('image/png', 1000, 'scan.png'), 'CERTIFICATE');

      expect(compressor.compress).toHaveBeenCalled();
      expect(api.uploadDocument).toHaveBeenCalledWith(expect.objectContaining({ filename: 'scan.jpg' }));
    });

    it.each(['image/heic', 'image/webp', 'text/plain', 'application/msword'])('rejects %s before uploading', async type => {
      // The server allowlist is exactly PDF/PNG/JPEG. Failing here gives a clear
      // message instead of a 400 about content types.
      await store.uploadPicked(file(type, 1000), 'CERTIFICATE');

      expect(api.uploadDocument).not.toHaveBeenCalled();
      expect(store.upload().message).toContain('Only PDF, PNG and JPEG');
    });

    it('rejects an oversize PDF locally rather than letting the server do it', async () => {
      await store.uploadPicked(file('application/pdf', SERVER_MAX_BYTES + 1, 'huge.pdf'), 'CERTIFICATE');

      expect(api.uploadDocument).not.toHaveBeenCalled();
      expect(store.upload().message).toContain('5 MB');
    });
  });

  it('lists documents and refreshes after an upload', async () => {
    await store.refresh();
    expect(store.byNewest()).toHaveLength(1);

    api.myDocuments.mockClear();
    await store.captureAndUpload('CERTIFICATE');
    expect(api.myDocuments).toHaveBeenCalled();
  });

  it('clears the upload state on dismiss', async () => {
    await store.captureAndUpload('CERTIFICATE');
    store.dismissUpload();
    expect(store.upload().stage).toBe('idle');
  });
});
