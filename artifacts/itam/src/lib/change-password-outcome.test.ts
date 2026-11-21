import { describe, expect, it } from 'vitest';
import { classifyChangePasswordResponse } from './change-password-outcome';

describe('classifyChangePasswordResponse', () => {
  it('treats only a confirmed 200 as changed', () => {
    expect(classifyChangePasswordResponse(200, 'password_changed')).toEqual({ kind: 'changed' });
    expect(classifyChangePasswordResponse(200, null).kind).toBe('ambiguous');
  });

  it.each([
    [400, 'verification_failed'], [400, 'weak_password'], [400, 'default_password'],
    [400, 'same_password'], [400, 'invalid_input'], [403, 'account_unavailable'],
    [403, 'unsupported_account'], [503, 'verification_unavailable'], [503, 'request_unconfirmed'],
    [500, 'configuration_error'], [405, 'method_not_allowed'],
  ])('%i %s is a rejection with no Auth change, so it can be retried', (status, code) => {
    const outcome = classifyChangePasswordResponse(status, code);
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind === 'rejected') expect(outcome.message.length).toBeGreaterThan(0);
  });

  it('sends a 401 to sign-in', () => {
    expect(classifyChangePasswordResponse(401, 'authentication_required')).toEqual({ kind: 'session_ended' });
  });

  it.each(['change_unconfirmed', 'revocation_unconfirmed', 'completion_unconfirmed'])(
    '%s keeps the password-change review open', (code) => {
      expect(classifyChangePasswordResponse(503, code)).toEqual({ kind: 'ambiguous' });
    });

  it('keeps the review open when no HTTP response arrived', () => {
    expect(classifyChangePasswordResponse(null, null)).toEqual({ kind: 'ambiguous' });
  });

  it('fails closed on unknown codes', () => {
    expect(classifyChangePasswordResponse(503, 'something_new').kind).toBe('ambiguous');
    expect(classifyChangePasswordResponse(418, null).kind).toBe('ambiguous');
  });
});
