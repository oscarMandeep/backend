import { ApiProperty } from '@nestjs/swagger';

export class SkillRefDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() category!: string;
}
