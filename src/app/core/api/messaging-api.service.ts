import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApplicationConfigService } from '../config/application-config.service';

export interface ConversationDto {
  id: string;
  subject?: string;
  createdBy?: string;
  createdAt?: string;
  lastMessageAt?: string;
}

export interface MessageDto {
  id: string;
  conversationId?: string;
  senderId?: string;
  senderName?: string;
  body?: string;
  sentAt?: string;
  recipientRole?: string | null;
}

/**
 * Someone this clinician may address.
 *
 * <p>Carries an account id, a display name and a role — no contact details and nothing clinical.
 * Sourced from the same records the role broadcast resolves against, so the picker and the
 * broadcast cannot disagree about who exists.
 */
export interface RecipientDto {
  accountId: string;
  displayName: string;
  role: string;
}

/** A new thread. Give explicit recipients or a role to broadcast to — the server requires one. */
export interface NewConversationDto {
  subject?: string;
  body: string;
  recipientIds?: string[];
  recipientRole?: string;
}

@Injectable({ providedIn: 'root' })
export class MessagingApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApplicationConfigService);

  private get resourceUrl(): string {
    return this.config.getEndpointFor('api/messaging', 'professionalservice');
  }

  /**
   * Authoritative unread count.
   *
   * Deliberately a server call rather than something derived from the conversation
   * list: the list is a slice, so counting it would under-report the moment there is
   * more than one page. web's MessagesApiService carries the same note.
   */
  unreadCount(): Observable<number> {
    return this.http.get<number>(`${this.resourceUrl}/unread-count`);
  }

  conversations(): Observable<ConversationDto[]> {
    return this.http.get<ConversationDto[]>(`${this.resourceUrl}/conversations`);
  }

  messagesIn(conversationId: string): Observable<MessageDto[]> {
    return this.http.get<MessageDto[]>(`${this.resourceUrl}/conversations/${encodeURIComponent(conversationId)}/messages`);
  }

  /**
   * Who this clinician may address.
   *
   * <p>Deliberately not the gateway's `/api/users`, which returns every gateway user unfiltered —
   * including accounts that are not clinicians at all — and is not something to put behind a
   * recipient picker on a clinical app.
   */
  recipients(query?: string, role?: string): Observable<RecipientDto[]> {
    const params: Record<string, string> = {};
    if (query) {
      params['query'] = query;
    }
    if (role) {
      params['role'] = role;
    }
    return this.http.get<RecipientDto[]>(`${this.resourceUrl}/recipients`, { params });
  }

  /**
   * Starts a thread.
   *
   * <p>**422 means the role matched nobody** and must be surfaced, not swallowed. The server used
   * to store such a message with zero recipients and answer 200 — the clinician saw their
   * escalation sent and it reached no one, with nothing on either side ever saying so.
   */
  startConversation(request: NewConversationDto): Observable<MessageDto> {
    return this.http.post<MessageDto>(`${this.resourceUrl}/conversations`, request);
  }

  reply(conversationId: string, body: string): Observable<MessageDto> {
    return this.http.post<MessageDto>(`${this.resourceUrl}/conversations/${encodeURIComponent(conversationId)}/messages`, { body });
  }

  /**
   * Marks one thread read, and answers with the caller's new total unread count.
   *
   * <p>Returning the count is what makes the badge cost one round trip rather than two, and stops
   * it briefly disagreeing with the list that prompted the call.
   *
   * <p>Until Phase 1 the only options were one message or everything; this client took everything,
   * so opening one conversation cleared every unread badge in the app and a clinician lost the
   * signal that three others were waiting.
   *
   * <p>`POST /read-all` still exists on the server and is deliberately **not** wrapped here. There
   * is no screen that clears every thread at once, and a method sitting unused is an invitation to
   * reach for it the next time a badge needs clearing — which is exactly the mistake this replaces.
   */
  markConversationRead(conversationId: string): Observable<number> {
    return this.http.post<number>(`${this.resourceUrl}/conversations/${encodeURIComponent(conversationId)}/read`, null);
  }
}
