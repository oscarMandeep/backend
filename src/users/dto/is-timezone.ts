import { registerDecorator, ValidationOptions } from 'class-validator';

function isTimeZone(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Valid IANA time zone such as "Asia/Kolkata". */
export function IsTimeZone(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isTimeZone',
      target: object.constructor,
      propertyName,
      options: {
        message: 'timezone must be a valid IANA time zone',
        ...options,
      },
      validator: { validate: isTimeZone },
    });
}
