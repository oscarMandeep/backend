import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { pipeline } from '@huggingface/transformers';
import { PrismaClient } from '../src/generated/prisma/client';

// Run locally only: the model is far too big for the free Render instance.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  const skills = await prisma.skill.findMany({
    select: { id: true, name: true, category: true, aliases: true },
  });

  for (const s of skills) {
    // Name + category + aliases give the model enough context to place the skill.
    const text = `${s.name} (${s.category}) ${s.aliases.join(', ')}`;
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    const vector = `[${Array.from(output.data as Float32Array).join(',')}]`;
    await prisma.$executeRaw`UPDATE skills SET embedding = ${vector}::vector WHERE id = ${s.id}`;
  }
  console.log(`Embedded ${skills.length} skills (384 dimensions each).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
