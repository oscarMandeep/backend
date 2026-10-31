import {
  UnprocessableEntityException,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';

function collect(
  errors: ValidationError[],
  prefix = '',
  out: Record<string, string[]> = {},
): Record<string, string[]> {
  for (const e of errors) {
    const path = prefix ? `${prefix}.${e.property}` : e.property;
    if (e.constraints) out[path] = Object.values(e.constraints);
    if (e.children?.length) collect(e.children, path, out);
  }
  return out;
}

/** ValidationPipe whose failures become 422 VALIDATION_FAILED with field details. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    exceptionFactory: (errors) =>
      new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        details: collect(errors),
      }),
  });
}
