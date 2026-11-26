import { describe, expect, it, vi } from 'vitest';

// De inlog heeft een browser nodig; voor deze losse rekenregel niet van belang.
vi.mock('./gmail/auth', () => ({ expire: () => {}, getToken: async () => '' }));

import { perThread, type Reminder } from './reminders';

const NOW = Date.parse('2026-11-26T10:00:00Z');
const rem = (id: string, threadId: string, minutes: number, fired = false): Reminder =>
  ({ id, ids: [id], account: 'a@b.nl', threadId, at: NOW + minutes * 60_000, subject: 's', who: '', fired });

describe('perThread', () => {
  it('laat losse herinneringen met rust', () => {
    const out = perThread([rem('1', 't1', -5), rem('2', 't2', 60)], NOW);
    expect(out.map((r) => [r.threadId, r.ids, r.fired])).toEqual([['t1', ['1'], false], ['t2', ['2'], false]]);
  });

  it('telt twee afspraken voor dezelfde thread als één', () => {
    const out = perThread([rem('1', 't1', -5), rem('2', 't1', -5)], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].ids).toEqual(['1', '2']);
    expect(out[0].fired).toBe(false);
  });

  it('gaat niet opnieuw af als één van de dubbele al is afgegaan', () => {
    const out = perThread([rem('1', 't1', -5, true), rem('2', 't1', -5)], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].fired).toBe(true);
    expect(out[0].ids).toEqual(['1', '2']);
  });

  it('houdt een latere herinnering aan naast een afgegane', () => {
    const out = perThread([rem('1', 't1', -5, true), rem('2', 't1', 60)], NOW);
    expect(out[0].fired).toBe(false);
    expect(out[0].at).toBe(NOW + 60 * 60_000);
    expect(out[0].ids).toEqual(['1', '2']);
  });
});
