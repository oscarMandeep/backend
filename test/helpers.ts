process.env.NODE_ENV = 'development'; // dev-login exists only in development

import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Mode, Priority } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

export interface TestApp {
  app: NestExpressApplication;
  prisma: PrismaService;
  /** http://127.0.0.1:<port>: the app really listens, so sockets can connect too. */
  baseUrl: string;
  http: () => ReturnType<typeof request>;
  /** Session cookies for an existing user (by email). */
  login: (email: string) => Promise<string[]>;
  /** A 60 s socket token for the user behind these cookies. */
  socketToken: (cookies: string[]) => Promise<string>;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  const http = () => request(baseUrl);
  return {
    app,
    prisma: app.get(PrismaService),
    baseUrl,
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
    socketToken: async (cookies) => {
      const res = await http()
        .get('/v1/auth/socket-token')
        .set('Cookie', cookies)
        .expect(200);
      return (res.body as { token: string }).token;
    },
    close: () => app.close(),
  };
}

export const body = <T>(res: request.Response): T => res.body as T;

export interface ApiErrorBody {
  statusCode: number;
  error: { code: string; message: string; details?: Record<string, string[]> };
}

/** 4 shared hours a week: every pair made with makeUser overlaps fully. */
export const EVENINGS = [
  { dayOfWeek: 1, startMin: 1080, endMin: 1200 },
  { dayOfWeek: 6, startMin: 600, endMin: 720 },
];

export interface MakeUserOptions {
  haves: { skillId: string; level: number }[];
  wants?: { skillId: string; goalLevel?: number }[];
  mode?: Mode;
  languages?: string[];
  onboarded?: boolean;
}

/** A ready-to-match user in Dehradun. `key` is used for the email and username. */
export function makeUser(
  prisma: PrismaService,
  key: string,
  o: MakeUserOptions,
) {
  return prisma.user.create({
    data: {
      email: `${key}@test.dev`,
      username: key,
      name: key,
      city: 'Dehradun',
      mode: o.mode ?? Mode.BOTH,
      languages: o.languages ?? ['English'],
      onboarded: o.onboarded ?? true,
      haves: { create: o.haves },
      wants: {
        create: (o.wants ?? []).map((w) => ({
          skillId: w.skillId,
          currentLevel: 1,
          goalLevel: w.goalLevel ?? 3,
          priority: Priority.HIGH,
        })),
      },
      slots: { create: EVENINGS },
    },
  });
}
