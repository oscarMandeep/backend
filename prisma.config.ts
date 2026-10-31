import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Migrations use the direct (non-pooled) URL. Locally both URLs are the same.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DIRECT_URL'),
  },
});
