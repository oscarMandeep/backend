import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Env } from '../config/env.schema';

export const SKILL_CATEGORIES = [
  'Programming',
  'Data',
  'Design',
  'Creative',
  'Music',
  'Languages',
  'Fitness',
  'Wellness',
  'Cooking',
  'Business',
  'Games',
  'Art',
  'Lifestyle',
  'Other',
] as const;

export interface NormalizedSkill {
  name: string;
  category: string;
}

const answerSchema = z.object({
  name: z.string().trim().min(2).max(60),
  category: z.string().trim(),
});

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.1-8b-instant';

/** "exel   formulas" -> "Exel Formulas". Used when Groq is unavailable. */
export function titleCase(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

@Injectable()
export class GroqService {
  private readonly logger = new Logger(GroqService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  /**
   * Turns free text ("exel", "playing guitar") into a canonical skill name and
   * category. The reply is validated, so a bad or hostile model answer can never
   * put anything unexpected in the database. Falls back to title-casing.
   */
  async normalizeSkill(rawInput: string): Promise<NormalizedSkill> {
    const input = rawInput.trim().replace(/\s+/g, ' ').slice(0, 80);
    const fallback: NormalizedSkill = {
      name: titleCase(input),
      category: 'Other',
    };

    const apiKey = this.config.get('GROQ_API_KEY', { infer: true });
    if (!apiKey) return fallback;

    try {
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          model: MODEL,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'You normalize skill names for a skill-swapping app. Reply ONLY with JSON ' +
                '{"name": string, "category": string}. "name" is the canonical English ' +
                'title-case skill name, at most 5 words, fixing typos (e.g. "exel" -> ' +
                '"Microsoft Excel"). "category" must be exactly one of: ' +
                `${SKILL_CATEGORIES.join(', ')}.`,
            },
            { role: 'user', content: input },
          ],
        }),
      });
      if (!res.ok) throw new Error(`Groq responded ${res.status}`);

      const payload = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = payload.choices?.[0]?.message?.content ?? '';
      const parsed = answerSchema.parse(JSON.parse(content));
      const category = (SKILL_CATEGORIES as readonly string[]).includes(
        parsed.category,
      )
        ? parsed.category
        : 'Other';
      return { name: parsed.name, category };
    } catch (err) {
      this.logger.warn(`Groq normalize failed, using fallback: ${String(err)}`);
      return fallback;
    }
  }
}
