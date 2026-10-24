import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { ExpoPushSender, PushSender } from './push.sender';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, { provide: PushSender, useClass: ExpoPushSender }],
  exports: [NotificationsService],
})
export class NotificationsModule {}
