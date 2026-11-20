// A same-tab warning only. This stores no password or session token and is not
// a server-side gate, idempotency key, or cross-tab/device synchronization.
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const keyFor = (userId: string) => `itsmart:password-change-review:v1:${userId}`;

export function readPasswordChangeReview(storage: StorageLike, userId: string): boolean {
  const raw = storage.getItem(keyFor(userId));
  if (raw === null) return false;
  if (raw !== 'pending') throw new Error('Invalid password change review marker');
  return true;
}
export function savePasswordChangeReview(storage: StorageLike, userId: string): void {
  storage.setItem(keyFor(userId), 'pending');
  if (!readPasswordChangeReview(storage, userId)) throw new Error('Password change review marker was not saved');
}
export function clearPasswordChangeReview(storage: StorageLike, userId: string): void {
  storage.removeItem(keyFor(userId));
  if (storage.getItem(keyFor(userId)) !== null) throw new Error('Password change review marker was not cleared');
}
