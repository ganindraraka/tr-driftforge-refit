// token-radar-01 · entry point
//
// One sealed snapshot goes in; a complete offline radar comes out. This file is
// deliberately thin: it resolves where to read and write, hands the snapshot to
// the model in lib/model.ts, refuses a board the gate would reject, publishes the
// page and its data, and seals everything into a dossier with the vendor library.
// All valuation logic lives in the model, never here, so the CLI and the page can
// never disagree about a rank.
//
// Paths the caller passes are resolved against the working directory. The assets
// we ship (dashboard/, screenshots/) are resolved against this module, so the run
// behaves the same no matter where it is invoked from.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

// The directory this module sits in: the root of the shipped repository.
const shipRoot = fileURLToPath(new URL('.', import.meta.url));

// The caps we hand buildDossier. They only ever refuse; the text cap is what
// shapes the bytes, and it matches the scorer's own 65536 so our dossier equals
// the one the gate rebuilds from the same dashboard/ and screenshots/.
const dossierCaps = {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
};

// Print a refusal to stderr and leave with a non-zero status. Exit 2 is reserved
// for a missing input so a caller can tell "nothing to read" from "bad board".
function refuse(message: string, exitCode = 1): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(exitCode);
}

// Read one option from argv, supporting both `--name value` and `--name=value`.
// Precedence matches the original contract: the first standalone occurrence wins
// over any equals form, and the first equals form wins over the fallback.
function readOption(argv: string[], name: string, fallback: string): string {
  const flag = `--${name}`;
  const at = argv.indexOf(flag);
  if (at !== -1 && at + 1 < argv.length) return argv[at + 1]!;
  for (const arg of argv) {
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return fallback;
}

// Resolve the snapshot file and the output directory from flags and environment.
// An --input that already names a .json file is used as-is; anything else is
// treated as a directory holding snapshot.json (the sealed /input mount).
function resolvePaths(argv: string[]): { snapshotFile: string; outputDir: string } {
  const inputArg = readOption(argv, 'input', '/input');
  const snapshotFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
  const outputDir = readOption(argv, 'output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
  return { snapshotFile, outputDir };
}

// Copy one shipped asset folder into the output, keeping every source name so
// relative links and the screenshot ordering survive. Only visible regular files
// are published; dotfiles and subdirectories are left behind. Returns the names
// actually copied, in directory order.
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

// The hand-in needs three screenshots (board, detail, filtered) and each name
// must be a plain dossier image name. Refuse early with a clear message.
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

  // Score the whole universe once. The page reads these same numbers from data.js
  // and never recomputes a rank of its own.
  const snapshot = parseSnapshot(readFileSync(snapshotFile, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const gateRefusal = boardIssue(board, snapshot);
  if (gateRefusal !== null) refuse(`the model wrote a board the gate refuses: ${gateRefusal}`);

  // Publish the machine-readable board and the page's dataset, then the page and
  // its screenshots, then the dossier that seals them. The dossier is built last
  // so it reads every input at its final path.
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
    `wrote ${out('board.json')}, ${out('data.js')}, ${out('dashboard')} (${pageFiles.length} files), ` +
    `${out('screenshots')} (${shots.length} images) and ${out('dossier.json')}`;
  process.stdout.write(summary + '\n');
}

main();