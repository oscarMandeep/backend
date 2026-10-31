import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';

class HealthResponse {
  @ApiProperty({ example: 'ok' })
  status!: 'ok';
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  /** Must never touch the database: Neon would never get to sleep (free tier). */
  @Public()
  @Get()
  @ApiOkResponse({ type: HealthResponse })
  getHealth(): HealthResponse {
    return { status: 'ok' };
  }
}
