import { ApiProperty } from '@nestjs/swagger';

export class SocketTokenResponse {
  @ApiProperty()
  token!: string;

  @ApiProperty({ example: 60 })
  expiresIn!: number;
}
