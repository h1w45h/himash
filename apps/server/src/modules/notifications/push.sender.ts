import { Injectable, Logger } from '@nestjs/common';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Абстракция отправки push — в тестах подменяется заглушкой. */
export abstract class PushSender {
  /** Возвращает токены, которые больше недействительны (приложение удалено) — их нужно забыть. */
  abstract send(messages: PushMessage[]): Promise<string[]>;
}

@Injectable()
export class ExpoPushSender extends PushSender {
  private readonly log = new Logger(ExpoPushSender.name);

  async send(messages: PushMessage[]): Promise<string[]> {
    const dead: string[] = [];
    // Expo принимает до 100 сообщений за запрос.
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      try {
        const res = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(chunk.map((m) => ({ ...m, sound: 'default', priority: 'high' }))),
        });
        const json = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
        json.data?.forEach((r, idx) => {
          if (r.status === 'error' && r.details?.error === 'DeviceNotRegistered') dead.push(chunk[idx]!.to);
        });
      } catch (e) {
        this.log.warn(`Не удалось отправить push: ${(e as Error).message}`);
      }
    }
    return dead;
  }
}
