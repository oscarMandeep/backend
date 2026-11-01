import { Module } from '@nestjs/common';
import { CreditsService } from './credits.service';
import { WalletController } from './wallet.controller';

@Module({
  controllers: [WalletController],
  providers: [CreditsService],
  exports: [CreditsService],
})
export class CreditsModule {}
