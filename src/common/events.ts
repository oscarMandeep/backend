/** Domain events (in-process, @nestjs/event-emitter). Modules talk through these. */
export const Events = {
  UserUpdated: 'user.updated',
  MatchCreated: 'match.created',
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
