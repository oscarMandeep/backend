import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Events, type UserUpdatedEvent } from '../common/events';
import { validationError } from '../common/utils/validation-error';
import { Mode, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { findSlotProblems } from './availability';
import { lookupCity } from './cities';
import type { AvailabilitySlotDto, MeDto } from './dto/me.dto';
import type { UpdateAvailabilityDto } from './dto/update-availability.dto';
import type { UpdateMeDto } from './dto/update-me.dto';
import type { UpdateSkillsDto } from './dto/update-skills.dto';

const duplicates = (ids: string[]): string[] =>
  ids.filter((id, i) => ids.indexOf(id) !== i);

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async getMe(userId: string): Promise<MeDto> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        haves: { include: { skill: true } },
        wants: { include: { skill: true } },
        slots: { orderBy: [{ dayOfWeek: 'asc' }, { startMin: 'asc' }] },
      },
    });
    if (!u) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found.',
      });
    }
    const ref = (s: {
      id: string;
      name: string;
      slug: string;
      category: string;
    }) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      category: s.category,
    });
    return {
      id: u.id,
      username: u.username,
      name: u.name,
      avatarUrl: u.avatarUrl,
      bio: u.bio,
      city: u.city,
      mode: u.mode,
      languages: u.languages,
      ratingAvg: u.ratingAvg,
      ratingCount: u.ratingCount,
      sessionsDone: u.sessionsDone,
      isNew: u.sessionsDone === 0,
      haves: u.haves.map((h) => ({
        skill: ref(h.skill),
        level: h.level,
        verified: h.verified,
      })),
      wants: u.wants.map((w) => ({
        skill: ref(w.skill),
        goalLevel: w.goalLevel,
        priority: w.priority,
      })),
      email: u.email,
      timezone: u.timezone,
      credits: u.credits,
      onboarded: u.onboarded,
      isPublic: u.isPublic,
      availability: u.slots.map((s) => ({
        dayOfWeek: s.dayOfWeek,
        startMin: s.startMin,
        endMin: s.endMin,
      })),
    };
  }

  async updateMe(userId: string, dto: UpdateMeDto): Promise<MeDto> {
    const data: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.username !== undefined) data.username = dto.username;
    if (dto.bio !== undefined) data.bio = dto.bio.trim() || null;
    if (dto.mode !== undefined) data.mode = dto.mode;
    if (dto.languages !== undefined)
      data.languages = [...new Set(dto.languages.map((l) => l.trim()))];
    if (dto.timezone !== undefined) data.timezone = dto.timezone;
    if (dto.isPublic !== undefined) data.isPublic = dto.isPublic;
    if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl;
    if (dto.city !== undefined) {
      const city = dto.city.trim();
      const geo = city ? lookupCity(city) : null;
      data.city = city || null;
      data.lat = geo?.lat ?? null;
      data.lng = geo?.lng ?? null;
    }

    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data,
        select: { username: true },
      });
      this.emitUpdated(userId, user.username);
    } catch (err) {
      if ((err as { code?: unknown }).code === 'P2002') {
        throw new ConflictException({
          code: 'USERNAME_TAKEN',
          message: 'That username is taken.',
        });
      }
      throw err;
    }
    return this.getMe(userId);
  }

  /** Replaces the whole have/want lists (the onboarding and profile screens send both). */
  async updateMySkills(userId: string, dto: UpdateSkillsDto): Promise<MeDto> {
    const haveIds = dto.haves.map((h) => h.skillId);
    const wantIds = dto.wants.map((w) => w.skillId);
    const details: Record<string, string[]> = {};

    if (duplicates(haveIds).length)
      details.haves = ['each skill can only be listed once'];
    if (duplicates(wantIds).length)
      details.wants = ['each skill can only be listed once'];
    if (haveIds.some((id) => wantIds.includes(id))) {
      details.wants = [
        ...(details.wants ?? []),
        'a skill cannot be both something you have and want',
      ];
    }
    const badGoal = dto.wants.filter((w) => w.goalLevel < w.currentLevel);
    if (badGoal.length) {
      details.wants = [
        ...(details.wants ?? []),
        'goalLevel must be at least currentLevel',
      ];
    }

    const known = await this.prisma.skill.findMany({
      where: { id: { in: [...new Set([...haveIds, ...wantIds])] } },
      select: { id: true },
    });
    const knownIds = new Set(known.map((s) => s.id));
    if (haveIds.some((id) => !knownIds.has(id))) {
      details.haves = [...(details.haves ?? []), 'unknown skillId'];
    }
    if (wantIds.some((id) => !knownIds.has(id))) {
      details.wants = [...(details.wants ?? []), 'unknown skillId'];
    }
    if (Object.keys(details).length) throw validationError(details);

    // Keep the verified badge of skills that stay in the list.
    const before = await this.prisma.userSkillHave.findMany({
      where: { userId },
      select: { skillId: true, verified: true },
    });
    const verified = new Map(before.map((h) => [h.skillId, h.verified]));

    await this.prisma.$transaction([
      this.prisma.userSkillHave.deleteMany({ where: { userId } }),
      this.prisma.userSkillWant.deleteMany({ where: { userId } }),
      this.prisma.userSkillHave.createMany({
        data: dto.haves.map((h) => ({
          userId,
          skillId: h.skillId,
          level: h.level,
          years: h.years ?? null,
          proofUrl: h.proofUrl ?? null,
          verified: verified.get(h.skillId) ?? false,
        })),
      }),
      this.prisma.userSkillWant.createMany({
        data: dto.wants.map((w) => ({
          userId,
          skillId: w.skillId,
          currentLevel: w.currentLevel,
          goalLevel: w.goalLevel,
          priority: w.priority,
        })),
      }),
    ]);
    await this.emitUpdatedFor(userId);
    return this.getMe(userId);
  }

  async updateMyAvailability(
    userId: string,
    dto: UpdateAvailabilityDto,
  ): Promise<AvailabilitySlotDto[]> {
    const problems = findSlotProblems(dto.slots);
    if (problems.length) throw validationError({ slots: problems });

    await this.prisma.$transaction([
      this.prisma.availabilitySlot.deleteMany({ where: { userId } }),
      this.prisma.availabilitySlot.createMany({
        data: dto.slots.map((s) => ({
          userId,
          dayOfWeek: s.dayOfWeek,
          startMin: s.startMin,
          endMin: s.endMin,
        })),
      }),
    ]);
    await this.emitUpdatedFor(userId);
    return (await this.getMe(userId)).availability;
  }

  /** Marks onboarding done once the profile has what matching needs. */
  async completeOnboarding(userId: string): Promise<MeDto> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        mode: true,
        city: true,
        languages: true,
        _count: { select: { haves: true, wants: true, slots: true } },
      },
    });
    if (!u) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found.',
      });
    }

    const details: Record<string, string[]> = {};
    if (u._count.haves < 1)
      details.haves = ['add at least one skill you can teach'];
    if (u._count.wants < 1)
      details.wants = ['add at least one skill you want to learn'];
    if (u._count.slots < 1)
      details.availability = ['add at least one availability slot'];
    if (u.languages.length < 1)
      details.languages = ['add at least one language'];
    if (u.mode !== Mode.ONLINE && !u.city)
      details.city = ['city is required for in-person sessions'];
    if (Object.keys(details).length) throw validationError(details);

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { onboarded: true },
      select: { username: true },
    });
    this.emitUpdated(userId, user.username);
    return this.getMe(userId);
  }

  private async emitUpdatedFor(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    if (user) this.emitUpdated(userId, user.username);
  }

  private emitUpdated(userId: string, username: string): void {
    const event: UserUpdatedEvent = { userId, username };
    this.events.emit(Events.UserUpdated, event);
  }
}
