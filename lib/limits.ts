// token-radar-01 · limits
//
// The board is only as good as the questions it refuses to answer. This module
// holds the small set of bounds the rest of the run leans on, gathered in one
// place so a reader can see them without hunting through the model.
//
// Nothing here ranks. These are the guardrails around the ranking.

/** The few bounds a run relies on, named so they can be read in one line. */
export interface Limits {
  /** The smallest TVL a protocol needs to be ranked at all, in dollars. */
  floorUsd: number;
  /** The longest number of days the model will look forward. */
  horizonDays: number;
  /** The most rows the board will ever carry. */
  maxRows: number;
  /** The least a protocol must beat a risk-free bill by, as a fraction. */
  edge: number;
}

/** The limits this build uses. */
export const LIMITS: Limits = {
  floorUsd: 250_000,
  horizonDays: 90,
  maxRows: 200,
  edge: 0.04,
};

/** A single line naming every limit, for a reader who wants the numbers. */
export function limitsLine(limits: Limits = LIMITS): string {
  return (
    `floor $${limits.floorUsd.toLocaleString('en-US')} · ` +
    `horizon ${limits.horizonDays}d · ` +
    `max ${limits.maxRows} rows · ` +
    `edge ${Math.round(limits.edge * 100)}%`
  );
}
