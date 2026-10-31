import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class DevLoginDto {
  @ApiProperty({ example: 'demo@skillswap.dev' })
  @IsEmail()
  email!: string;
}
