import { z } from 'zod';

const optionalString = z.string().default('');

export const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
  WEB_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  SOCKET_JWT_SECRET: z.string().min(32),
  REVALIDATE_SECRET: z.string().min(1),
  GOOGLE_CALLBACK_URL: z.string().url(),
  // Needed in later phases; empty is fine until then.
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GROQ_API_KEY: optionalString,
  RESEND_API_KEY: optionalString,
  EMAIL_FROM: optionalString,
  CLOUDINARY_URL: optionalString,
});

export type Env = z.infer<typeof envSchema>;

/** Used by ConfigModule: throws a readable error and stops boot if env is wrong. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${problems}`);
  }
  return parsed.data;
}
