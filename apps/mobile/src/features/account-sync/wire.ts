/** T103 wire contract (SumrakAPI internal/sync/sync.go), exactly. All JSON. */
export interface WirePushChange {
  tbl: string;
  pk: string;
  op: 'upsert' | 'delete';
  data?: Record<string, unknown>;
  hlc: number;
}
export interface WirePushRequest {
  deviceId: string;
  schemaVersion: number;
  changes: WirePushChange[];
}
export interface WirePushResponse {
  applied: number;
  skipped: number;
  maxSeq: number;
}
export interface WirePullChange {
  tbl: string;
  pk: string;
  op: 'upsert' | 'delete';
  data?: Record<string, unknown>;
  hlc: number;
  deviceId: string;
  seq: number;
}
export interface WirePullResponse {
  changes: WirePullChange[];
  nextSince: number;
  hasMore: boolean;
}
export interface WireDeviceRequest {
  deviceId: string;
  name: string;
  model: string;
  appVersion: string;
}
export interface WireMe {
  uid: string;
  email: string;
  deviceCount: number;
  recordCount: number;
  maxSeq: number;
  devices?: {
    deviceId: string;
    name: string;
    model: string;
    appVersion: string;
    lastSeenAt: string;
  }[];
}

/** What the runner needs from a server: the fake in tests, `HttpSyncClient` on device. */
export interface SyncClient {
  push(req: WirePushRequest): Promise<WirePushResponse>;
  pull(since: number, limit: number): Promise<WirePullResponse>;
}

/** Thrown by clients; `status` 0 = network, 401 = auth, 4xx/5xx = server. */
export class SyncHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SyncHttpError';
  }
}
