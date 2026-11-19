// Stores only a request ID and a fingerprint, not asset details. sessionStorage
// is scoped to the current tab and origin and can be cleared by the browser.
// This is a duplicate-reduction aid, not a cross-tab or cross-device lock.
export type AssetAttempt = { version: 1; requestId: string; fingerprint: string };
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fingerprint = /^[0-9a-f]{64}$/;
const keyFor = (actor: string) => `itsmart:asset-creation:v1:${actor}`;

export function readAssetAttempt(storage: StorageLike, actor: string): AssetAttempt | null {
  const raw = storage.getItem(keyFor(actor));
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Invalid asset retry record');
  const candidate = value as Partial<AssetAttempt>;
  if (candidate.version !== 1 || typeof candidate.requestId !== 'string' || !uuid.test(candidate.requestId) ||
      typeof candidate.fingerprint !== 'string' || !fingerprint.test(candidate.fingerprint)) throw new Error('Invalid asset retry record');
  return { version: 1, requestId: candidate.requestId, fingerprint: candidate.fingerprint };
}

export function saveAssetAttempt(storage: StorageLike, actor: string, attempt: AssetAttempt): void {
  storage.setItem(keyFor(actor), JSON.stringify(attempt));
  const saved = readAssetAttempt(storage, actor);
  if (!saved || saved.requestId !== attempt.requestId || saved.fingerprint !== attempt.fingerprint) throw new Error('Asset retry record was not stored');
}

export function clearAssetAttempt(storage: StorageLike, actor: string): void {
  storage.removeItem(keyFor(actor));
  if (storage.getItem(keyFor(actor)) !== null) throw new Error('Asset retry record was not removed');
}

export async function fingerprintAssetPayload(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
