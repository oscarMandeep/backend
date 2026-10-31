import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { GoogleProfile } from './google.strategy';

export interface LoginResult {
  userId: string;
  onboarded: boolean;
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  /** Find the user by Google id, else link by email, else create a new account. */
  async loginWithGoogle(profile: GoogleProfile): Promise<LoginResult> {
    const byGoogle = await this.prisma.user.findUnique({
      where: { googleId: profile.googleId },
    });
    if (byGoogle) return { userId: byGoogle.id, onboarded: byGoogle.onboarded };

    const byEmail = await this.prisma.user.findUnique({
      where: { email: profile.email },
    });
    if (byEmail) {
      const linked = await this.prisma.user.update({
        where: { id: byEmail.id },
        data: {
          googleId: profile.googleId,
          avatarUrl: byEmail.avatarUrl ?? profile.avatarUrl,
        },
      });
      return { userId: linked.id, onboarded: linked.onboarded };
    }

    const created = await this.prisma.user.create({
      data: {
        email: profile.email,
        googleId: profile.googleId,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        username: await this.uniqueUsername(profile.email),
        // `credits` defaults to 2; keep the ledger in step with it.
        ledger: { create: { amount: 2, reason: 'SIGNUP_BONUS' } },
      },
    });
    return { userId: created.id, onboarded: created.onboarded };
  }

  /** Development only (the controller enforces this): log in as an existing user. */
  async loginAsExisting(email: string): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'No user with that email.',
      });
    }
    return { userId: user.id, onboarded: user.onboarded };
  }

  private async uniqueUsername(email: string): Promise<string> {
    const base =
      email
        .split('@')[0]
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 20) || 'user';
    let candidate = base.length >= 3 ? base : `${base}user`;
    for (let i = 0; i < 10; i++) {
      const taken = await this.prisma.user.findUnique({
        where: { username: candidate },
      });
      if (!taken) return candidate;
      candidate = `${base}${Math.floor(1000 + Math.random() * 9000)}`;
    }
    return `${base}${Date.now()}`;
  }
}
