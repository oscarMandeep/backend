import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Mode } from '../../generated/prisma/client';
import { IsTimeZone } from './is-timezone';

export class UpdateMeDto {
  @ApiPropertyOptional({ example: 'Riya Sharma' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({
    example: 'riya_s',
    description: '3-20 lowercase letters, digits or _',
  })
  @IsOptional()
  @Matches(/^[a-z0-9_]{3,20}$/, {
    message: 'username must be 3-20 lowercase letters, numbers or underscores',
  })
  username?: string;

  @ApiPropertyOptional({ description: 'Empty string clears it' })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  bio?: string;

  @ApiPropertyOptional({
    example: 'Dehradun',
    description: 'Empty string clears it',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  city?: string;

  @ApiPropertyOptional({ enum: Mode, enumName: 'Mode' })
  @IsOptional()
  @IsEnum(Mode)
  mode?: Mode;

  @ApiPropertyOptional({ type: [String], example: ['English', 'Hindi'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(30, { each: true })
  languages?: string[];

  @ApiPropertyOptional({ example: 'Asia/Kolkata' })
  @IsOptional()
  @IsTimeZone()
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/demo/avatar.jpg',
  })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  avatarUrl?: string;
}
