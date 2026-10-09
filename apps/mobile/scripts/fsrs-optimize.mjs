#!/usr/bin/env node
/**
 * Offline FSRS parameter optimizer (T39). Fits the 21 FSRS-6 weights to your
 * own review history with the official fsrs-rs binding
 * (@open-spaced-repetition/binding), then writes a `sumrak-fsrs-params` file
 * that Settings → Scheduling → Optimizer → «Import parameters» accepts.
 *
 *   node scripts/fsrs-optimize.mjs <input> [--out <file>] [--tz America/Denver]
 *        [--next-day-hour 4]
 *
 * <input> is either:
 *   - the in-app review-history export `sumrak-review-log-<date>.json`
 *     (Settings → Scheduling → «Export review history»), or
 *   - a pulled `sumrak.db` (opened read-only; see RUNBOOK §10).
 * Timezone defaults to the export's timezone (or this machine's for a DB).
 * --out defaults to fsrs-params-<YYYY-MM-DD>.json in the current directory.
 *
 * Exit codes: 0 ok · 1 bad input/usage · 2 not enough data (nothing written).
 * Only numbers leave this script: the output contains no lemmas or text.
 * All logic lives in fsrs-optimize-core.mjs; this file does I/O only.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, resolve } from 'node:path';
import process from 'node:process';

import {
  DEFAULT_NEXT_DAY_HOUR,
  FsrsOptimizeError,
  isSqliteBytes,
  normalizeRows,
  optimize,
  parseExportJson,
  resolveTimezone,
} from './fsrs-optimize-core.mjs';

const require = createRequire(import.meta.url);

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error(
    'usage: node scripts/fsrs-optimize.mjs <input> [--out <file>] [--tz <IANA zone>] [--next-day-hour <0-23>]',
  );
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { input: null, out: null, tz: null, nextDayHour: DEFAULT_NEXT_DAY_HOUR };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i] ?? usage('--out needs a value');
    else if (a === '--tz') opts.tz = argv[++i] ?? usage('--tz needs a value');
    else if (a === '--next-day-hour') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 0 || v > 23) usage('--next-day-hour must be an integer 0-23');
      opts.nextDayHour = v;
    } else if (a.startsWith('--')) usage(`unknown option ${a}`);
    else if (opts.input === null) opts.input = a;
    else usage(`unexpected extra argument ${a}`);
  }
  if (!opts.input) usage('missing <input>');
  return opts;
}

/** Read the DB read-only and join review_log to cards (card id stays text). */
function readRowsFromDb(path) {
  const Database = require('better-sqlite3');
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const stmt = db.prepare(
      `SELECT r.card_id AS cardId, c.direction AS direction, r.rating AS rating,
              r.state AS state, r.reviewed_at AS reviewedAt, r.duration_ms AS durationMs
         FROM review_log r
         JOIN cards c ON c.id = r.card_id
        ORDER BY r.reviewed_at ASC`,
    );
    return normalizeRows(stmt.all());
  } finally {
    db.close();
  }
}

function fmtDate(ms) {
  return ms == null ? '—' : new Date(ms).toISOString().slice(0, 10);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const inputPath = resolve(opts.input);

  let bytes;
  try {
    bytes = readFileSync(inputPath);
  } catch (err) {
    usage(`cannot read ${inputPath}: ${err.message}`);
  }

  let rows;
  let exportedTz = null;
  if (isSqliteBytes(bytes)) {
    rows = readRowsFromDb(inputPath);
  } else {
    const parsed = parseExportJson(bytes.toString('utf8'));
    rows = parsed.rows;
    exportedTz = parsed.timezone;
  }
  const timezone = resolveTimezone(opts.tz, exportedTz);

  const now = new Date();
  const outPath = resolve(opts.out ?? `fsrs-params-${now.toISOString().slice(0, 10)}.json`);

  return optimize({
    rows,
    timezone,
    nextDayHour: opts.nextDayHour,
    now,
    progress: (current, total) => {
      if (total > 0 && (current === total || current % Math.max(1, Math.floor(total / 10)) === 0)) {
        process.stderr.write(`  optimizing ${current}/${total}\r`);
      }
    },
  }).then(({ params, summary }) => {
    writeFileSync(outPath, JSON.stringify(params, null, 2) + '\n');
    const s = summary;
    console.log(`FSRS optimizer (T39) — ${basename(inputPath)}`);
    console.log(`  reviews: ${s.reviewCount}   cards: ${s.cardCount}   timezone: ${s.timezone}`);
    console.log(`  date range: ${fmtDate(s.firstReviewedAt)} → ${fmtDate(s.lastReviewedAt)}`);
    console.log(
      `  log loss: ${params.defaultLogLoss.toFixed(4)} (default) → ${params.logLoss.toFixed(4)} (fitted)`,
    );
    console.log(
      `  RMSE:     ${params.defaultRmse.toFixed(4)} (default) → ${params.rmse.toFixed(4)} (fitted)`,
    );
    if (params.logLoss > params.defaultLogLoss) {
      console.log(
        '  note: fitted loss is above default; prefer keeping defaults (Revert to defaults).',
      );
    }
    if (s.warning) console.log(`  WARNING: ${s.warning}`);
    console.log(`  wrote: ${outPath}`);
    console.log(JSON.stringify(params));
  });
}

main().catch((err) => {
  if (err instanceof FsrsOptimizeError) {
    if (err.code === 'NOT_ENOUGH_DATA') {
      console.error(`Not enough data to optimize: ${err.message}. Nothing was written.`);
      process.exit(2);
    }
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
