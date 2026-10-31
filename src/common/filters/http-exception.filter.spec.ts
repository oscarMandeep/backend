import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

type Body = {
  statusCode: number;
  error: { code: string; message: string; details?: Record<string, string[]> };
};

function run(exception: unknown) {
  let statusCode = 0;
  let body!: Body;
  const res = {
    status: (code: number) => {
      statusCode = code;
      return {
        json: (b: Body) => {
          body = b;
        },
      };
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost;
  new HttpExceptionFilter().catch(exception, host);
  return { statusCode, body };
}

describe('HttpExceptionFilter', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('wraps a plain HttpException in the envelope', () => {
    const { statusCode, body } = run(new NotFoundException('Match not found'));
    expect(statusCode).toBe(404);
    expect(body).toEqual({
      statusCode: 404,
      error: { code: 'NOT_FOUND', message: 'Match not found' },
    });
  });

  it('maps status codes to stable codes', () => {
    expect(run(new ForbiddenException()).body.error.code).toBe('FORBIDDEN');
    expect(run(new BadRequestException()).body.error.code).toBe('BAD_REQUEST');
  });

  it('keeps a custom code, message and details (422 validation)', () => {
    const { statusCode, body } = run(
      new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        details: { email: ['email must be an email'] },
      }),
    );
    expect(statusCode).toBe(422);
    expect(body.error.details).toEqual({ email: ['email must be an email'] });
  });

  it('maps Prisma P2002 to 409', () => {
    const { statusCode, body } = run({
      code: 'P2002',
      message: 'Unique constraint',
    });
    expect(statusCode).toBe(409);
    expect(body.error.code).toBe('CONFLICT');
  });

  it('maps Postgres 23P01 to 409 SLOT_TAKEN (raw and Prisma-wrapped)', () => {
    expect(run({ code: '23P01' }).body.error.code).toBe('SLOT_TAKEN');
    expect(
      run({ code: 'P2010', meta: { code: '23P01' } }).body.error.code,
    ).toBe('SLOT_TAKEN');
    const byMessage = run(
      new Error('conflicting key value violates exclusion constraint "x"'),
    );
    expect(byMessage.statusCode).toBe(409);
  });

  it('hides unknown errors behind a generic 500', () => {
    const { statusCode, body } = run(new Error('secret db password leaked'));
    expect(statusCode).toBe(500);
    expect(body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong.',
    });
  });
});
