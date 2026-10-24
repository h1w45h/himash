import { Global, Injectable, Module } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { ChatMessageDto, MatchUpdate } from '@nastolki/shared';

export type DomainEvent =
  | { type: 'room.updated'; roomId: string; code: string }
  | { type: 'room.closed'; roomId: string; code: string }
  | { type: 'match.started'; roomId: string | null; matchId: string; userIds: string[] }
  | { type: 'matchmaking.found'; userIds: string[]; roomCode: string; matchId: string }
  /** Обновление партии: у каждого места свой payload (скрытая информация). */
  | { type: 'match.updated'; matchId: string; payloads: Record<number, MatchUpdate>; ended: boolean }
  | { type: 'chat.message'; roomKey: string; message: ChatMessageDto }
  | { type: 'invitation.created'; receiverId: string; invitationId: string };

/**
 * Внутренняя шина событий. Сервисы публикуют факты, Socket.io-шлюз (шаг 5)
 * подписывается и рассылает их клиентам — так бизнес-логика не знает про сокеты.
 */
@Injectable()
export class DomainEvents {
  private readonly subject = new Subject<DomainEvent>();
  readonly stream = this.subject.asObservable();
  emit(e: DomainEvent) {
    this.subject.next(e);
  }
}

@Global()
@Module({ providers: [DomainEvents], exports: [DomainEvents] })
export class EventsModule {}
