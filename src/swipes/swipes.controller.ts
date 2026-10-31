import { Body, Controller, Delete, HttpCode, Post } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { SwipeDto, SwipeResponseDto } from './dto/swipe.dto';
import { SwipesService } from './swipes.service';

@ApiTags('swipes')
@ApiCookieAuth()
@Controller('swipes')
export class SwipesController {
  constructor(private readonly swipes: SwipesService) {}

  @Post()
  @HttpCode(200)
  @ApiOkResponse({ type: SwipeResponseDto })
  createSwipe(
    @CurrentUser() user: AuthUser,
    @Body() dto: SwipeDto,
  ): Promise<SwipeResponseDto> {
    return this.swipes.swipe(user.id, dto);
  }

  @Delete('last')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'The last PASS was undone' })
  undoLastSwipe(@CurrentUser() user: AuthUser): Promise<void> {
    return this.swipes.undoLast(user.id);
  }
}
