// token-radar-01 · board summary
//
// One paragraph about the whole board, drawn from the numbers the model already
// produced. The point is to let a reader who will not open two hundred rows still
// learn the shape of the field: how deep it is, where the mass sits, and how much
// of it the model would stake a claim on.
//
// It reads the finished board and writes a sentence. It never ranks, filters, or
// reorders anything.

import type { BoardRow } from './model.ts';

/** The few numbers the summary speaks from. */
export interface BoardFacts {
  /** Rows on the board. */
  rows: number;
  /** Rows with a launch probability of at least one half. */
  confident: number;
  /** The implied value of the top row. */
  topImplied: number;
  /** The implied value of the bottom row. */
  bottomImplied: number;
  /** The median implied value across the board. */
  medianImplied: number;
  /** The number of distinct categories present. */
  categories: number;
}

/** A sentence and the facts behind it. */
export interface BoardSummary {
  /** The paragraph. */
  text: string;
  /** The numbers it was written from. */
  facts: BoardFacts;
}

/** The median of a list of numbers, or zero when the list is empty. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Pull the few facts the summary speaks from out of a finished board. */
export function boardFacts(board: BoardRow[]): BoardFacts {
  const implied = board.map((r) => r.implied_value_usd);
  const categorySet = new Set(board.map((r) => r.category ?? 'unclassified'));
  return {
    rows: board.length,
    confident: board.filter((r) => r.launch_odds >= 0.5).length,
    topImplied: implied.length > 0 ? implied[0]! : 0,
    bottomImplied: implied.length > 0 ? implied[implied.length - 1]! : 0,
    medianImplied: median(implied),
    categories: categorySet.size,
  };
}

/** A short dollar figure for the summary text. */
function short(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}m`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}k`;
  return `$${Math.round(usd)}`;
}

/** Write one paragraph about a finished board. */
export function summarizeBoard(board: BoardRow[]): BoardSummary {
  const facts = boardFacts(board);
  if (facts.rows === 0) {
    return { text: 'The board is empty: no protocol cleared the floor.', facts };
  }
  const share = Math.round((facts.confident / facts.rows) * 100);
  const text =
    `Across ${facts.rows} rows in ${facts.categories} categories, the model reads a launch ` +
    `within ninety days for ${facts.confident} (${share}%). Implied value runs from ` +
    `${short(facts.topImplied)} at the top to ${short(facts.bottomImplied)} at the foot, ` +
    `with a median of ${short(facts.medianImplied)}.`;
  return { text, facts };
}
