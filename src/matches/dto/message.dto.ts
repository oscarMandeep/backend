import { ApiProperty } from '@nestjs/swagger';

export class MessageDto {
  @ApiProperty() id!: string;
  @ApiProperty() matchId!: string;
  @ApiProperty() senderId!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) readAt!:
    string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
