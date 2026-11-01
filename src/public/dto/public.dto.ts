import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SkillRefDto } from '../../skills/dto/skill-ref.dto';

/**
 * Everything here is visible to the whole internet. These classes are the
 * allow-list: a field that is not declared (email, googleId, lat, lng,
 * availability, credits) can never appear, because the service builds each
 * response from these shapes explicitly.
 */
export class PublicProfileCardDto {
  @ApiProperty() username!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) avatarUrl!: string | null;
  @ApiProperty({ type: String, nullable: true }) city!: string | null;
  @ApiProperty() ratingAvg!: number;
  @ApiProperty() sessionsDone!: number;
}

export class PublicHaveDto {
  @ApiProperty({ type: SkillRefDto }) skill!: SkillRefDto;
  @ApiProperty({ minimum: 1, maximum: 5 }) level!: number;
}

export class PublicWantDto {
  @ApiProperty({ type: SkillRefDto }) skill!: SkillRefDto;
}

export class PublicProfileDto extends PublicProfileCardDto {
  @ApiProperty({ type: String, nullable: true }) bio!: string | null;
  @ApiProperty({ type: [PublicHaveDto] }) haves!: PublicHaveDto[];
  @ApiProperty({ type: [PublicWantDto] }) wants!: PublicWantDto[];
}

export class SwapCountDto {
  @ApiProperty({ type: SkillRefDto }) skill!: SkillRefDto;
  @ApiProperty() count!: number;
}

export class TopSwapDto {
  @ApiProperty({ type: SkillRefDto }) from!: SkillRefDto;
  @ApiProperty({ type: SkillRefDto }) to!: SkillRefDto;
  @ApiProperty() count!: number;
}

export class PublicStatsDto {
  @ApiProperty() users!: number;
  @ApiProperty() skills!: number;
  @ApiProperty() sessions!: number;
  @ApiProperty({ type: [TopSwapDto] }) topSwaps!: TopSwapDto[];
}

export class PublicSkillSummaryDto extends SkillRefDto {
  @ApiProperty() teacherCount!: number;
  @ApiProperty() learnerCount!: number;
}

export class PublicSkillDto extends SkillRefDto {
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty() teacherCount!: number;
  @ApiProperty() learnerCount!: number;
  @ApiProperty({ type: [SwapCountDto] }) popularSwaps!: SwapCountDto[];
  @ApiProperty({
    type: [PublicProfileCardDto],
    description: 'At most 12, public profiles only',
  })
  teachers!: PublicProfileCardDto[];
}

export class PublicSkillCityDto {
  @ApiProperty({ type: SkillRefDto }) skill!: SkillRefDto;
  @ApiProperty() city!: string;
  @ApiProperty() teacherCount!: number;
  @ApiProperty({ type: [PublicProfileCardDto] })
  teachers!: PublicProfileCardDto[];
}

export class SitemapSkillDto {
  @ApiProperty() slug!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class SitemapUserDto {
  @ApiProperty() username!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class SitemapLocalPageDto {
  @ApiProperty({ description: 'Skill slug' }) skill!: string;
  @ApiProperty() city!: string;
}

export class PublicSitemapDto {
  @ApiProperty({ type: [SitemapSkillDto] }) skills!: SitemapSkillDto[];
  @ApiProperty({ type: [SitemapUserDto] }) users!: SitemapUserDto[];
  @ApiProperty({
    type: [SitemapLocalPageDto],
    description: 'Skill + city pairs with at least 3 public teachers',
  })
  localPages!: SitemapLocalPageDto[];
}

export class PublicSkillsQuery {
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ example: 'Music' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  category?: string;
}
