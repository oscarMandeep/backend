import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { CreateSkillDto } from './dto/create-skill.dto';
import { SearchSkillsQuery } from './dto/search-skills.dto';
import { SkillRefDto } from './dto/skill-ref.dto';
import { SkillsService } from './skills.service';

@ApiTags('skills')
@Controller('skills')
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  @Public()
  @Get('search')
  @ApiOkResponse({ type: [SkillRefDto] })
  searchSkills(@Query() query: SearchSkillsQuery): Promise<SkillRefDto[]> {
    return this.skills.search(query.q, query.limit);
  }

  @ApiCookieAuth()
  @Post()
  @ApiCreatedResponse({ type: SkillRefDto })
  createSkill(@Body() dto: CreateSkillDto): Promise<SkillRefDto> {
    return this.skills.create(dto.name);
  }
}
