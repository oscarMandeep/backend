import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Priority } from '../../generated/prisma/client';

export class HaveInputDto {
  @ApiProperty() @IsString() skillId!: string;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  level!: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 60 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(60)
  years?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  proofUrl?: string;
}

export class WantInputDto {
  @ApiProperty() @IsString() skillId!: string;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  currentLevel!: number;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  goalLevel!: number;

  @ApiProperty({ enum: Priority, enumName: 'Priority' })
  @IsEnum(Priority)
  priority!: Priority;
}

export class UpdateSkillsDto {
  @ApiProperty({ type: [HaveInputDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => HaveInputDto)
  haves!: HaveInputDto[];

  @ApiProperty({ type: [WantInputDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => WantInputDto)
  wants!: WantInputDto[];
}
