import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('SkillSwap API')
    .setVersion('1')
    .build();
  // Operation ids = method names, so generated hooks read useGetMe(), useRefresh()...
  return SwaggerModule.createDocument(app, config, {
    operationIdFactory: (_controllerKey, methodKey) => methodKey,
  });
}

export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('docs', app, buildOpenApiDocument(app));
}
