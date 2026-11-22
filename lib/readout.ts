// token-radar-01 · readout
//
// A plain-text table of the finished board, meant for a terminal rather than a
// browser. The dashboard is the page; this is the same board squashed into
// aligned columns so it can be read in a shell or pasted into a report.
//
// It renders and returns a string. It never writes anywhere and never touches
// the board it is given — the caller decides what to do with the text.

import type { BoardRow } from './model.ts';

/** Options for rendering the readout table. */
export interface ReadoutOptions {
  /** How many rows to show. Defaults to every row. */
  limit?: number;
  /** The column width for the name, in characters. Defaults to 24. */
  nameWidth?: number;
}

/** Format a dollar value as a compact, right-alignable string. */
function compactUsd(usd: number): string {
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(1)}B`;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
  return `$${Math.round(usd)}`;
}

/** Pad or trim a string to an exact width, refusing to grow a row. */
function fit(text: string, width: number): string {
  if (text.length === width) return text;
  if (text.length < width) return text + ' '.repeat(width - text.length);
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}

/** Right-align a string inside a fixed width. */
function right(text: string, width: number): string {
  return text.length >= width ? text : ' '.repeat(width - text.length) + text;
}

/**
 * Render the board as an aligned text table. The header is fixed; the rows are
 * the first `limit` board rows in their existing order.
 */
export function renderReadout(board: BoardRow[], options: ReadoutOptions = {}): string {
  const limit = options.limit ?? board.length;
  const nameWidth = options.nameWidth ?? 24;
  const rows = board.slice(0, limit);

  const header =
    fit('#', 4) + fit('name', nameWidth) + right('tvl', 8) + right('implied', 10) + right('odds', 7);
  const rule = '-'.repeat(header.length);
  const lines = [header, rule];

  for (const row of rows) {
    lines.push(
      fit(String(row.rank), 4) +
        fit(row.name, nameWidth) +
        right(compactUsd(row.tvl_usd), 8) +
        right(compactUsd(row.implied_value_usd), 10) +
        right(row.launch_odds.toFixed(2), 7),
    );
  }

  return lines.join('\n');
}

/** Render only the top of the board, with a trailing note about what was cut. */
export function renderTop(board: BoardRow[], count: number): string {
  const shown = Math.min(count, board.length);
  const table = renderReadout(board, { limit: shown });
  if (shown >= board.length) return table;
  return `${table}\n(${board.length - shown} more rows not shown)`;
}
