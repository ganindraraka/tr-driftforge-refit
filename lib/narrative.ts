// token-radar-01 · row narrative
//
// The board carries numbers, and numbers are hard to read across two hundred
// rows. This module turns one scored row into a short, plain sentence a person
// can skim: how big its TVL is, how fast it has moved, how soon the model thinks
// a token arrives, and what the width of its own band says about how much to
// trust the point estimate.
//
// It is deliberately separate from the scoring path. The model decides a rank;
// this module only finds the words for it. Nothing here can change a number.

import type { BoardRow } from './model.ts';

/** One row's numbers, said in plain language. */
export interface RowNarrative {
  /** The row's slug, so a caller can line the narrative back up. */
  slug: string;
  /** A single sentence describing the row. */
  sentence: string;
  /** How confident the band makes the point estimate: 'tight', 'moderate', 'wide'. */
  confidence: 'tight' | 'moderate' | 'wide';
}

/** Turn a dollar figure into a coarse word: 'millions', 'billions', or a plain count. */
function sizeWord(usd: number): string {
  if (usd >= 1_000_000_000) return 'billions';
  if (usd >= 1_000_000) return 'millions';
  if (usd >= 1_000) return 'thousands';
  return 'dollars';
}

/** Describe how TVL has moved over the last seven days, or that it is unknown. */
function movement(change: number | null): string {
  if (change === null) return 'with no seven-day figure';
  const rounded = Math.round(change);
  if (rounded > 5) return `up ${rounded}% over the week`;
  if (rounded < -5) return `down ${Math.abs(rounded)}% over the week`;
  return 'roughly flat over the week';
}

/** Describe the launch window from the ninety-day hazard. */
function window(hazard: number): string {
  if (hazard >= 0.5) return 'a token is likely within ninety days';
  if (hazard >= 0.2) return 'a token is plausible within ninety days';
  if (hazard >= 0.05) return 'a token is possible but not near';
  return 'no token looks imminent';
}

/**
 * How tight the bootstrap band is, as the ratio of its width to the point
 * estimate. Under a quarter is tight, under a half is moderate, more is wide.
 */
function confidenceOf(row: BoardRow): 'tight' | 'moderate' | 'wide' {
  const width = row.p90_usd - row.p10_usd;
  if (row.implied_value_usd <= 0) return 'wide';
  const ratio = width / row.implied_value_usd;
  if (ratio < 0.25) return 'tight';
  if (ratio < 0.5) return 'moderate';
  return 'wide';
}

/** Describe one row in a sentence a person can read at a glance. */
export function narrateRow(row: BoardRow): RowNarrative {
  const confidence = confidenceOf(row);
  const where = row.chains.length > 0 ? row.chains[0] : 'its main chain';
  const sentence =
    `${row.name} holds ${sizeWord(row.tvl_usd)} in TVL on ${where}, ${movement(row.change_7d)}; ` +
    `the model reads ${window(row.hazard_90d)} and calls the estimate ${confidence}.`;
  return { slug: row.slug, sentence, confidence };
}

/** Narrate every row, in the order the board already put them. */
export function narrateBoard(board: BoardRow[]): RowNarrative[] {
  return board.map(narrateRow);
}

/** Count the rows by confidence, for a one-line summary. */
export function confidenceCounts(rows: RowNarrative[]): { tight: number; moderate: number; wide: number } {
  const counts = { tight: 0, moderate: 0, wide: 0 };
  for (const row of rows) counts[row.confidence] += 1;
  return counts;
}
