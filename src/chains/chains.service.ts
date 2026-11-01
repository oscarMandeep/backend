import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Events, type ChainEvent } from '../common/events';
import { ChainStatus, MatchStatus, Prisma } from '../generated/prisma/client';
import { toSkillRef, toUserCard } from '../matching/mappers';
import {
  matchUserInclude,
  MatchingService,
  toProfile,
  type MatchUser,
} from '../matching/matching.service';
import { loadSimilarity } from '../matching/matching.queries';
import { scoreMatch } from '../matching/score';
import { MatchesService } from '../matches/matches.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from '../sessions/sessions.service';
import { SlotsService } from '../sessions/slots.service';
import { findLoopRows, findUsersWithoutMatches } from './chains.queries';
import {
  meanScore,
  pairsOf,
  sameMembers,
  uniqueLoops,
  type Loop,
} from './cycles';
import type { ChainDto } from './dto/chain.dto';

const EXPIRES_AFTER_MS = 48 * 60 * 60 * 1000;
const SESSION_MIN = 60;

const chainInclude = {
  members: {
    include: { user: { include: matchUserInclude }, teachSkill: true },
    orderBy: { position: 'asc' },
  },
} satisfies Prisma.SwapChainInclude;

type ChainRow = Prisma.SwapChainGetPayload<{ include: typeof chainInclude }>;

const conflict = (code: string, message: string) =>
  new ConflictException({ code, message });

@Injectable()
export class ChainsService {
  private readonly logger = new Logger(ChainsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
    private readonly matches: MatchesService,
    private readonly sessions: SessionsService,
    private readonly slots: SlotsService,
    private readonly events: EventEmitter2,
  ) {}

  // ── reads ───────────────────────────────────────────────────────────────

  async list(userId: string): Promise<ChainDto[]> {
    const rows = await this.prisma.swapChain.findMany({
      where: { members: { some: { userId } } },
      include: chainInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    return rows.map((r) => this.toDto(r));
  }

  async getFor(chainId: string): Promise<ChainDto> {
    const row = await this.prisma.swapChain.findUniqueOrThrow({
      where: { id: chainId },
      include: chainInclude,
    });
    return this.toDto(row);
  }

  // ── finding loops ───────────────────────────────────────────────────────

  /** Proposes every valid new loop through this user. Returns the ids of the chains created. */
  async findForUser(userId: string, now = new Date()): Promise<string[]> {
    const loops = uniqueLoops(await findLoopRows(this.prisma, userId));
    const created: string[] = [];
    for (const loop of loops) {
      const id = await this.proposeLoop(loop, now);
      if (id) created.push(id);
    }
    return created;
  }

  /** The cron job: people with no active match are the ones a chain can help. */
  async findForEligibleUsers(
    limit = 50,
    now = new Date(),
  ): Promise<{ users: number; created: number }> {
    const ids = await findUsersWithoutMatches(this.prisma, limit);
    let created = 0;
    for (const id of ids) created += (await this.findForUser(id, now)).length;
    return { users: ids.length, created };
  }

  /** Proposals nobody finished answering within 48 hours become EXPIRED. */
  async expireOverdue(now = new Date()): Promise<number> {
    const overdue = await this.prisma.swapChain.findMany({
      where: { status: ChainStatus.PROPOSED, expiresAt: { lte: now } },
      select: { id: true },
    });
    let expired = 0;
    for (const { id } of overdue) {
      const claimed = await this.prisma.swapChain.updateMany({
        where: { id, status: ChainStatus.PROPOSED },
        data: { status: ChainStatus.EXPIRED },
      });
      if (claimed.count === 1) {
        expired++;
        await this.emit(Events.ChainUpdated, id);
      }
    }
    return expired;
  }

  /**
   * Checks a loop the SQL found, and creates the proposal if it is genuinely useful:
   * every hand-over must be a valid match (language, level), nobody may have blocked
   * anybody, and no two members could simply swap with each other (then a chain adds
   * nothing). Returns the new chain's id, or null when the loop is skipped.
   */
  private async proposeLoop(loop: Loop, now: Date): Promise<string | null> {
    const found = await this.prisma.user.findMany({
      where: { id: { in: loop.members } },
      include: matchUserInclude,
    });
    const byId = new Map<string, MatchUser>(found.map((u) => [u.id, u]));
    const people = loop.members.map((id) => byId.get(id));
    if (people.some((p) => !p?.onboarded)) return null;
    const members = people as MatchUser[];

    const similarity = await loadSimilarity(
      this.prisma,
      members.flatMap((m) => [
        ...m.haves.map((h) => h.skillId),
        ...m.wants.map((w) => w.skillId),
      ]),
    );

    // Each hand-over: member i teaches member i+1.
    const handOvers: number[] = [];
    for (let i = 0; i < members.length; i++) {
      const teacher = members[i];
      const learner = members[(i + 1) % members.length];
      const result = scoreMatch(
        toProfile(learner),
        toProfile(teacher),
        similarity,
      );
      if (!result) return null;
      handOvers.push(result.score);
    }

    for (const [x, y] of pairsOf(members)) {
      // A pair that could swap directly should just match; no chain needed.
      if (scoreMatch(toProfile(x), toProfile(y), similarity)?.type === 'SWAP')
        return null;
    }

    const ids = members.map((m) => m.id);
    const blocked = await this.prisma.block.findFirst({
      where: { blockerId: { in: ids }, blockedId: { in: ids } },
      select: { id: true },
    });
    if (blocked) return null;

    const created = await this.prisma.$transaction(async (tx) => {
      // One proposal at a time: re-check for duplicates under a lock, so two runs
      // (cron and a manual one) can never propose the same loop twice.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('swap-chains', 0))`;

      const open = await tx.chainMember.count({
        where: {
          userId: { in: ids },
          chain: { status: ChainStatus.PROPOSED },
        },
      });
      if (open > 0) return null; // someone is already deciding on another chain

      const accepted = await tx.swapChain.findMany({
        where: {
          status: ChainStatus.ACCEPTED,
          members: { some: { userId: { in: ids } } },
        },
        select: { members: { select: { userId: true } } },
      });
      if (
        accepted.some((c) =>
          sameMembers(
            c.members.map((m) => m.userId),
            ids,
          ),
        )
      )
        return null;

      return tx.swapChain.create({
        data: {
          status: ChainStatus.PROPOSED,
          score: meanScore(handOvers),
          expiresAt: new Date(now.getTime() + EXPIRES_AFTER_MS),
          members: {
            create: loop.members.map((userId, position) => ({
              userId,
              position,
              teachSkillId: loop.teaches[position],
            })),
          },
        },
        select: { id: true },
      });
    });
    if (!created) return null;

    await this.emit(Events.ChainProposed, created.id);
    return created.id;
  }

  // ── responding ──────────────────────────────────────────────────────────

  /**
   * Anyone declining rejects the whole chain; when everybody has accepted it becomes
   * ACCEPTED and the neighbours get a chat (and a first proposed session).
   */
  async respond(
    userId: string,
    chainId: string,
    accept: boolean,
    now = new Date(),
  ): Promise<ChainDto> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      // Lock the chain row: two people answering at the same instant are handled one
      // after the other, so the last accept always sees all the others.
      await tx.$queryRaw`SELECT id FROM swap_chains WHERE id = ${chainId} FOR UPDATE`;
      const chain = await tx.swapChain.findUnique({
        where: { id: chainId },
        include: { members: true },
      });
      if (!chain) {
        throw new NotFoundException({
          code: 'CHAIN_NOT_FOUND',
          message: 'Chain not found.',
        });
      }
      const me = chain.members.find((m) => m.userId === userId);
      if (!me) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'You are not part of this chain.',
        });
      }
      if (chain.status !== ChainStatus.PROPOSED) {
        throw conflict(
          'CHAIN_NOT_PROPOSED',
          'This chain is no longer waiting for answers.',
        );
      }
      if (chain.expiresAt.getTime() <= now.getTime()) {
        throw conflict('CHAIN_EXPIRED', 'This chain has expired.');
      }
      if (me.accepted !== null) {
        throw conflict('ALREADY_RESPONDED', 'You already answered this chain.');
      }

      await tx.chainMember.update({
        where: { id: me.id },
        data: { accepted: accept },
      });
      const everyoneElseAccepted = chain.members
        .filter((m) => m.userId !== userId)
        .every((m) => m.accepted === true);
      const status = !accept
        ? ChainStatus.REJECTED
        : everyoneElseAccepted
          ? ChainStatus.ACCEPTED
          : ChainStatus.PROPOSED;
      if (status !== ChainStatus.PROPOSED) {
        await tx.swapChain.update({ where: { id: chainId }, data: { status } });
      }
      return status;
    });

    await this.emit(Events.ChainUpdated, chainId);
    // Only the request that completed the chain gets here with ACCEPTED, so this runs once.
    if (outcome === ChainStatus.ACCEPTED) await this.onAccepted(chainId);
    return this.getFor(chainId);
  }

  /** Everyone said yes: open a chat between each pair, and propose a first session. */
  private async onAccepted(chainId: string): Promise<void> {
    const chain = await this.prisma.swapChain.findUniqueOrThrow({
      where: { id: chainId },
      include: { members: { orderBy: { position: 'asc' } } },
    });
    const { members } = chain;
    for (let i = 0; i < members.length; i++) {
      const teacher = members[i];
      const learner = members[(i + 1) % members.length];
      try {
        const matchId = await this.ensureChainMatch(
          teacher.userId,
          learner.userId,
          chain.score,
        );
        if (matchId)
          await this.proposeFirstSession(
            matchId,
            teacher.userId,
            teacher.teachSkillId,
          );
      } catch (err) {
        // The chain itself is ACCEPTED either way; the pair can still schedule in chat.
        this.logger.error(
          `chain ${chainId}: could not set up ${teacher.userId} -> ${learner.userId}: ${String(err)}`,
        );
      }
    }
  }

  private async ensureChainMatch(
    teacherId: string,
    learnerId: string,
    score: number,
  ): Promise<string | null> {
    const [userAId, userBId] = [teacherId, learnerId].sort();
    const where = { userAId_userBId: { userAId, userBId } };
    const existing = await this.prisma.match.findUnique({ where });
    if (existing)
      return existing.status === MatchStatus.ACTIVE ? existing.id : null;

    try {
      const match = await this.prisma.match.create({
        data: { userAId, userBId, type: 'CHAIN', score, breakdown: {} },
        select: { id: true },
      });
      this.matches.announce({ matchId: match.id, userAId, userBId });
      return match.id;
    } catch (err) {
      if ((err as { code?: unknown }).code === 'P2002') {
        return (await this.prisma.match.findUnique({ where }))?.id ?? null;
      }
      throw err;
    }
  }

  /** The teacher proposes the earliest time both can make; the learner confirms. */
  private async proposeFirstSession(
    matchId: string,
    teacherId: string,
    skillId: string,
  ): Promise<void> {
    const [first] = await this.slots.suggest(
      teacherId,
      matchId,
      14,
      SESSION_MIN,
    );
    if (!first) return; // no common time yet; they can pick one in the chat
    await this.sessions.propose(teacherId, {
      matchId,
      skillId,
      teacherId,
      startsAt: first.startsAt,
      durationMin: SESSION_MIN,
      mode: 'ONLINE',
    });
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  private async emit(event: string, chainId: string): Promise<void> {
    const members = await this.prisma.chainMember.findMany({
      where: { chainId },
      select: { userId: true },
    });
    const payload: ChainEvent = {
      chainId,
      userIds: members.map((m) => m.userId),
    };
    this.events.emit(event, payload);
  }

  private toDto(chain: ChainRow): ChainDto {
    return {
      id: chain.id,
      status: chain.status,
      score: chain.score,
      expiresAt: chain.expiresAt.toISOString(),
      members: chain.members.map((m) => ({
        position: m.position,
        user: toUserCard(m.user),
        teachSkill: toSkillRef(m.teachSkill),
        accepted: m.accepted,
      })),
    };
  }
}
