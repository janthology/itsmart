// A same-tab warning marker only: no comments, names or ticket content are
// persisted. It is not an idempotency key or a cross-tab/device lock.
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type TicketAction = 'Status' | 'Priority' | 'Assignment';
const keyFor = (actor: string, ticket: string) => `itsmart:ticket-change-review:v1:${actor}:${ticket}`;

export function readTicketReview(storage: StorageLike, actor: string, ticket: string): TicketAction | null {
  const raw = storage.getItem(keyFor(actor, ticket));
  if (raw === null) return null;
  if (raw !== 'Status' && raw !== 'Priority' && raw !== 'Assignment') throw new Error('Invalid ticket review marker');
  return raw;
}
export function saveTicketReview(storage: StorageLike, actor: string, ticket: string, action: TicketAction): void {
  storage.setItem(keyFor(actor, ticket), action);
  if (readTicketReview(storage, actor, ticket) !== action) throw new Error('Ticket review marker was not stored');
}
export function clearTicketReview(storage: StorageLike, actor: string, ticket: string): void {
  storage.removeItem(keyFor(actor, ticket));
  if (storage.getItem(keyFor(actor, ticket)) !== null) throw new Error('Ticket review marker was not cleared');
}
