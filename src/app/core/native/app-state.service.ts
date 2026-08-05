import { Injectable, signal } from '@angular/core';
import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';

/**
 * Foreground/background state.
 *
 * Drives three things that all hinge on it: the socket is torn down shortly after
 * the app is backgrounded (a live WebSocket in the background is a battery drain the
 * OS will kill anyway, and push covers that window), the unread count is re-read on
 * resume because anything that happened while away was missed, and MOB5's re-lock
 * timer starts from the moment of pause.
 */
@Injectable({ providedIn: 'root' })
export class AppStateService {
  private readonly activeSignal = signal(true);
  readonly active = this.activeSignal.asReadonly();

  /** Epoch millis of the last transition to background, or null while foregrounded. */
  private readonly backgroundedAtSignal = signal<number | null>(null);
  readonly backgroundedAt = this.backgroundedAtSignal.asReadonly();

  private handle: PluginListenerHandle | null = null;
  private readonly listeners = new Set<(active: boolean) => void>();

  async initialize(): Promise<void> {
    this.handle ??= await App.addListener('appStateChange', ({ isActive }) => this.apply(isActive));
  }

  /** Notifies on every transition. Returns an unsubscribe function. */
  onChange(listener: (active: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** How long the app has been backgrounded, in ms. Zero while foregrounded. */
  backgroundedFor(now = Date.now()): number {
    const since = this.backgroundedAtSignal();
    return since === null ? 0 : now - since;
  }

  async destroy(): Promise<void> {
    await this.handle?.remove();
    this.handle = null;
  }

  /** Exposed for tests and for the web fallback, where the plugin does not fire. */
  apply(isActive: boolean): void {
    if (this.activeSignal() === isActive) {
      return;
    }
    this.activeSignal.set(isActive);
    this.backgroundedAtSignal.set(isActive ? null : Date.now());
    for (const listener of this.listeners) {
      listener(isActive);
    }
  }
}
