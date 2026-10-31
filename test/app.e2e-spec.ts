import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('App (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
  });

  afterAll(() => app.close());

  it('GET /v1/health returns ok without auth', () =>
    request(app.getHttpServer())
      .get('/v1/health')
      .expect(200)
      .expect({ status: 'ok' }));

  it('unknown route uses the error envelope', async () => {
    const res = await request(app.getHttpServer()).get('/v1/nope').expect(404);
    expect(res.body).toMatchObject({
      statusCode: 404,
      error: { code: 'NOT_FOUND' },
    });
  });
});
