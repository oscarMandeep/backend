import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { createValidationPipe } from './common/pipes/validation.pipe';
import type { Env } from './config/env.schema';

/** Everything main.ts and the e2e tests must share. Swagger is added by main.ts. */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  app.set('trust proxy', 1); // behind Render + Vercel proxies
  app.setGlobalPrefix('v1');
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config.get('WEB_URL', { infer: true }),
    credentials: true,
  });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter());
}
