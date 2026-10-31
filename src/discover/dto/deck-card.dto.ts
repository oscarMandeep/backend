import { ApiProperty } from '@nestjs/swagger';
import { SkillRefDto } from '../../skills/dto/skill-ref.dto';
import { UserCardDto } from '../../users/dto/user-card.dto';

export const MATCH_KINDS = ['SWAP', 'CREDIT'] as const;

export class MatchBreakdownDto {
  @ApiProperty({ minimum: 0, maximum: 1 }) skill!: number;
  @ApiProperty({ minimum: 0, maximum: 1 }) reciprocity!: number;
  @ApiProperty({ minimum: 0, maximum: 1 }) priority!: number;
  @ApiProperty({ minimum: 0, maximum: 1 }) availability!: number;
  @ApiProperty({ minimum: 0, maximum: 1 }) mode!: number;
  @ApiProperty({ minimum: 0, maximum: 1 }) language!: number;
  @ApiProperty({ minimum: 0, maximum: 1 }) trust!: number;
}

export class DeckCardDto {
  @ApiProperty({ type: UserCardDto }) user!: UserCardDto;
  @ApiProperty({ minimum: 0, maximum: 100 }) score!: number;
  @ApiProperty({ enum: MATCH_KINDS, enumName: 'MatchKind' })
  type!: (typeof MATCH_KINDS)[number];
  @ApiProperty({ type: MatchBreakdownDto }) breakdown!: MatchBreakdownDto;
  @ApiProperty({
    type: [String],
    example: ['Teaches Excel (you want)', '6 shared hrs/week'],
  })
  reasons!: string[];
  @ApiProperty({ type: SkillRefDto, description: 'What they can teach me' })
  learnSkill!: SkillRefDto;
  @ApiProperty({
    type: SkillRefDto,
    nullable: true,
    description: 'What I can teach them',
  })
  teachSkill!: SkillRefDto | null;
}
