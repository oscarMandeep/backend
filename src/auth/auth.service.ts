import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { hashPassword, verifyPassword } from '../common/utils/password';
import { PrismaService } from '../prisma/prisma.service';
import type { RegisterDto } from './dto/register.dto';
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

  /** Email + password sign-up. New accounts start with the 2 welcome credits. */
  async register(dto: RegisterDto): Promise<LoginResult> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException({
        code: 'EMAIL_TAKEN',
        message: 'An account with this email already exists. Log in instead.',
      });
    }
    try {
      const created = await this.prisma.user.create({
        data: {
          email: dto.email,
          name: dto.name,
          passwordHash: await hashPassword(dto.password),
          username: await this.uniqueUsername(dto.email),
          ledger: { create: { amount: 2, reason: 'SIGNUP_BONUS' } },
        },
      });
      return { userId: created.id, onboarded: created.onboarded };
    } catch (err) {
      // Two sign-ups with one email at the same moment: the unique index decides.
      if ((err as { code?: unknown }).code === 'P2002') {
        throw new ConflictException({
          code: 'EMAIL_TAKEN',
          message: 'An account with this email already exists. Log in instead.',
        });
      }
      throw err;
    }
  }

  /**
   * One generic error for "no such user", "wrong password" and "Google-only
   * account", so the response never reveals which emails are registered.
   */
  async loginWithPassword(
    email: string,
    password: string,
  ): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok =
      !!user?.passwordHash &&
      (await verifyPassword(password, user.passwordHash));
    if (!user || !ok) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Wrong email or password.',
      });
    }
    return { userId: user.id, onboarded: user.onboarded };
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
