// token-radar-01 · method notes
//
// The board is a model, and a model owes its reader a short account of how it
// reached a number. This module writes that account as a list of plain notes:
// what was fit, on what it was fit, and where the fit is soft. It is the same
// story the dashboard tells, kept here so the terminal run can tell it too.
//
// It computes nothing new. Every figure it names came from the board it is given.

import type { BoardRow } from './model.ts';

/** One line of method, with a label a reader can scan. */
export interface MethodNote {
  /** The short label, e.g. 'fit'. */
  label: string;
  /** The note itself. */
  text: string;
}

/** The median of a list of numbers, or zero when the list is empty. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** A short dollar figure. */
function short(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}m`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}k`;
  return `$${Math.round(usd)}`;
}

/**
 * Write the method notes for a finished board. `sizeRows` is the number of
 * traded peers the size curve was fit on, when the caller knows it.
 */
export function methodNotes(board: BoardRow[], sizeRows: number): MethodNote[] {
  const implied = board.map((r) => r.implied_value_usd);
  const widths = board.map((r) => (r.implied_value_usd > 0 ? (r.p90_usd - r.p10_usd) / r.implied_value_usd : 0));
  return [
    { label: 'rows', text: `${board.length} protocols scored from a single sealed snapshot` },
    { label: 'fit', text: `size curve fitted on ${sizeRows} traded peers, odds on the full field` },
    { label: 'implied', text: `top ${short(implied[0] ?? 0)}, median ${short(median(implied))}` },
    { label: 'bands', text: `median band width is ${(median(widths) * 100).toFixed(0)}% of the point estimate` },
    { label: 'caveat', text: 'wide bands mean the order is a lean, not a certainty; check the row before acting' },
  ];
}

/** Render the notes as a short aligned block for the terminal. */
export function renderNotes(notes: MethodNote[]): string {
  return notes.map((n) => `${n.label.padEnd(8)} ${n.text}`).join('\n');
}
