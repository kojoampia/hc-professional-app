import { Injectable } from '@angular/core';
import { Camera, CameraResultType, CameraSource, type Photo } from '@capacitor/camera';

@Injectable({ providedIn: 'root' })
export class CameraService {
  /**
   * Prompts for camera-or-library and returns the photo as a file URI.
   *
   * `resultType: Uri` rather than `Base64` on purpose — base64 inflates a capture
   * roughly 3x in memory, which matters on a low-end handset photographing a licence.
   *
   * MOB8 adds the re-encode step that consumes this: canvas -> JPEG at descending
   * quality until under 4 MB. That step is what guarantees `image/jpeg` (the server
   * allowlist is exactly PDF/PNG/JPEG with a magic-byte check), converts HEIC from
   * iOS, and strips EXIF including GPS. Do not upload `photo.webPath` directly.
   */
  async capture(): Promise<Photo> {
    return Camera.getPhoto({
      source: CameraSource.Prompt,
      resultType: CameraResultType.Uri,
      quality: 85,
      correctOrientation: true,
      width: 2000,
      presentationStyle: 'fullscreen',
    });
  }

  async ensurePermissions(): Promise<boolean> {
    let status = await Camera.checkPermissions();
    if (status.camera === 'prompt' || status.photos === 'prompt') {
      status = await Camera.requestPermissions({ permissions: ['camera', 'photos'] });
    }
    return status.camera === 'granted' || status.photos === 'granted';
  }
}
