import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class MessageDto {
  @ApiProperty() id!: string;
  @ApiProperty() matchId!: string;
  @ApiProperty() senderId!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) readAt!:
    string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class PaginatedMessagesDto {
  @ApiProperty({ type: [MessageDto] }) items!: MessageDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}

export class ListMessagesQuery {
  @ApiPropertyOptional({ description: 'The nextCursor of the previous page' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
