import { Injectable, signal } from '@angular/core';
import { Network } from '@capacitor/network';
import type { PluginListenerHandle } from '@capacitor/core';

/**
 * Connectivity state for the offline cache (MOB6).
 *
 * The offline interceptor reads `connected()` to short-circuit GETs rather than
 * letting them hang for the platform timeout, and the cache refreshes on the
 * disconnected -> connected edge.
 */
@Injectable({ providedIn: 'root' })
export class NetworkService {
  private readonly connectedSignal = signal(true);
  readonly connected = this.connectedSignal.asReadonly();

  private handle: PluginListenerHandle | null = null;

  /** Called once at app start. Idempotent. */
  async initialize(): Promise<void> {
    const status = await Network.getStatus();
    this.connectedSignal.set(status.connected);

    this.handle ??= await Network.addListener('networkStatusChange', status => {
      this.connectedSignal.set(status.connected);
    });
  }

  async refresh(): Promise<boolean> {
    const status = await Network.getStatus();
    this.connectedSignal.set(status.connected);
    return status.connected;
  }

  async destroy(): Promise<void> {
    await this.handle?.remove();
    this.handle = null;
  }
}
