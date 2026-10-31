process.env.NODE_ENV = 'development'; // dev-login exists only in development

import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

export interface TestApp {
  app: NestExpressApplication;
  prisma: PrismaService;
  http: () => ReturnType<typeof request>;
  /** Creates (or reuses) a user by email and returns its session cookies. */
  login: (email: string) => Promise<string[]>;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  const http = () => request(app.getHttpServer());
  return {
    app,
    prisma: app.get(PrismaService),
    http,
    login: async (email) => {
      const res = await http()
        .post('/v1/auth/dev-login')
        .send({ email })
        .expect(204);
      return (
        (res.headers['set-cookie'] as unknown as string[] | undefined) ?? []
      );
    },
    close: () => app.close(),
  };
}

export const body = <T>(res: request.Response): T => res.body as T;

export interface ApiErrorBody {
  statusCode: number;
  error: { code: string; message: string; details?: Record<string, string[]> };
}
