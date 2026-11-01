/**
 * Production-safe seed: only the skill catalogue. No users, no passwords, nothing is
 * deleted, and it can be run again (existing skills are left alone).
 *
 *   pnpm prisma:seed:skills
 *
 * Run `pnpm embed:skills` afterwards so fuzzy matching has its vectors.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { slugify } from '../src/common/utils/slugify';
import { SKILLS } from './skills-data';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  let added = 0;
  for (const s of SKILLS) {
    const slug = slugify(s.name);
    const exists = await prisma.skill.findUnique({ where: { slug } });
    if (exists) continue;
    await prisma.skill.create({
      data: { name: s.name, slug, category: s.category, aliases: s.aliases },
    });
    added++;
  }
  console.log(`Skills: ${added} added, ${SKILLS.length - added} already there.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
