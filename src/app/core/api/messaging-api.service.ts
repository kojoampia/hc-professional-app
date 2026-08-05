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

  reply(conversationId: string, body: string): Observable<MessageDto> {
    return this.http.post<MessageDto>(`${this.resourceUrl}/conversations/${encodeURIComponent(conversationId)}/messages`, { body });
  }

  /**
   * Marks everything read.
   *
   * Takes no conversation id on purpose: `MessagingResource` exposes
   * `/messages/{id}/read` and `/read-all`, but nothing per-conversation. Opening a
   * thread on a phone means the whole thread has been seen, so `/read-all` is the
   * honest approximation — and it is why the badge is re-read from the server
   * afterwards rather than adjusted locally.
   *
   * The cost is real: reading one thread clears the badge for every other unread
   * message too. A per-conversation endpoint belongs on the Phase 2 backend list
   * alongside the role-scoped directory (see MOB-P2-PRE in mobile-app-plan.md).
   */
  markAllRead(): Observable<number> {
    return this.http.post<number>(`${this.resourceUrl}/read-all`, null);
  }
}
