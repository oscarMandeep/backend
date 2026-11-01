/** Domain events (in-process, @nestjs/event-emitter). Modules talk through these. */
export const Events = {
  UserUpdated: 'user.updated',
  SkillCreated: 'skill.created',
  MatchCreated: 'match.created',
  SessionProposed: 'session.proposed',
  SessionUpdated: 'session.updated',
  SessionCompleted: 'session.completed',
  SessionReminder: 'session.reminder',
  SessionNeedsResolution: 'session.needs-resolution',
} as const;

export interface UserUpdatedEvent {
  userId: string;
  username: string;
}

export interface MatchCreatedEvent {
  matchId: string;
  userAId: string;
  userBId: string;
}

/** Shared by every session.* event: who must be told. */
export interface SessionEvent {
  sessionId: string;
  userIds: [string, string];
}

export interface SkillCreatedEvent {
  slug: string;
}
