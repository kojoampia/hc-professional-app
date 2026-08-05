import { Injectable, inject, signal } from '@angular/core';
import { Client, IMessage } from '@stomp/stompjs';
import { Observable, Subject } from 'rxjs';

import { SecureTokenStore } from '../native/secure-token-store.service';
import { environment } from '../../../environments/environment';

/** What a `message.created` frame carries: identifiers, never content. */
export interface MessageNotification {
  messageId: string;
  conversationId?: string;
  occurredAt?: string;
}

export type SocketState = 'idle' | 'connecting' | 'connected' | 'disconnected';

/**
 * STOMP connection for message notifications.
 *
 * Adapted from `web/src/main/webapp/app/health-connect/api/message-socket.service.ts`
 * (web commit 48a12fc). The protocol details are unchanged and all load-bearing:
 *
 * - **The path is `/websocket/messages`**, not `/services/professionalservice/...`.
 *   Both nginx layers forward `Upgrade`/`Connection` only on their dedicated
 *   `/websocket` location. Routed the other way the socket is silently downgraded to
 *   plain HTTP and rejected, which presents as an inbox that renders but never
 *   updates.
 * - **The token goes on the CONNECT frame, not the handshake**, because a WebSocket
 *   upgrade cannot carry an Authorization header. The server permits the handshake
 *   and authenticates the CONNECT.
 * - **SockJS is deliberately not used**: the server registers the endpoint without it.
 *
 * Two things differ from web. The broker URL comes from the environment rather than
 * `window.location`, which on a device is `capacitor://localhost` and would produce a
 * nonsense URL. And the token is read from `SecureTokenStore` inside `beforeConnect`,
 * so a reconnect after a refresh presents the *current* access token — on mobile that
 * token expires every 15 minutes, so a client that captured one at construction would
 * fail to reconnect within the hour.
 */
@Injectable({ providedIn: 'root' })
export class MessageSocketService {
  private readonly tokens = inject(SecureTokenStore);

  private client: Client | null = null;
  private readonly subject = new Subject<MessageNotification>();

  /** Notifications as they arrive. Identifiers only — the caller fetches the message. */
  readonly notifications: Observable<MessageNotification> = this.subject.asObservable();

  private readonly stateSignal = signal<SocketState>('idle');
  readonly state = this.stateSignal.asReadonly();

  connect(): void {
    if (this.client?.active) {
      return;
    }
    if (!this.tokens.accessToken()) {
      // Nothing to authenticate with. The caller reconnects after sign-in.
      return;
    }

    this.stateSignal.set('connecting');
    this.client = new Client({
      brokerURL: environment.wsBaseUrl,
      // Read per connection attempt rather than captured, so a reconnect after a
      // token refresh presents the current token instead of the one this client
      // started with. On mobile that matters within 15 minutes, not 24 hours.
      beforeConnect: () => {
        this.client!.connectHeaders = { Authorization: `Bearer ${this.tokens.accessToken() ?? ''}` };
      },
      reconnectDelay: 5000,
      heartbeatIncoming: 20000,
      heartbeatOutgoing: 20000,
    });

    this.client.onConnect = () => {
      this.stateSignal.set('connected');
      // The user destination resolves server-side against the authenticated
      // principal, so this subscription cannot be pointed at somebody else's queue
      // by editing the path.
      this.client!.subscribe('/user/queue/messages', (frame: IMessage) => {
        try {
          this.subject.next(JSON.parse(frame.body) as MessageNotification);
        } catch {
          // A malformed frame must not tear down the subscription; the next one
          // should still land.
        }
      });
    };

    this.client.onWebSocketClose = () => this.stateSignal.set('disconnected');
    this.client.onStompError = () => this.stateSignal.set('disconnected');

    this.client.activate();
  }

  /**
   * Drops the connection.
   *
   * `deactivate()` also stops the reconnect timer — without it the client keeps
   * dialling after sign-out and reconnects with a token that is no longer valid.
   */
  disconnect(): void {
    void this.client?.deactivate();
    this.client = null;
    this.stateSignal.set('idle');
  }

  /** Drops and re-establishes. Used after a token refresh and on resume. */
  reconnect(): void {
    this.disconnect();
    this.connect();
  }
}
