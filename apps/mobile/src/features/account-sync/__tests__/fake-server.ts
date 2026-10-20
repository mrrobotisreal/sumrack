import type {
  SyncClient,
  WirePullChange,
  WirePullResponse,
  WirePushRequest,
  WirePushResponse,
} from '../wire';

/**
 * In-memory implementation of the T103 contract (SumrakAPI sync.go), exactly:
 * one record per (tbl, pk); a push change replaces it only when
 * (hlc, deviceId) is strictly greater; a replace takes a fresh global seq;
 * pull is `seq > since ORDER BY seq LIMIT n` with hasMore/nextSince; limits
 * (500 changes, 512-byte pk, 256 KB data) answer 400 for the whole push.
 */
interface Rec {
  tbl: string;
  pk: string;
  data: string | null;
  deleted: boolean;
  hlc: number;
  deviceId: string;
  seq: number;
}

export class FakeServer {
  readonly records = new Map<string, Rec>();
  seq = 0;
  pushes = 0;
  pulls = 0;
  failNext: { status: number } | null = null;

  client(): SyncClient {
    return {
      push: async (req) => this.push(req),
      pull: async (since, limit) => this.pull(since, limit),
    };
  }

  /** Live (non-tombstoned) records — what GET /v1/me reports as recordCount. */
  recordCount(): number {
    let n = 0;
    for (const r of this.records.values()) if (!r.deleted) n++;
    return n;
  }

  private maybeFail() {
    if (this.failNext) {
      const f = this.failNext;
      this.failNext = null;
      throw Object.assign(new Error(`fake ${f.status}`), { status: f.status });
    }
  }

  push(req: WirePushRequest): WirePushResponse {
    this.maybeFail();
    this.pushes++;
    if (req.changes.length > 500)
      throw Object.assign(new Error('too many changes'), { status: 400 });
    for (const c of req.changes) {
      if (!c.pk || c.pk.length > 512) throw Object.assign(new Error('invalid pk'), { status: 400 });
      if (c.op === 'upsert' && (!c.data || JSON.stringify(c.data).length > 256 * 1024)) {
        throw Object.assign(new Error('invalid data'), { status: 400 });
      }
    }
    let applied = 0;
    let skipped = 0;
    for (const c of req.changes) {
      const key = `${c.tbl}\u0000${c.pk}`;
      const cur = this.records.get(key);
      const wins = !cur || c.hlc > cur.hlc || (c.hlc === cur.hlc && req.deviceId > cur.deviceId);
      if (!wins) {
        skipped++;
        continue;
      }
      applied++;
      this.records.set(key, {
        tbl: c.tbl,
        pk: c.pk,
        data: c.op === 'delete' ? null : JSON.stringify(c.data),
        deleted: c.op === 'delete',
        hlc: c.hlc,
        deviceId: req.deviceId,
        seq: ++this.seq,
      });
    }
    return { applied, skipped, maxSeq: this.seq };
  }

  pull(since: number, limit: number): WirePullResponse {
    this.maybeFail();
    this.pulls++;
    const lim = Math.min(limit, 1000);
    const sorted = [...this.records.values()]
      .filter((r) => r.seq > since)
      .sort((a, b) => a.seq - b.seq);
    const page = sorted.slice(0, lim);
    const changes: WirePullChange[] = page.map((r) => ({
      tbl: r.tbl,
      pk: r.pk,
      op: r.deleted ? 'delete' : 'upsert',
      ...(r.deleted ? {} : { data: JSON.parse(r.data!) }),
      hlc: r.hlc,
      deviceId: r.deviceId,
      seq: r.seq,
    }));
    return {
      changes,
      nextSince: page.length ? page[page.length - 1]!.seq : since,
      hasMore: sorted.length > lim,
    };
  }
}
