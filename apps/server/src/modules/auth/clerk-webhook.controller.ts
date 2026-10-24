import { BadRequestException, Controller, Headers, HttpCode, Post, RawBodyRequest, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Webhook } from 'svix';
import { Public } from './auth.decorators';
import { AuthService } from './auth.service';

interface ClerkEvent {
  type: string;
  data: { id: string };
}

/** Вебхуки Clerk: подпись svix проверяется по сырому телу запроса. */
@Controller('webhooks/clerk')
export class ClerkWebhookController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post()
  @HttpCode(200)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('svix-id') id: string,
    @Headers('svix-timestamp') timestamp: string,
    @Headers('svix-signature') signature: string,
  ) {
    const secret = process.env.CLERK_WEBHOOK_SECRET;
    if (!secret || !req.rawBody) throw new BadRequestException('Вебхук не настроен');
    let event: ClerkEvent;
    try {
      event = new Webhook(secret).verify(req.rawBody.toString('utf8'), {
        'svix-id': id,
        'svix-timestamp': timestamp,
        'svix-signature': signature,
      }) as unknown as ClerkEvent;
    } catch {
      throw new BadRequestException('Неверная подпись');
    }

    if (event.type === 'user.created') await this.auth.provision(event.data.id);
    if (event.type === 'user.deleted') await this.auth.markDeleted(event.data.id);
    return { received: true };
  }
}
