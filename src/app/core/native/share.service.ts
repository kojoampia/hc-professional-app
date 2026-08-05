import { Injectable } from '@angular/core';
import { Share } from '@capacitor/share';

/**
 * The mobile replacement for the web app's print action — the copied
 * `.hpd-*` component styles drop their `@media print` block, and roster/document
 * export goes through the OS share sheet instead (MOB11).
 */
@Injectable({ providedIn: 'root' })
export class ShareService {
  async canShare(): Promise<boolean> {
    const result = await Share.canShare();
    return result.value;
  }

  async shareText(options: { title: string; text: string; dialogTitle?: string }): Promise<void> {
    await Share.share({
      title: options.title,
      text: options.text,
      dialogTitle: options.dialogTitle ?? options.title,
    });
  }
}
