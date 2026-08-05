import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApplicationConfigService } from '../config/application-config.service';

export interface ConversationDto {
  id: string;
  subject: string;
  createdBy: string;
  createdAt: string;
  lastMessageAt: string;
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
}
