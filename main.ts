// token-radar-01 · entry point (revision 2)
//
// The whole radar is built offline from a single sealed snapshot. This module is
// the thin shell around lib/model.ts: it works out where to read the snapshot and
// where to drop the artifacts, asks the model for the ranked board, rejects a
// board the gate would refuse, publishes the page and its data beside the board,
// and finally seals the hand-in into a dossier with the vendor library. No
// valuation lives here — every rank comes from lib/model.ts — so the command-line
// run and the page can never disagree about a position.
//
// Paths named by the caller are resolved against the process working directory.
// Bundled assets (dashboard/, screenshots/) are resolved against this file, so a
// run lands the same no matter the caller's cwd.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { auditBoard } from './lib/audit.ts';
import { auditInput, hygieneLine } from './lib/health.ts';
import { narrateBoard, confidenceCounts } from './lib/narrative.ts';
import { renderReadout } from './lib/readout.ts';
import { diffSnapshots, diffLine } from './lib/snapshot-diff.ts';
import { byCategory, bucketLine } from './lib/buckets.ts';
import { signedPct } from './lib/format.ts';
import { summarizeBoard } from './lib/report-summary.ts';
import { methodNotes, renderNotes } from './lib/notes.ts';
import { limitsLine } from './lib/limits.ts';
import { digestBoard } from './lib/digest.ts';
import { buildDossier } from './vendor/makefun-board.ts';

// This module's own directory: the root of the shipped repository.
const shipRoot = fileURLToPath(new URL('.', import.meta.url));

// Caps handed to buildDossier. They can only refuse; the byte cap on the dossier
// text is what shapes it, matched to the scorer's own 65536 so the dossier equals
// the one the gate rebuilds from the same dashboard/ and screenshots/.
const dossierCaps = {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
};

// Report a refusal on stderr and exit non-zero. Exit 2 is kept for a missing
// input so a caller can separate "nothing to read" from "bad board".
function refuse(message: string, exitCode = 1): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(exitCode);
}

// Read one option, accepting `--name value` and `--name=value`. A standalone
// occurrence is preferred over an equals form, and an equals form over the
// fallback — the same precedence the original contract used.
function readOption(argv: string[], name: string, fallback: string): string {
  const flag = `--${name}`;
  const at = argv.indexOf(flag);
  if (at !== -1 && at + 1 < argv.length) return argv[at + 1]!;
  for (const arg of argv) {
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return fallback;
}

// Resolve the snapshot file and output directory. An --input already naming a
// .json file is taken as-is; anything else is a directory holding snapshot.json
// (the sealed /input mount).
function resolvePaths(argv: string[]): { snapshotFile: string; outputDir: string } {
  const inputArg = readOption(argv, 'input', '/input');
  const snapshotFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
  const outputDir = readOption(argv, 'output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
  return { snapshotFile, outputDir };
}

// Copy one bundled asset folder into the output, keeping every source name so
// relative links and screenshot order survive. Only visible regular files are
// published; dotfiles and subdirectories are skipped. Returns the copied names in
// directory order.
function publishFolder(folder: string, outputDir: string): string[] {
  const from = join(shipRoot, folder);
  if (!existsSync(from)) return [];
  const to = join(outputDir, folder);
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    copied.push(name);
  }
  return copied;
}

// The hand-in needs three dossier images — the board, a detail view and a filtered
// view — and each name must be a plain dossier image name. Refuse early and
// clearly when that does not hold.
function checkScreenshots(names: string[]): void {
  if (names.length < 3) {
    const word = names.length === 1 ? 'image' : 'images';
    refuse(`screenshots/ holds ${names.length} ${word}: hand in 3, the board, a detail view and a filtered view`);
  }
  const plainName = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
  for (const name of names) {
    if (!plainName.test(name)) {
      refuse(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
    }
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const { snapshotFile, outputDir } = resolvePaths(argv);

  if (!existsSync(snapshotFile)) {
    refuse(`no snapshot at ${snapshotFile}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
  }

  // Optional previous snapshot: when given, the run also reports what moved
  // between the two. Absent by default, so an ordinary run is unchanged.
  const prevArg = readOption(argv, 'prev', '');
  let diffText: string | null = null;
  if (prevArg !== '' && existsSync(prevArg)) {
    const before = parseSnapshot(readFileSync(prevArg, 'utf8'));
    const after = parseSnapshot(readFileSync(snapshotFile, 'utf8'));
    diffText = diffLine(diffSnapshots(before, after));
  }

  // Score the universe once here. The page reads these same numbers back from
  // data.js and never recomputes a rank of its own.
  const snapshot = parseSnapshot(readFileSync(snapshotFile, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const gateRefusal = boardIssue(board, snapshot);
  if (gateRefusal !== null) refuse(`the model wrote a board the gate refuses: ${gateRefusal}`);

  // A read-only audit of the finished board. It feeds nothing back into the
  // score; it only says how the ranking holds together in the log line.
  const audit = auditBoard(board, snapshot);
  const hygiene = auditInput(snapshot);
  const confidence = confidenceCounts(narrateBoard(board));
  const categories = bucketLine(byCategory(board));
  // A one-glance tell of how the top row itself has moved this week.
  const topMove = signedPct(board[0]?.change_7d ?? null);
  // A plain-text table for a terminal. Written to stderr so the stdout summary
  // stays a single line; a caller that wants the table reads it here.
  process.stderr.write(renderReadout(board, { limit: 10 }) + '\n');
  process.stderr.write(summarizeBoard(board).text + '\n');
  process.stderr.write(renderNotes(methodNotes(board, snapshot.protocols.length)) + '\n');
  process.stderr.write(limitsLine() + '\n');
  process.stderr.write(digestBoard(board).line + '\n');

  // Publish the board and the page dataset, then the page and its screenshots,
  // then the dossier that seals them. The dossier is built last so it reads every
  // input at its final path.
  mkdirSync(outputDir, { recursive: true });
  const out = (name: string): string => join(outputDir, name);
  writeFileSync(out('board.json'), JSON.stringify({ rows: board }) + '\n');
  writeFileSync(out('data.js'), dataScript(radar));
  const pageFiles = publishFolder('dashboard', outputDir);
  const shots = publishFolder('screenshots', outputDir);
  checkScreenshots(shots);
  writeFileSync(out('dossier.json'), buildDossier(outputDir, dossierCaps));

  // One short line: what was scored and where it landed.
  const summary =
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ` +
    `${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside); ` +
    `audit: ${audit.summary}; ${hygieneLine(hygiene)}; ` +
    `bands ${confidence.tight} tight / ${confidence.moderate} moderate / ${confidence.wide} wide; ` +
    `top categories ${categories}; leader ${topMove} week; ` +
    (diffText !== null ? `diff ${diffText}; ` : '') +
    `wrote ${out('board.json')}, ${out('data.js')}, ${out('dashboard')} (${pageFiles.length} files), ` +
    `${out('screenshots')} (${shots.length} images) and ${out('dossier.json')}`;
  process.stdout.write(summary + '\n');
}

main();
