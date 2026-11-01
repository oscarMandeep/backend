import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Mode, SessionStatus } from '../../generated/prisma/client';
import { ReviewDto } from '../../reviews/dto/review.dto';
import { SkillRefDto } from '../../skills/dto/skill-ref.dto';
import { UserCardDto } from '../../users/dto/user-card.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class SessionDto {
  @ApiProperty() id!: string;
  @ApiProperty({ type: String, nullable: true }) matchId!: string | null;
  @ApiProperty({ type: UserCardDto }) teacher!: UserCardDto;
  @ApiProperty({ type: UserCardDto }) learner!: UserCardDto;
  @ApiProperty({ type: SkillRefDto }) skill!: SkillRefDto;
  @ApiProperty({ format: 'date-time' }) startsAt!: string;
  @ApiProperty() durationMin!: number;
  @ApiProperty({ enum: Mode, enumName: 'Mode' }) mode!: Mode;
  @ApiProperty({ type: String, nullable: true }) meetingUrl!: string | null;
  @ApiProperty({ type: String, nullable: true }) location!: string | null;
  @ApiProperty({ enum: SessionStatus, enumName: 'SessionStatus' })
  status!: SessionStatus;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Who proposed it; the other person confirms',
  })
  proposedById!: string | null;
  @ApiProperty({ type: ReviewDto, nullable: true }) myReview!: ReviewDto | null;
}

export class CreateSessionDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(64) matchId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(64) skillId!: string;
  @ApiProperty({
    description: 'Who teaches; the other person in the match learns',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  teacherId!: string;

  @ApiProperty({ example: '2031-01-06T12:30:00.000Z' })
  @IsISO8601({ strict: true })
  startsAt!: string;

  @ApiProperty({
    minimum: 15,
    maximum: 180,
    description: 'Minutes, in steps of 15',
  })
  @IsInt()
  @Min(15)
  @Max(180)
  durationMin!: number;

  @ApiProperty({ enum: ['ONLINE', 'IN_PERSON'] })
  @IsIn([Mode.ONLINE, Mode.IN_PERSON])
  mode!: 'ONLINE' | 'IN_PERSON';

  @ApiPropertyOptional({ description: 'Required for IN_PERSON' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  location?: string;
}

export class CancelSessionDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ListSessionsQuery {
  @ApiPropertyOptional({ enum: ['upcoming', 'past'], default: 'upcoming' })
  @IsOptional()
  @IsEnum({ upcoming: 'upcoming', past: 'past' })
  scope?: 'upcoming' | 'past';
}

export class SlotDto {
  @ApiProperty({ format: 'date-time' }) startsAt!: string;
  @ApiProperty({ format: 'date-time' }) endsAt!: string;
}

export class SlotsQuery {
  @ApiPropertyOptional({ default: 14, minimum: 1, maximum: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  days?: number;

  @ApiPropertyOptional({ default: 60, minimum: 15, maximum: 180 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(180)
  durationMin?: number;
}
