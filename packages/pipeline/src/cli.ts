import { formatIssue, DraftError } from './errors.ts';
import { runAnnotate } from './annotate.ts';
import { runValidate } from './validate.ts';

/**
 * CLI entrypoint. Offline by design for T08 (annotate/validate only; audio +
 * publish land in T09). Exit codes: 0 success, 1 validation failure, 2 usage.
 */

const USAGE = `Sumrak authoring pipeline

Usage:
  pipeline annotate <draft.md> [more-drafts.md ...] [-o <pack.json>]
      Turn draft file(s) into a schema-valid pack.json.
      One draft = one story; multi-story packs pass several drafts (identical
      "pack" frontmatter) in reading order. Default output: ./pack.json

  pipeline validate <pack.json> [more.json ...]
      Validate existing pack.json file(s) against the schema.

Run from the Sumrak repo root:  pnpm pipeline annotate <draft.md> -o <out.json>
(paths resolve against the repo root — pnpm runs scripts at the package root)`;

function fail(message: string, code: 1 | 2): never {
  console.error(message);
  process.exit(code);
}

function annotateCommand(args: string[]): void {
  const drafts: string[] = [];
  let out = 'pack.json';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '-o' || arg === '--out') {
      const value = args[++i];
      if (value === undefined) fail(`missing value for ${arg}\n\n${USAGE}`, 2);
      out = value;
    } else if (arg.startsWith('-')) {
      fail(`unknown option "${arg}"\n\n${USAGE}`, 2);
    } else {
      drafts.push(arg);
    }
  }
  if (drafts.length === 0) fail(`annotate needs at least one draft file\n\n${USAGE}`, 2);

  try {
    const summary = runAnnotate(drafts, out);
    console.log(
      `✓ ${summary.pack.id} v${summary.pack.version} → ${summary.outFile}\n` +
        `  ${summary.stories} stor${summary.stories === 1 ? 'y' : 'ies'}, ` +
        `${summary.sentences} sentences, ${summary.tokens} tokens — schema-valid`,
    );
  } catch (e) {
    if (e instanceof DraftError) {
      fail(e.issues.map(formatIssue).join('\n'), 1);
    }
    throw e;
  }
}

function validateCommand(args: string[]): void {
  if (args.length === 0 || args.some((a) => a.startsWith('-'))) {
    fail(`validate needs one or more pack.json paths\n\n${USAGE}`, 2);
  }
  let failed = false;
  for (const file of args) {
    const result = runValidate(file);
    if (result.ok) {
      console.log(`✓ ${file}: valid pack "${result.pack.id}" v${result.pack.version}`);
    } else {
      failed = true;
      console.error(`✗ ${file}: invalid pack`);
      for (const issue of result.issues) console.error(`    ${issue.path}: ${issue.message}`);
    }
  }
  if (failed) process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case 'annotate':
    annotateCommand(rest);
    break;
  case 'validate':
    validateCommand(rest);
    break;
  case undefined:
  case 'help':
  case '--help':
  case '-h':
    console.log(USAGE);
    break;
  default:
    fail(`unknown command "${command}"\n\n${USAGE}`, 2);
}
