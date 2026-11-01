import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import {
  PublicProfileDto,
  PublicSitemapDto,
  PublicSkillCityDto,
  PublicSkillDto,
  PublicSkillSummaryDto,
  PublicSkillsQuery,
  PublicStatsDto,
} from './dto/public.dto';
import { PublicService } from './public.service';

/** Open to everyone and safe for a CDN to cache; the website's ISR pages read these. */
const CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600';

@ApiTags('public')
@Public()
@Controller('public')
export class PublicController {
  constructor(private readonly publicData: PublicService) {}

  @Get('stats')
  @Header('Cache-Control', CACHE)
  @ApiOkResponse({ type: PublicStatsDto })
  getPublicStats(): Promise<PublicStatsDto> {
    return this.publicData.stats();
  }

  @Get('skills')
  @Header('Cache-Control', CACHE)
  @ApiOkResponse({ type: [PublicSkillSummaryDto] })
  listPublicSkills(
    @Query() query: PublicSkillsQuery,
  ): Promise<PublicSkillSummaryDto[]> {
    return this.publicData.skills(query.limit, query.category);
  }

  @Get('skills/:slug')
  @Header('Cache-Control', CACHE)
  @ApiOkResponse({ type: PublicSkillDto })
  getPublicSkill(@Param('slug') slug: string): Promise<PublicSkillDto> {
    return this.publicData.skill(slug);
  }

  @Get('skills/:slug/cities/:city')
  @Header('Cache-Control', CACHE)
  @ApiOkResponse({ type: PublicSkillCityDto })
  getPublicSkillInCity(
    @Param('slug') slug: string,
    @Param('city') city: string,
  ): Promise<PublicSkillCityDto> {
    return this.publicData.skillInCity(slug, city);
  }

  @Get('users/:username')
  @Header('Cache-Control', CACHE)
  @ApiOkResponse({ type: PublicProfileDto })
  getPublicProfile(
    @Param('username') username: string,
  ): Promise<PublicProfileDto> {
    return this.publicData.profile(username);
  }

  @Get('sitemap')
  @Header('Cache-Control', CACHE)
  @ApiOkResponse({ type: PublicSitemapDto })
  getPublicSitemap(): Promise<PublicSitemapDto> {
    return this.publicData.sitemap();
  }
}
