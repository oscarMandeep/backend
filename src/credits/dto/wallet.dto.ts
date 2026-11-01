import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreditTxDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: 'Positive = earned, negative = spent' })
  amount!: number;
  @ApiProperty({ example: 'TAUGHT_SESSION' }) reason!: string;
  @ApiProperty({ type: String, nullable: true }) sessionId!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class PaginatedCreditTxDto {
  @ApiProperty({ type: [CreditTxDto] }) items!: CreditTxDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}

export class WalletDto {
  @ApiProperty() balance!: number;
  @ApiProperty({ type: PaginatedCreditTxDto }) ledger!: PaginatedCreditTxDto;
}

export class WalletQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
