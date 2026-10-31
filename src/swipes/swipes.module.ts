import { Module } from '@nestjs/common';
import { MatchesModule } from '../matches/matches.module';
import { MatchingModule } from '../matching/matching.module';
import { SwipesController } from './swipes.controller';
import { SwipesService } from './swipes.service';

@Module({
  imports: [MatchingModule, MatchesModule],
  controllers: [SwipesController],
  providers: [SwipesService],
})
export class SwipesModule {}
