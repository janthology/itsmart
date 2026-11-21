// Maps a change-password Edge Function response to what the page should do.
// Only responses that prove no Auth mutation happened allow another attempt
// without review. Anything unknown or uncertain fails closed as "ambiguous".

export type ChangePasswordOutcome =
  | { kind: 'changed' }
  | { kind: 'rejected'; message: string }
  | { kind: 'session_ended' }
  | { kind: 'ambiguous' };

const REJECTED_MESSAGES: Record<string, string> = {
  verification_failed: 'The current password is incorrect.',
  weak_password: 'The new password does not meet the password rules.',
  default_password: 'Choose a password other than the default.',
  same_password: 'Choose a password different from your current password.',
  invalid_input: 'Check the password fields and try again.',
  account_unavailable: 'This account is not available for a password change. Contact an administrator.',
  change_unavailable: 'This password change cannot be started. Nothing was changed. Contact an administrator.',
  unsupported_account: 'This account is not available for a password change. Contact an administrator.',
  verification_unavailable: 'The password could not be checked right now. Nothing was changed. Try again shortly.',
  request_unconfirmed: 'The request could not be completed. Nothing was changed. Try again shortly.',
  configuration_error: 'Password changes are temporarily unavailable. Contact an administrator.',
  method_not_allowed: 'Password changes are temporarily unavailable. Contact an administrator.',
};

// Codes emitted only before any Auth mutation (see the Edge Function header).
const SAFE_TO_RETRY = new Set(Object.keys(REJECTED_MESSAGES));

export function classifyChangePasswordResponse(status: number | null, code: string | null): ChangePasswordOutcome {
  if (status === 200 && code === 'password_changed') return { kind: 'changed' };
  // No HTTP response at all: the request may have reached the server.
  if (status === null) return { kind: 'ambiguous' };
  if (status === 401) return { kind: 'session_ended' };
  if (code && SAFE_TO_RETRY.has(code)) {
    return { kind: 'rejected', message: REJECTED_MESSAGES[code] };
  }
  // change_unconfirmed, revocation_unconfirmed, completion_unconfirmed, or any
  // unexpected code: the Auth password may already have changed.
  return { kind: 'ambiguous' };
}
