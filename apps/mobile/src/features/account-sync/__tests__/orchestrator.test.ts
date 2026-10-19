import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { readSetting, writeSetting } from '../engine';
import { backoffMs, classifyError, createOrchestrator, type OrchestratorDeps } from '../orchestrator';
import { SyncRunError } from '../run';
import { statusLines } from '../status-text';
import { SyncHttpError } from '../wire';
import { FakeServer } from './fake-server';
import { makePhone } from './phones';

async function setup(opts: { linked?: boolean; online?: boolean; uid?: string | null } = {}) {
  const server = new FakeServer();
  const phone = await makePhone('A', 'dev-A', server.client());
  if (opts.linked !== false) await writeSetting(phone.db, 'sync.linked', true);
  const registered: unknown[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const events: string[] = [];
  const status: Record<string, unknown> = {};
  const deps: OrchestratorDeps = {
    db: phone.db,
    client: () => ({ ...server.client(), registerDevice: async (r) => void registered.push(r) }),
    deviceId: async () => 'dev-A',
    deviceInfo: () => ({ name: 'S24U', model: 'SM', appVersion: '1' }) as never,
    uid: () => (opts.uid === undefined ? 'u1' : opts.uid),
    online: async () => opts.online !== false,
    now: () => 1_000_000,
    setTimer: (fn, ms) => (timers.push({ fn, ms }), timers.length),
    clearTimer: () => undefined,
    onStatus: (p) => Object.assign(status, p),
    onRunStarted: (t) => events.push(`start:${t}`),
    onRunCompleted: () => events.push('done'),
    onRunFailed: (i) => events.push(`fail:${i.stage}:${i.code}:${i.attempt}`),
    afterApply: () => events.push('apply'),
  };
  return { server, phone, deps, registered, timers, events, status, orch: createOrchestrator(deps) };
}

describe('orchestrator', () => {
  it('does nothing when signed out or not linked (T105 sets linked)', async () => {
    const a = await setup({ uid: null });
    expect(await a.orch.run('manual')).toBeNull();
    const b = await setup({ linked: false });
    expect(await b.orch.run('manual')).toBeNull();
    expect(b.server.pushes + b.server.pulls).toBe(0);
  });

  it('offline: no network attempt, status offline, outbox untouched', async () => {
    const t = await setup({ online: false });
    await t.phone.repos.journal.createNote({ title: 'a', body: 'b' });
    expect(await t.orch.run('foreground')).toBeNull();
    expect(t.status.status).toBe('offline');
    expect(t.status.pending).toBe(1);
    expect(t.server.pushes).toBe(0);
  });

  it('registers the device once per uid, records lastSyncAt, single-flights', async () => {
    const t = await setup();
    await t.phone.repos.journal.createNote({ title: 'a', body: 'b' });
    const [r1, r2] = await Promise.all([t.orch.run('manual'), t.orch.run('foreground')]);
    expect(r1).toBe(r2); // joined, one run
    expect(t.events.filter((e) => e.startsWith('start'))).toHaveLength(1);
    await t.orch.run('manual');
    expect(t.registered).toHaveLength(1);
    expect(await readSetting(t.phone.db, 'sync.lastSyncAt')).toBe(1_000_000);
    expect(t.status.status).toBe('idle');
    expect(t.status.pending).toBe(0);
  });

  it('5xx schedules exponential backoff; 401 stops with an error and no retry', async () => {
    const t = await setup();
    await t.phone.repos.journal.createNote({ title: 'a', body: 'b' });
    t.server.failNext = { status: 503 };
    await t.orch.run('manual');
    expect(t.status.status).toBe('error');
    expect(t.timers.map((x) => x.ms)).toEqual([backoffMs(1)]);
    expect(t.events).toContain('fail:push:http_503:1');
    t.server.failNext = { status: 503 };
    t.timers[0]!.fn();
    await vi.waitFor(() => expect(t.timers).toHaveLength(2));
    expect(t.timers[1]!.ms).toBe(backoffMs(2));

    const u = await setup();
    await u.phone.repos.journal.createNote({ title: 'a', body: 'b' });
    u.server.failNext = { status: 401 };
    await u.orch.run('manual');
    expect(u.status.status).toBe('error');
    expect(u.timers).toHaveLength(0);
  });

  it('backoff curve and error classification', () => {
    expect([1, 2, 3, 4, 10].map(backoffMs)).toEqual([5000, 10000, 20000, 40000, 300000]);
    expect(classifyError(new SyncRunError('pull', new SyncHttpError(0, 'x')))).toMatchObject({ code: 'network', fatal: false });
    expect(classifyError(new SyncHttpError(400, 'bad'))).toMatchObject({ fatal: true });
  });

  it('status copy', () => {
    const base = { status: 'idle' as const, pending: 0, lastSyncAt: 1000, lastError: null, linked: true, now: 1000 + 120_000 };
    expect(statusLines(base).ru).toBe('Синхронизировано · 2 мин назад');
    expect(statusLines({ ...base, pending: 14 }).ru).toBe('Ожидает: 14 изменений');
    expect(statusLines({ ...base, pending: 2 }).ru).toBe('Ожидает: 2 изменения');
    expect(statusLines({ ...base, status: 'offline' }).ru).toBe('Нет сети — сохранено на телефоне');
    expect(sql).toBeDefined();
  });
});
