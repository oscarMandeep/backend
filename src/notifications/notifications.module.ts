import { Module } from '@nestjs/common';
import { NotificationsListener } from './notifications.listener';
import { RevalidateService } from './revalidate.service';

@Module({
  providers: [RevalidateService, NotificationsListener],
  exports: [RevalidateService],
})
export class NotificationsModule {}
