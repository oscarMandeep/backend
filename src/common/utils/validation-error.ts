import { UnprocessableEntityException } from '@nestjs/common';

/** 422 VALIDATION_FAILED with field details, for rules DTO decorators can't express. */
export function validationError(
  details: Record<string, string[]>,
): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'VALIDATION_FAILED',
    message: 'Validation failed',
    details,
  });
}
