import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { MatchBreakdownDto } from '../../discover/dto/deck-card.dto';
import { MatchType } from '../../generated/prisma/client';
import { SkillRefDto } from '../../skills/dto/skill-ref.dto';
import { UserCardDto } from '../../users/dto/user-card.dto';
import { MessageDto } from './message.dto';

export class MatchSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: MatchType, enumName: 'MatchType' }) type!: MatchType;
  @ApiProperty({ minimum: 0, maximum: 100 }) score!: number;
  @ApiProperty({ type: UserCardDto }) otherUser!: UserCardDto;
  @ApiProperty({ type: MessageDto, nullable: true })
  lastMessage!: MessageDto | null;
  @ApiProperty() unreadCount!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class MatchDetailDto extends MatchSummaryDto {
  @ApiProperty({ type: MatchBreakdownDto }) breakdown!: MatchBreakdownDto;
  @ApiProperty({ type: SkillRefDto, description: 'What they teach me' })
  learnSkill!: SkillRefDto;
  @ApiProperty({
    type: SkillRefDto,
    nullable: true,
    description: 'What I teach them',
  })
  teachSkill!: SkillRefDto | null;
}

export class PaginatedMatchesDto {
  @ApiProperty({ type: [MatchSummaryDto] }) items!: MatchSummaryDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}

export class ListMatchesQuery {
  @ApiPropertyOptional({ description: 'The nextCursor of the previous page' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
