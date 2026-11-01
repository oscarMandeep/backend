import { Body, Controller, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { CreateReviewDto, ReviewDto } from './dto/review.dto';
import { ReviewsService } from './reviews.service';

@ApiTags('reviews')
@ApiCookieAuth()
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post()
  @ApiCreatedResponse({ type: ReviewDto })
  createReview(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateReviewDto,
  ): Promise<ReviewDto> {
    return this.reviews.create(user.id, dto);
  }
}
