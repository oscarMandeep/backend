import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { ChainStatus } from '../../generated/prisma/client';
import { SkillRefDto } from '../../skills/dto/skill-ref.dto';
import { UserCardDto } from '../../users/dto/user-card.dto';

export class ChainMemberDto {
  @ApiProperty({
    description: '0-based place in the loop; the last member teaches the first',
  })
  position!: number;
  @ApiProperty({ type: UserCardDto }) user!: UserCardDto;
  @ApiProperty({
    type: SkillRefDto,
    description: 'What this person teaches the NEXT person',
  })
  teachSkill!: SkillRefDto;
  @ApiProperty({
    type: Boolean,
    nullable: true,
    description: 'null = has not answered yet',
  })
  accepted!: boolean | null;
}

export class ChainDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ChainStatus, enumName: 'ChainStatus' })
  status!: ChainStatus;
  @ApiProperty({ minimum: 0, maximum: 100 }) score!: number;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ type: [ChainMemberDto] }) members!: ChainMemberDto[];
}

export class RespondChainDto {
  @ApiProperty() @IsBoolean() accept!: boolean;
}
