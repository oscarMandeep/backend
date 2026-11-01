import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';

const COALESCE_MS = 1000;
const TIMEOUT_MS = 5000;

/**
 * Tells the website which cached (ISR) pages are stale: POST WEB_URL/internal/revalidate.
 * - Tags are collected for a second and sent as ONE request, so a burst of edits
 *   does not become a burst of webhooks.
 * - Fire-and-forget with a 5 s timeout: a failure is logged and never reaches the
 *   user who made the change (the website may be asleep or down).
 */
@Injectable()
export class RevalidateService implements OnModuleDestroy {
  private readonly logger = new Logger(RevalidateService.name);
  private readonly pending = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {}

  queue(tags: string[]): void {
    for (const tag of tags) this.pending.add(tag);
    if (this.timer || this.pending.size === 0) return;
    this.timer = setTimeout(() => void this.flush(), COALESCE_MS);
    this.timer.unref(); // never keep the process alive just for this
  }

  /** Sends everything queued so far. Safe to call at any time; never throws. */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.pending.size === 0) return;
    const tags = [...this.pending].sort();
    this.pending.clear();

    try {
      const res = await fetch(
        `${this.config.get('WEB_URL', { infer: true })}/internal/revalidate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-revalidate-secret': this.config.get('REVALIDATE_SECRET', {
              infer: true,
            }),
          },
          body: JSON.stringify({ tags }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      if (!res.ok)
        this.logger.warn(
          `revalidate answered ${res.status} for ${tags.join(', ')}`,
        );
    } catch (err) {
      this.logger.warn(
        `revalidate failed (${tags.join(', ')}): ${String(err)}`,
      );
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
