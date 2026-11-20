import { describe, expect, it } from 'vitest';
import { clearTicketReview, readTicketReview, saveTicketReview } from './ticket-change-review';
function storage() {
  const values = new Map<string,string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
describe('ticket review marker', () => {
  it('persists only the action, isolated by user and ticket, until cleared', () => {
    const s = storage();
    saveTicketReview(s,'actor','ticket','Status');
    expect(readTicketReview(s,'actor','ticket')).toBe('Status');
    expect(readTicketReview(s,'other','ticket')).toBeNull();
    expect(readTicketReview(s,'actor','other')).toBeNull();
    expect([...s.values.values()]).toEqual(['Status']);
    clearTicketReview(s,'actor','ticket');
    expect(readTicketReview(s,'actor','ticket')).toBeNull();
  });
  it('fails closed for corrupt and unavailable storage', () => {
    const s = storage();
    s.setItem('itsmart:ticket-change-review:v1:actor:ticket','forged');
    expect(() => readTicketReview(s,'actor','ticket')).toThrow(/Invalid/);
    clearTicketReview(s,'actor','ticket');
    const blocked = { getItem: () => { throw new Error('disabled'); }, setItem: () => { throw new Error('disabled'); }, removeItem: () => { throw new Error('disabled'); } };
    expect(() => readTicketReview(blocked,'actor','ticket')).toThrow('disabled');
    expect(() => saveTicketReview(blocked,'actor','ticket','Priority')).toThrow('disabled');
    expect(() => clearTicketReview(blocked,'actor','ticket')).toThrow('disabled');
    const discards = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    expect(() => saveTicketReview(discards,'actor','ticket','Priority')).toThrow(/not stored/);
  });
});
