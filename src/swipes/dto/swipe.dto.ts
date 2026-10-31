import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsString, MinLength } from 'class-validator';
import { SwipeAction } from '../../generated/prisma/client';

export class SwipeDto {
  @ApiProperty() @IsString() @MinLength(1) targetId!: string;

  @ApiProperty({ enum: SwipeAction, enumName: 'SwipeAction' })
  @IsEnum(SwipeAction)
  action!: SwipeAction;
}

export class SwipeResponseDto {
  @ApiProperty() matched!: boolean;
  @ApiPropertyOptional() matchId?: string;
}
