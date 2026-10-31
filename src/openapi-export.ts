import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { buildOpenApiDocument } from './swagger';

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('v1');
  const doc = buildOpenApiDocument(app);
  writeFileSync(
    join(__dirname, '..', 'openapi.json'),
    JSON.stringify(doc, null, 2) + '\n',
  );
  await app.close();
  console.log('openapi.json written');
}
void main();
