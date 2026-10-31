import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

export interface ApiErrorBody {
  statusCode: number;
  error: {
    code: string;
    message: string;
    details?: Record<string, string[]>;
  };
}

const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
};

interface DbErrorLike {
  code?: unknown;
  message?: unknown;
  meta?: { code?: unknown };
}

function asDbError(exception: unknown): DbErrorLike | null {
  return typeof exception === 'object' && exception !== null ? exception : null;
}

/** Postgres exclusion_violation (23P01), raw or wrapped by Prisma (P2010). */
function isExclusionViolation(e: DbErrorLike): boolean {
  return (
    e.code === '23P01' ||
    e.meta?.code === '23P01' ||
    (typeof e.message === 'string' &&
      e.message.includes('violates exclusion constraint'))
  );
}

/** Turns every thrown error into the envelope from docs/04-api-contract.md. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { statusCode, error } = this.toEnvelope(exception);
    const body: ApiErrorBody = { statusCode, error };
    res.status(statusCode).json(body);
  }

  private toEnvelope(exception: unknown): ApiErrorBody {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      if (typeof raw === 'object' && raw !== null) {
        const r = raw as {
          code?: string;
          message?: string | string[];
          details?: Record<string, string[]>;
        };
        const message = Array.isArray(r.message)
          ? r.message.join(', ')
          : (r.message ?? exception.message);
        return {
          statusCode: status,
          error: {
            code: r.code ?? CODE_BY_STATUS[status] ?? 'ERROR',
            message,
            ...(r.details ? { details: r.details } : {}),
          },
        };
      }
      return {
        statusCode: status,
        error: {
          code: CODE_BY_STATUS[status] ?? 'ERROR',
          message: String(raw),
        },
      };
    }

    const db = asDbError(exception);
    if (db?.code === 'P2002') {
      return {
        statusCode: HttpStatus.CONFLICT,
        error: { code: 'CONFLICT', message: 'This already exists.' },
      };
    }
    if (db && isExclusionViolation(db)) {
      return {
        statusCode: HttpStatus.CONFLICT,
        error: {
          code: 'SLOT_TAKEN',
          message: 'That time slot is already taken.',
        },
      };
    }

    this.logger.error(
      exception instanceof Error
        ? (exception.stack ?? exception.message)
        : String(exception),
    );
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' },
    };
  }
}
