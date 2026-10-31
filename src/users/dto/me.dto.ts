import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { Mode, Priority } from '../../generated/prisma/client';
import { SkillRefDto } from '../../skills/dto/skill-ref.dto';

export class HaveDto {
  @ApiProperty({ type: SkillRefDto }) skill!: SkillRefDto;
  @ApiProperty({ minimum: 1, maximum: 5 }) level!: number;
  @ApiProperty() verified!: boolean;
}

export class WantDto {
  @ApiProperty({ type: SkillRefDto }) skill!: SkillRefDto;
  @ApiProperty({ minimum: 1, maximum: 5 }) goalLevel!: number;
  @ApiProperty({ enum: Priority, enumName: 'Priority' }) priority!: Priority;
}

export class AvailabilitySlotDto {
  @ApiProperty({ minimum: 0, maximum: 6, description: '0 = Sunday' })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @ApiProperty({
    minimum: 0,
    maximum: 1439,
    description: 'Minutes from midnight',
  })
  @IsInt()
  @Min(0)
  @Max(1439)
  startMin!: number;

  @ApiProperty({ minimum: 1, maximum: 1440 })
  @IsInt()
  @Min(1)
  @Max(1440)
  endMin!: number;
}

export class MeDto {
  @ApiProperty() id!: string;
  @ApiProperty() username!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) avatarUrl!:
    string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) bio!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) city!: string | null;
  @ApiProperty({ enum: Mode, enumName: 'Mode' }) mode!: Mode;
  @ApiProperty({ type: [String] }) languages!: string[];
  @ApiProperty() ratingAvg!: number;
  @ApiProperty() ratingCount!: number;
  @ApiProperty() sessionsDone!: number;
  @ApiProperty() isNew!: boolean;
  @ApiProperty({ type: [HaveDto] }) haves!: HaveDto[];
  @ApiProperty({ type: [WantDto] }) wants!: WantDto[];
  @ApiProperty() email!: string;
  @ApiProperty() timezone!: string;
  @ApiProperty() credits!: number;
  @ApiProperty() onboarded!: boolean;
  @ApiProperty() isPublic!: boolean;
  @ApiProperty({ type: [AvailabilitySlotDto] })
  availability!: AvailabilitySlotDto[];
}
