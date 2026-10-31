import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { GroqService } from '../ai/groq.service';
import { slugify } from '../common/utils/slugify';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { SkillRefDto } from './dto/skill-ref.dto';

const REF = { id: true, name: true, slug: true, category: true } as const;

@Injectable()
export class SkillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly groq: GroqService,
  ) {}

  /**
   * Typo-tolerant search (tested: "exel" -> Microsoft Excel). word_similarity on
   * the name plus similarity on the aliases, threshold 0.3 (docs/02-backend-plan.md).
   */
  async search(q: string, limit = 8): Promise<SkillRefDto[]> {
    const text = q.trim();
    // Escape LIKE wildcards so user input is matched literally.
    const like = text.replace(/[\\%_]/g, '\\$&');
    return this.prisma.$queryRaw<SkillRefDto[]>(Prisma.sql`
      SELECT s.id, s.name, s.slug, s.category
      FROM skills s
      LEFT JOIN LATERAL unnest(s.aliases) a ON true
      WHERE s.name ILIKE '%' || ${like} || '%'
         OR word_similarity(${text}, s.name) > 0.3
         OR similarity(${text}, a) > 0.3
      GROUP BY s.id
      ORDER BY max(GREATEST(word_similarity(${text}, s.name), similarity(${text}, a))) DESC NULLS LAST,
               s.name ASC
      LIMIT ${limit}
    `);
  }

  /** Normalise the text, reuse the skill if it already exists, otherwise create it. */
  async create(rawName: string): Promise<SkillRefDto> {
    const { name, category } = await this.groq.normalizeSkill(rawName);
    const slug = slugify(name);
    if (!slug) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        details: { name: ['name must contain letters or numbers'] },
      });
    }

    const existing = await this.findExisting(name, slug, rawName);
    if (existing) return existing;

    try {
      return await this.prisma.skill.create({
        data: { name, slug, category },
        select: REF,
      });
    } catch (err) {
      // Lost a race with another request creating the same skill.
      if ((err as { code?: unknown }).code === 'P2002') {
        const winner = await this.prisma.skill.findUnique({
          where: { slug },
          select: REF,
        });
        if (winner) return winner;
      }
      throw err;
    }
  }

  private findExisting(name: string, slug: string, rawName: string) {
    return this.prisma.skill.findFirst({
      where: {
        OR: [
          { name: { equals: name, mode: 'insensitive' } },
          { slug },
          { aliases: { has: rawName.trim().toLowerCase() } },
        ],
      },
      select: REF,
    });
  }
}
