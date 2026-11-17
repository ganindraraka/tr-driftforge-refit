// Build the offline radar from one sealed input. Paths supplied by the caller are
// relative to the working directory; bundled assets are relative to this module.
import * as fs from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const assetRoot = fileURLToPath(new URL('.', import.meta.url));
const dossierLimits = {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
};

// Preserve both flag spellings and the original precedence: a separate value
// wins over an equals value, and the first occurrence of either spelling wins.
function optionValue(args: string[], key: string, defaultValue: string): string {
  const flag = `--${key}`;
  const position = args.indexOf(flag);
  if (position !== -1 && position < args.length - 1) return args[position + 1]!;
  for (const argument of args) {
    if (argument.startsWith(`${flag}=`)) return argument.substring(flag.length + 1);
  }
  return defaultValue;
}

function locations(args: string[]): { input: string; output: string } {
  const requested = optionValue(args, 'input', '/input');
  return {
    input: requested.endsWith('.json') ? requested : join(requested, 'snapshot.json'),
    output: optionValue(args, 'output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output'),
  };
}

function stop(message: string, code = 1): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

// Only visible, regular files belong in these flat asset directories. Keep the
// source names intact so relative links and screenshot ordering remain valid.
function stageAssets(directory: string, output: string): string[] {
  const source = join(assetRoot, directory);
  if (!fs.existsSync(source)) return [];
  const destination = join(output, directory);
  fs.mkdirSync(destination, { recursive: true });
  return fs.readdirSync(source).filter((filename) => {
    if (filename.startsWith('.')) return false;
    const original = join(source, filename);
    if (!fs.statSync(original).isFile()) return false;
    fs.copyFileSync(original, join(destination, filename));
    return true;
  });
}

function checkScreenshots(files: string[]): void {
  if (files.length < 3) {
    const noun = files.length === 1 ? 'image' : 'images';
    stop(`screenshots/ holds ${files.length} ${noun}: hand in 3, the board, a detail view and a filtered view`);
  }
  const allowedName = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
  for (const filename of files) {
    if (!allowedName.test(filename)) {
      stop(`screenshots/${filename}: a name is letters, digits and . _ -, 1 to 128 characters`);
    }
  }
}

function run(args: string[]): void {
  const paths = locations(args);
  if (!fs.existsSync(paths.input)) {
    stop(`no snapshot at ${paths.input}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
  }

  // Model and page share one calculation; the page never invents its own ranks.
  const sealed = parseSnapshot(fs.readFileSync(paths.input, 'utf8'));
  const result = buildRadar(sealed);
  const failure = boardIssue(result.board, sealed);
  if (failure !== null) stop(`the model wrote a board the gate refuses: ${failure}`);

  fs.mkdirSync(paths.output, { recursive: true });
  const target = (filename: string): string => join(paths.output, filename);
  fs.writeFileSync(target('board.json'), JSON.stringify({ rows: result.board }) + '\n');
  fs.writeFileSync(target('data.js'), dataScript(result.radar));
  stageAssets('dashboard', paths.output);
  const images = stageAssets('screenshots', paths.output);
  checkScreenshots(images);

  // Construct the dossier only after its inputs exist at their final paths.
  // The vendor checks image contents and size limits and serializes the dossier.
  fs.writeFileSync(target('dossier.json'), buildDossier(paths.output, dossierLimits));
  const counts = result.radar;
  const summary = [
    `token radar: ${sealed.protocols.length} protocols, ${sealed.watchlist.length} on the watchlist, ${result.board.length} rows scored (${counts.early_size} early, ${counts.live_size} live set aside)`,
    `token radar: wrote ${target('board.json')}, ${target('data.js')}, ${target('dashboard')} (3 files), ${target('screenshots')} (${images.length} images) and ${target('dossier.json')}`,
  ];
  process.stdout.write(summary.join('\n') + '\n');
}

run(process.argv.slice(2));
