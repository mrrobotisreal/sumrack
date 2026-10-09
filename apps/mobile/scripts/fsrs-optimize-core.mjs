/**
 * Pure core of the offline FSRS parameter optimizer (T39). The CLI in
 * `fsrs-optimize.mjs` does only I/O (read input, write output, print); every
 * decision lives here so it can be unit-tested without a file system.
 *
 * Pipeline:
 *   review rows → normalizeRows (validate) → buildRevlogCsv (binding's CSV
 *   format, grouped per card, sorted by review time) → convertCsvToFsrsItems
 *   (the binding derives delta_t itself) → computeParameters (FSRS-6, short
 *   term on, 1 relearning step) → round to 4 dp → bounds check against
 *   ts-fsrs CLAMP_PARAMETERS → evaluate fitted AND ts-fsrs default_w on the
 *   same items → `sumrak-fsrs-params` file object.
 *
 * Binding CSV (verified against @open-spaced-repetition/binding 0.5.0):
 *   card_id,review_time,review_rating,review_state,review_duration
 *   - card_id: INTEGER (the binding rejects text ids), so app card ids are
 *     mapped to 1..N in order of first review;
 *   - review_time: epoch ms; review_rating: 1..4; review_state: the card
 *     state BEFORE the review (0 New · 1 Learning · 2 Review · 3 Relearning);
 *   - review_duration: ms, integer, never blank (blank → "cannot parse
 *     integer"), so an unmeasured answer is written as 0.
 */
import { CLAMP_PARAMETERS, W17_W18_Ceiling, default_w } from 'ts-fsrs';
import {
  FSRSBinding,
  computeParameters,
  convertCsvToFsrsItems,
} from '@open-spaced-repetition/binding';

export const REVLOG_KIND = 'sumrak-review-log';
export const PARAMS_KIND = 'sumrak-fsrs-params';
export const FORMAT_VERSION = 1;
/** FSRS guidance: optimization is unreliable below ~1000 reviews. */
export const LOW_REVIEW_THRESHOLD = 1000;
export const DEFAULT_NEXT_DAY_HOUR = 4;
export const CSV_HEADER = 'card_id,review_time,review_rating,review_state,review_duration';

/** Error with a machine-readable `code`: NOT_ENOUGH_DATA | INVALID_INPUT | OUT_OF_BOUNDS. */
export class FsrsOptimizeError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'FsrsOptimizeError';
    this.code = code;
  }
}

/**
 * Validate and normalise review rows from either input (export JSON `rows`
 * or the DB join of review_log × cards). Throws INVALID_INPUT on anything the
 * binding would otherwise choke on with an unhelpful message.
 */
export function normalizeRows(rawRows) {
  if (!Array.isArray(rawRows)) {
    throw new FsrsOptimizeError('Review rows must be an array', 'INVALID_INPUT');
  }
  return rawRows.map((r, i) => {
    const where = `row ${i}`;
    if (r == null || typeof r !== 'object') {
      throw new FsrsOptimizeError(`${where}: not an object`, 'INVALID_INPUT');
    }
    const cardId = r.cardId;
    if (typeof cardId !== 'string' || cardId.length === 0) {
      throw new FsrsOptimizeError(`${where}: cardId must be a non-empty string`, 'INVALID_INPUT');
    }
    if (!Number.isInteger(r.rating) || r.rating < 1 || r.rating > 4) {
      throw new FsrsOptimizeError(
        `${where}: rating must be 1..4, got ${r.rating}`,
        'INVALID_INPUT',
      );
    }
    if (!Number.isInteger(r.state) || r.state < 0 || r.state > 3) {
      throw new FsrsOptimizeError(`${where}: state must be 0..3, got ${r.state}`, 'INVALID_INPUT');
    }
    if (!Number.isFinite(r.reviewedAt)) {
      throw new FsrsOptimizeError(`${where}: reviewedAt must be epoch ms`, 'INVALID_INPUT');
    }
    const duration = r.durationMs;
    if (duration != null && (!Number.isFinite(duration) || duration < 0)) {
      throw new FsrsOptimizeError(`${where}: durationMs must be null or >= 0`, 'INVALID_INPUT');
    }
    return {
      cardId,
      direction: typeof r.direction === 'string' ? r.direction : '',
      rating: r.rating,
      state: r.state,
      reviewedAt: Math.round(r.reviewedAt),
      durationMs: duration == null ? null : Math.round(duration),
    };
  });
}

/** Parse and validate an in-app `sumrak-review-log` export (the exact T39 shape). */
export function parseExportJson(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new FsrsOptimizeError(
      'Input is neither a SQLite database nor valid JSON',
      'INVALID_INPUT',
    );
  }
  if (obj == null || obj.v !== FORMAT_VERSION || obj.kind !== REVLOG_KIND) {
    throw new FsrsOptimizeError(
      `Not a ${REVLOG_KIND} v${FORMAT_VERSION} export (got v=${obj?.v}, kind=${obj?.kind})`,
      'INVALID_INPUT',
    );
  }
  return {
    timezone: typeof obj.timezone === 'string' ? obj.timezone : null,
    rows: normalizeRows(obj.rows),
  };
}

/** True when the buffer starts with the SQLite magic header. */
export function isSqliteBytes(bytes) {
  const magic = 'SQLite format 3\0';
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic.charCodeAt(i)) return false;
  }
  return true;
}

/** Resolve the timezone: explicit flag, else the export's, else the machine's. */
export function resolveTimezone(explicit, exported) {
  const tz = explicit ?? exported ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new FsrsOptimizeError(`Unknown IANA time zone "${tz}"`, 'INVALID_INPUT');
  }
  return tz;
}

const offsetFormatters = new Map();

/**
 * Offset of `timeZone` at instant `ms`, in MINUTES (positive = east of UTC),
 * as the binding's `offsetProvider` expects.
 */
export function tzOffsetMinutes(ms, timeZone) {
  let formatter = offsetFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
    offsetFormatters.set(timeZone, formatter);
  }
  const name = formatter.formatToParts(ms).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT(?:([+-])(\d{1,2})(?::?(\d{2}))?)?$/.exec(name);
  if (!m) {
    throw new FsrsOptimizeError(
      `Unsupported time zone offset "${name}" for ${timeZone}`,
      'INVALID_INPUT',
    );
  }
  if (!m[1]) return 0;
  const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === '+' ? minutes : -minutes;
}

/**
 * Binding CSV for the given rows: one line per review, cards grouped (cards
 * ordered by their first review), reviews within a card sorted by reviewedAt.
 * Returns the CSV text plus counts for the summary.
 */
export function buildRevlogCsv(rows) {
  const byCard = new Map();
  rows.forEach((row, index) => {
    let bucket = byCard.get(row.cardId);
    if (!bucket) {
      bucket = [];
      byCard.set(row.cardId, bucket);
    }
    bucket.push({ ...row, index });
  });

  const cards = [...byCard.values()].map((reviews) => {
    reviews.sort((a, b) => a.reviewedAt - b.reviewedAt || a.index - b.index);
    return reviews;
  });
  cards.sort((a, b) => a[0].reviewedAt - b[0].reviewedAt || a[0].index - b[0].index);

  const lines = [CSV_HEADER];
  cards.forEach((reviews, i) => {
    const bindingCardId = i + 1;
    for (const r of reviews) {
      lines.push([bindingCardId, r.reviewedAt, r.rating, r.state, r.durationMs ?? 0].join(','));
    }
  });

  let first = Infinity;
  let last = -Infinity;
  for (const row of rows) {
    if (row.reviewedAt < first) first = row.reviewedAt;
    if (row.reviewedAt > last) last = row.reviewedAt;
  }

  return {
    csv: lines.join('\n') + '\n',
    reviewCount: rows.length,
    cardCount: cards.length,
    firstReviewedAt: rows.length ? first : null,
    lastReviewedAt: rows.length ? last : null,
  };
}

/** Round to 4 decimals (what the app's importer and humans see). */
export function roundWeights(w) {
  return w.map((x) => Math.round(x * 1e4) / 1e4);
}

/**
 * Throws OUT_OF_BOUNDS unless `w` is exactly 21 finite numbers inside
 * ts-fsrs's CLAMP_PARAMETERS(W17_W18_Ceiling, true) bounds.
 */
export function validateWeights(w) {
  if (!Array.isArray(w) || w.length !== 21) {
    throw new FsrsOptimizeError(
      `Expected 21 weights, got ${Array.isArray(w) ? w.length : typeof w}`,
      'OUT_OF_BOUNDS',
    );
  }
  const bounds = CLAMP_PARAMETERS(W17_W18_Ceiling, true);
  w.forEach((x, i) => {
    const [lo, hi] = bounds[i];
    if (!Number.isFinite(x) || x < lo || x > hi) {
      throw new FsrsOptimizeError(`w[${i}] = ${x} is outside [${lo}, ${hi}]`, 'OUT_OF_BOUNDS');
    }
  });
}

/** Warning text for small datasets, or undefined when there are enough reviews. */
export function lowReviewWarning(reviewCount) {
  if (reviewCount >= LOW_REVIEW_THRESHOLD) return undefined;
  return (
    `Only ${reviewCount} reviews (FSRS needs ~${LOW_REVIEW_THRESHOLD}+ for reliable parameters). ` +
    'These weights may overfit; consider re-running after more reviews.'
  );
}

/** Build the exact `sumrak-fsrs-params` v1 file object the app's importer validates. */
export function buildParamsFile({
  w,
  fittedAt,
  reviewCount,
  cardCount,
  logLoss,
  rmse,
  defaultLogLoss,
  defaultRmse,
  warning,
}) {
  const out = {
    v: FORMAT_VERSION,
    kind: PARAMS_KIND,
    w,
    fittedAt,
    reviewCount,
    cardCount,
    logLoss,
    rmse,
    defaultLogLoss,
    defaultRmse,
  };
  if (warning !== undefined) out.warning = warning;
  return out;
}

/**
 * Run the full optimization over normalised rows. Throws
 * FsrsOptimizeError(NOT_ENOUGH_DATA) when there is nothing to fit. `progress`
 * receives (current, total) from the binding.
 */
export async function optimize({
  rows,
  timezone,
  nextDayHour = DEFAULT_NEXT_DAY_HOUR,
  now = new Date(),
  progress,
}) {
  if (rows.length === 0) {
    throw new FsrsOptimizeError(
      'No reviews to optimize: the review history is empty',
      'NOT_ENOUGH_DATA',
    );
  }
  const built = buildRevlogCsv(rows);
  const csvBytes = new TextEncoder().encode(built.csv);
  const items = convertCsvToFsrsItems(csvBytes, nextDayHour, timezone, tzOffsetMinutes);
  if (items.length === 0) {
    throw new FsrsOptimizeError('No usable review items after conversion', 'NOT_ENOUGH_DATA');
  }

  let raw;
  try {
    raw = await computeParameters(items, {
      enableShortTerm: true,
      numRelearningSteps: 1,
      progress,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/NotEnoughData|not enough|delta_t > 0/i.test(msg)) {
      throw new FsrsOptimizeError(
        `Not enough review data to fit parameters (${msg})`,
        'NOT_ENOUGH_DATA',
      );
    }
    throw err;
  }

  const w = roundWeights(Array.from(raw));
  validateWeights(w);

  // Evaluate the SHIPPED (rounded) weights against ts-fsrs's defaults on the same items.
  const fitted = new FSRSBinding(w).evaluate(items);
  const baseline = new FSRSBinding(Array.from(default_w)).evaluate(items);

  const warning = lowReviewWarning(built.reviewCount);
  const params = buildParamsFile({
    w,
    fittedAt: now.toISOString(),
    reviewCount: built.reviewCount,
    cardCount: built.cardCount,
    logLoss: fitted.logLoss,
    rmse: fitted.rmseBins,
    defaultLogLoss: baseline.logLoss,
    defaultRmse: baseline.rmseBins,
    warning,
  });

  return {
    params,
    summary: {
      reviewCount: built.reviewCount,
      cardCount: built.cardCount,
      firstReviewedAt: built.firstReviewedAt,
      lastReviewedAt: built.lastReviewedAt,
      timezone,
      warning,
    },
  };
}
