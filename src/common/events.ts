/** Domain events (in-process, @nestjs/event-emitter). Modules talk through these. */
export const Events = {
  UserUpdated: 'user.updated',
} as const;

export interface UserUpdatedEvent {
  userId: string;
  username: string;
}
