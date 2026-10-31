import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { Mode } from '../../generated/prisma/client';

export class DiscoverQuery {
  @ApiPropertyOptional({
    enum: Mode,
    enumName: 'Mode',
    description:
      'ONLINE or IN_PERSON keeps people who can do that; BOTH or omitted keeps everyone',
  })
  @IsOptional()
  @IsEnum(Mode)
  mode?: Mode;

  @ApiPropertyOptional({
    description: 'Only two-way swaps (no credit matches)',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  swapOnly?: boolean;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
