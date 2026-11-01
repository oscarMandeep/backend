import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class BlockUserDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(64) userId!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ReportUserDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(64) userId!: string;

  @ApiProperty({ example: 'Harassment', minLength: 3, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  reason!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  details?: string;
}
