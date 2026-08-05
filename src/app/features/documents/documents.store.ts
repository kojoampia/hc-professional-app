import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';

import { DocumentType, OnboardingApiService, PersonalDocumentDto } from '../../core/api/onboarding-api.service';
import { CameraService } from '../../core/native/camera.service';
import { CacheStore } from '../../core/offline/cache-store.service';
import { CachedResource, cachedResource } from '../../core/offline/cached-resource';
import { ImageCompressor, browserCodec } from '../../core/media/image-compressor';

const DOCUMENTS_TTL_MS = 24 * 60 * 60 * 1000;

/** Exactly what `OnboardingDocumentResource` accepts — nothing else gets through. */
export const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const;

/** The server's hard limit. */
export const SERVER_MAX_BYTES = 5_000_000;

export type UploadStage = 'idle' | 'preparing' | 'uploading' | 'done' | 'error';

export interface UploadState {
  stage: UploadStage;
  /** 0..1 while uploading, null when indeterminate. */
  fraction: number | null;
  message: string | null;
}

@Injectable({ providedIn: 'root' })
export class DocumentsStore {
  private readonly api = inject(OnboardingApiService);
  private readonly camera = inject(CameraService);
  private readonly compressor = inject(ImageCompressor);
  private readonly cache = inject(CacheStore);

  readonly documents: CachedResource<PersonalDocumentDto[]> = cachedResource(this.cache, {
    key: 'onboarding.myDocuments',
    ttlMs: DOCUMENTS_TTL_MS,
    fetch: () => this.api.myDocuments(),
  });

  private readonly uploadState = signal<UploadState>({ stage: 'idle', fraction: null, message: null });
  readonly upload = this.uploadState.asReadonly();

  readonly byNewest = computed(() =>
    [...(this.documents.value() ?? [])].sort((a, b) => (b.expiryDate ?? '').localeCompare(a.expiryDate ?? '')),
  );

  async refresh(): Promise<void> {
    await this.documents.refresh();
  }

  /**
   * Photographs a document and uploads it.
   *
   * The capture is always re-encoded rather than sent as-is — see ImageCompressor
   * for why (format, HEIC, EXIF/GPS, orientation, size).
   */
  async captureAndUpload(type: DocumentType, options: { otherLabel?: string; expiryDate?: string } = {}): Promise<void> {
    this.uploadState.set({ stage: 'preparing', fraction: null, message: null });

    let jpeg: Blob;
    try {
      const photo = await this.camera.capture();
      if (!photo.webPath) {
        throw new Error('No image returned');
      }
      const raw = await fetch(photo.webPath).then(response => response.blob());
      const result = await this.compressor.compress(raw, browserCodec);

      if (result.overTarget) {
        // Better to say so than to upload something the server will reject with a
        // message about bytes that means nothing to a clinician holding a phone.
        this.fail('That photo is too large even after compression. Try again with less of the background in frame.');
        return;
      }
      jpeg = result.blob;
    } catch {
      // Most likely an unsupported source format — an Android WebView asked to
      // decode a HEIC synced from an iPhone, for instance.
      this.fail('Could not read that image. Try taking the photo again, or choose a PDF.');
      return;
    }

    await this.send(jpeg, `${type.toLowerCase()}.jpg`, type, options);
  }

  /** Uploads a file the user picked. PDFs pass through untouched; images are re-encoded. */
  async uploadPicked(file: File, type: DocumentType, options: { otherLabel?: string; expiryDate?: string } = {}): Promise<void> {
    if (!ACCEPTED_TYPES.includes(file.type as (typeof ACCEPTED_TYPES)[number])) {
      this.fail('Only PDF, PNG and JPEG documents are accepted.');
      return;
    }

    if (file.type === 'application/pdf') {
      if (file.size > SERVER_MAX_BYTES) {
        this.fail('That PDF is larger than 5 MB. Try a smaller scan.');
        return;
      }
      await this.send(file, file.name, type, options);
      return;
    }

    this.uploadState.set({ stage: 'preparing', fraction: null, message: null });
    try {
      const result = await this.compressor.compress(file, browserCodec);
      if (result.overTarget) {
        this.fail('That image is too large even after compression.');
        return;
      }
      await this.send(result.blob, file.name.replace(/\.[^.]+$/, '') + '.jpg', type, options);
    } catch {
      this.fail('Could not read that image.');
    }
  }

  private async send(
    blob: Blob,
    filename: string,
    type: DocumentType,
    options: { otherLabel?: string; expiryDate?: string },
  ): Promise<void> {
    this.uploadState.set({ stage: 'uploading', fraction: 0, message: null });

    await new Promise<void>(resolve => {
      const request: Observable<{ fraction: number | null; done: boolean }> = this.api.uploadDocument({
        file: blob,
        filename,
        type,
        otherLabel: options.otherLabel,
        expiryDate: options.expiryDate,
      });

      request.subscribe({
        next: progress => {
          if (!progress.done) {
            this.uploadState.set({ stage: 'uploading', fraction: progress.fraction, message: null });
          }
        },
        error: () => {
          this.fail('Upload failed. Check your connection and try again.');
          resolve();
        },
        complete: () => {
          this.uploadState.set({ stage: 'done', fraction: 1, message: null });
          void this.refresh().then(() => resolve());
        },
      });
    });
  }

  private fail(message: string): void {
    this.uploadState.set({ stage: 'error', fraction: null, message });
  }

  dismissUpload(): void {
    this.uploadState.set({ stage: 'idle', fraction: null, message: null });
  }
}
