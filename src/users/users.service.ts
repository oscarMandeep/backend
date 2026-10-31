import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { MeDto } from './dto/me.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
}
