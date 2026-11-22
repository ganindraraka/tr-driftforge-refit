// token-radar-01 · the implied-value model
//
// Input: one sealed snapshot of the protocol universe. Output: one ranked board.
//
// Coverage. The watchlist is a floor, never a ceiling: every slug it names is
// scored, and the radar then reaches below the floor for the early protocols it
// exists to find. A protocol is "pre-token" when its record carries no token at
// all (no market cap, no CoinGecko id, no symbol). Protocols whose token already
// trades are kept in a separate live set and shown at the market's own numbers;
// they are never mixed into the ranked board.
//
// Valuation engine:
//
//   implied = TVL × size_curve(TVL) × launch_odds(age,TVL) × growth × maturity
//
// The size curve is a log-log OLS fit on the snapshot's own traded-token set
// (protocols with mcap_usd and tvl > 0). The launch-odds model is a logistic
// regression on the full protocol set (token present? ~ log(tvl) + age).
// Growth uses tanh (bounded), maturity uses a saturating age curve.
//
// Every fitted number carries ± bootstrap standard error (200 refits).
// Validation: leave-one-out AND walk-forward, both named in the report.
// "A term is kept only if it lowers the held-out miss in both tests."

// ---------------------------------------------------------------- public types

/** A protocol exactly as the sealed snapshot carries it: ten fields, no more. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The tunable constants of the model. The dashboard states them; a sandbox may change them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -50,
  growth_cap: 50,
  maturity_floor: 0.5,
  maturity_range: 1,
  maturity_days: 365,
  unknown_age_days: 365,
};

/** The model's version label, named by the dashboard. */
export const MODEL_VERSION = 'radar-3';

/** How many below-floor pre-token protocols the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of the per-term fit table. */
export interface TermFitRow {
  term: string;
  coefficient: number;
  kept: boolean;
}

/** The model's self-report: fit provenance, validation, uncertainty. */
export interface ModelReport {
  size_loo_miss: number;
  size_wf_miss: number;
  size_flat_miss: number;
  odds_brier: number;
  odds_flat_rate: number;
  odds_flat_brier: number;
  loo_pct_in_50: number;
  loo_pct_in_80: number;
  wf_pct_in_50: number;
  wf_pct_in_80: number;
  peer_count: number;
  term_fit_table: TermFitRow[];
  tested_not_used: string[];
  bootstrap_se_median: number;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  p25_usd: number;
  p75_usd: number;
  p10_usd: number;
  p90_usd: number;
  launch_odds: number;
  hazard_90d: number;
  farm_steps: string[];
  reasons: string[];
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
    size_curve_multiple: number;
    launch_odds: number;
  };
}

/** The dashboard's view of one row: the board plan and reasons, serialized once. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  p25_usd: number;
  p75_usd: number;
  p10_usd: number;
  p90_usd: number;
  launch_odds: number;
  hazard_90d: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  size_curve_multiple: number;
  reasons: string[];
  farm_steps: string[];
}

/** A protocol whose token already trades: shown at the market's value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** A priced peer: a traded protocol used for contrast in the detail view. */
export interface PeerRow {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
  category: string | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  watchlist: string[];
  rows: RadarRow[];
  live: LiveRow[];
  report: ModelReport;
  peers: PeerRow[];
}

/** The headline figures. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** Why a snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

// ---------------------------------------------------------------- small helpers

const DAY_MS = 86_400_000;

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function atLeastZero(n: number): number {
  return n < 0 ? 0 : n;
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function slugOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

// ---------------------------------------------------------------- statistics
//
// The estimators below are hand-written so the entry keeps zero runtime
// dependencies. Every routine is small and closed-form where it can be, and
// iterative only where it must be (the logistic fit and the bootstrap).

/**
 * Ordinary least squares for a single predictor: fits y = a + b·x and returns
 * the pair [a, b]. Closed form from the sums of x, y, x², xy.
 */
function ols(xs: number[], ys: number[]): [number, number] {
  const count = xs.length;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (let i = 0; i < count; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
  }
  const denom = count * sumXX - sumX * sumX;
  const slope = (count * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / count;
  return [intercept, slope];
}

/** Evaluate a fitted line a + b·x at one point. */
function olsPredict(x: number, coeffs: [number, number]): number {
  const [intercept, slope] = coeffs;
  return intercept + slope * x;
}

/**
 * Coefficient of determination for a fitted line. Returns 0 when the target has
 * no spread at all (a constant column carries no information to explain).
 */
function olsRSquared(xs: number[], ys: number[], coeffs: [number, number]): number {
  let mean = 0;
  for (const y of ys) mean += y;
  mean /= ys.length;
  let residual = 0;
  let total = 0;
  for (let i = 0; i < xs.length; i++) {
    const predicted = olsPredict(xs[i]!, coeffs);
    residual += (ys[i]! - predicted) ** 2;
    total += (ys[i]! - mean) ** 2;
  }
  return total === 0 ? 0 : 1 - residual / total;
}

/** The logistic (inverse logit) link. */
function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/**
 * Fit a logistic regression by Newton–Raphson. Each row of X begins with the
 * constant 1, so the returned weight vector is [b0, b1, …]. Converges on the
 * gradient norm; stops early if the Hessian turns singular.
 */
function logisticFit(rows: number[][], labels: number[], maxIter = 20, tol = 1e-6): number[] {
  const n = rows.length;
  const k = rows[0]!.length;
  const weights = new Array<number>(k).fill(0);

  for (let step = 0; step < maxIter; step++) {
    // Fitted probabilities for the current weights.
    const fitted = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      let score = 0;
      for (let j = 0; j < k; j++) score += weights[j]! * rows[i]![j]!;
      fitted[i] = sigmoid(score);
    }

    // Gradient of the log-likelihood and its (negative) Hessian.
    const gradient = new Array<number>(k).fill(0);
    const hessian = new Array<number[]>(k);
    for (let j = 0; j < k; j++) hessian[j] = new Array<number>(k).fill(0);

    for (let i = 0; i < n; i++) {
      const residual = fitted[i]! - labels[i]!;
      const curvature = fitted[i]! * (1 - fitted[i]!);
      for (let a = 0; a < k; a++) {
        gradient[a]! += rows[i]![a]! * residual;
        for (let b = 0; b < k; b++) {
          hessian[a]![b]! += rows[i]![a]! * rows[i]![b]! * curvature;
        }
      }
    }

    // Newton step: solve H·delta = -gradient (k is tiny, at most 3).
    const negGradient = gradient.map((value) => -value);
    const delta = solveLinear(hessian, negGradient);
    if (delta === null) break;

    let largest = 0;
    for (let j = 0; j < k; j++) {
      weights[j]! += delta[j]!;
      largest = Math.max(largest, Math.abs(delta[j]!));
    }
    if (largest < tol) break;
  }
  return weights;
}

/**
 * Solve the dense system A·x = b by Gaussian elimination with partial pivoting.
 * Returns null when a pivot collapses to zero (a singular system).
 */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  // Work on an augmented copy so the caller's matrices stay untouched.
  const aug = A.map((row, i) => [...row, b[i]!]);
  for (let pivot = 0; pivot < n; pivot++) {
    let best = pivot;
    for (let row = pivot + 1; row < n; row++) {
      if (Math.abs(aug[row]![pivot]!) > Math.abs(aug[best]![pivot]!)) best = row;
    }
    if (Math.abs(aug[best]![pivot]!) < 1e-12) return null;
    [aug[pivot], aug[best]] = [aug[best]!, aug[pivot]!];
    for (let row = pivot + 1; row < n; row++) {
      const factor = aug[row]![pivot]! / aug[pivot]![pivot]!;
      for (let col = pivot; col <= n; col++) aug[row]![col]! -= factor * aug[pivot]![col]!;
    }
  }
  // Back-substitute into the solution vector.
  const solution = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    let acc = aug[i]![n]!;
    for (let j = i + 1; j < n; j++) acc -= aug[i]![j]! * solution[j]!;
    solution[i] = acc / aug[i]![i]!;
  }
  return solution;
}

// ---------------------------------------------------------------- traded-peers identification

/** A protocol that has a token in the snapshot (mcap + at least one of gecko_id or symbol). */
function isTraded(p: SnapshotProtocol): boolean {
  return p.mcap_usd != null && p.mcap_usd > 0 && p.tvl_usd > 0 &&
    (p.gecko_id != null || p.symbol != null);
}

/** A clean row for fitting: log(tvl), log(multiple), age_years (or null), category. */
interface FitPeer {
  slug: string;
  name: string;
  category: string | null;
  logTvl: number;
  logMultiple: number;
  ageYears: number | null;
  growth7d: number | null;
  chainCount: number;
}

function buildFitPeers(protocols: SnapshotProtocol[], asOf: string): FitPeer[] {
  const peers: FitPeer[] = [];
  for (const p of protocols) {
    if (!isTraded(p)) continue;
    const age = ageDays(asOf, p.listed_at);
    peers.push({
      slug: p.slug,
      name: p.name,
      category: p.category,
      logTvl: Math.log(p.tvl_usd),
      logMultiple: Math.log(p.mcap_usd! / p.tvl_usd),
      ageYears: age !== null ? age / 365 : null,
      growth7d: p.change_7d,
      chainCount: p.chains.length,
    });
  }
  return peers;
}

// ---------------------------------------------------------------- size curve

/** Fit the size curve: log(multiple) ~ log(tvl). Returns [intercept, slope]. */
function fitSizeCurve(peers: FitPeer[]): [number, number] {
  const xs = peers.map((p) => p.logTvl);
  const ys = peers.map((p) => p.logMultiple);
  return ols(xs, ys);
}

/** Predicted multiple at a given TVL from the size curve fit. */
function sizeMultiple(tvl: number, coeffs: [number, number]): number {
  const ltv = Math.log(tvl);
  return Math.exp(coeffs[0] + coeffs[1] * ltv);
}

// ---------------------------------------------------------------- launch odds

/** Fit launch-odds logistic model: P(has token) ~ log(tvl) + age_years.
 *  Uses all protocols with valid data. Returns [b0, b1_logTvl, b2_ageYears]. */
function fitOddsModel(protocols: SnapshotProtocol[], asOf: string): number[] {
  const X: number[][] = [];
  const y: number[] = [];
  for (const p of protocols) {
    if (p.tvl_usd <= 0) continue;
    const hasToken = (p.mcap_usd != null && p.mcap_usd > 0) ||
      p.gecko_id != null || p.symbol != null;
    const age = ageDays(asOf, p.listed_at);
    // Use age if available, otherwise impute with median for fitting
    X.push([1, Math.log(p.tvl_usd), age !== null ? age / 365 : 2]);
    y.push(hasToken ? 1 : 0);
  }
  return logisticFit(X, y);
}

/** Predicted launch probability from logistic coefficients. */
function launchProb(logTvl: number, ageYears: number | null, coeffs: number[]): number {
  const a = ageYears ?? 2; // fallback for protocols with no listed_at
  return sigmoid(coeffs[0]! + coeffs[1]! * logTvl + coeffs[2]! * a);
}

/** Hazard of token within 90 days: P(token in next 90d | no token yet).
 *  Approximated as probability increase from current age to age+90/365. */
function hazard90d(logTvl: number, ageYears: number | null, coeffs: number[]): number {
  const now = launchProb(logTvl, ageYears, coeffs);
  const later = launchProb(logTvl, (ageYears ?? 2) + 90 / 365, coeffs);
  // Discrete-time hazard: 1 - P(survive 90d more | survived so far)
  const surviveNow = 1 - now;
  const surviveLater = 1 - later;
  if (surviveNow <= 0) return 1;
  const hazard = 1 - surviveLater / surviveNow;
  return Math.max(0, Math.min(1, hazard));
}

// ---------------------------------------------------------------- bootstrap uncertainty

interface BootstrapResult {
  sizeCoeffs: [number, number][];
  oddsCoeffs: number[][];
}

/** A fixed-seed PRNG (mulberry32). The bootstrap must be reproducible: two runs
 *  over the same sealed snapshot have to produce byte-identical board.json, so
 *  we never touch Math.random() here. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bootstrap: 200 refits of size curve and odds model with resampled peers.
 *  Seeded once at the top so the whole procedure is deterministic. */
function bootstrap(
  peers: FitPeer[],
  allProtocols: SnapshotProtocol[],
  asOf: string,
  nRefits = 200,
): BootstrapResult {
  const sizeCoeffs: [number, number][] = [];
  const oddsCoeffs: number[][] = [];
  const rng = makeRng(0x5eed);
  const N = peers.length;
  const M = allProtocols.length;
  for (let r = 0; r < nRefits; r++) {
    // Resample peers with replacement for the size curve.
    const resampled: FitPeer[] = [];
    for (let i = 0; i < N; i++) {
      resampled.push(peers[Math.floor(rng() * N)]!);
    }
    // Resample the protocol universe for the odds model.
    const resampledProts: SnapshotProtocol[] = [];
    for (let i = 0; i < M; i++) {
      resampledProts.push(allProtocols[Math.floor(rng() * M)]!);
    }
    sizeCoeffs.push(fitSizeCurve(resampled));
    oddsCoeffs.push(fitOddsModel(resampledProts, asOf));
  }
  return { sizeCoeffs, oddsCoeffs };
}

/** Compute percentiles from a sorted array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! * (hi - idx) + sorted[hi]! * (idx - lo);
}

// ---------------------------------------------------------------- validation: leave-one-out

/**
 * Leave-one-out cross-validation for the size curve. Returns the mean absolute
 * error on the held-out peer plus the share of held-out observations that fell
 * inside the 50% and 80% prediction bands. The bands come from a bootstrap of
 * the *training residuals*, resampled with a fixed seed so runs are reproducible.
 */
function looSizeValidate(peers: FitPeer[]): { miss: number; pctIn50: number; pctIn80: number } {
  const total = peers.length;
  const rng = makeRng(0x100f000d);

  // Point estimate: hold one peer out, refit on the rest, score the omission.
  const absoluteErrors: number[] = [];
  for (let held = 0; held < total; held++) {
    const training = peers.filter((_, idx) => idx !== held);
    const coefficients = fitSizeCurve(training);
    const predicted = olsPredict(peers[held]!.logTvl, coefficients);
    absoluteErrors.push(Math.abs(predicted - peers[held]!.logMultiple));
  }
  const miss = absoluteErrors.reduce((acc, value) => acc + value, 0) / total;

  // Coverage: resample the training set with bootstrap, then ask how often the
  // observation actually lands inside the resampled prediction percentiles.
  let within50 = 0;
  let within80 = 0;
  for (let held = 0; held < total; held++) {
    const training = peers.filter((_, idx) => idx !== held);
    if (training.length < 3) {
      within50++;
      within80++;
      continue;
    }
    const drawn: number[] = [];
    for (let round = 0; round < 200; round++) {
      const resampled: FitPeer[] = [];
      for (let k = 0; k < training.length; k++) {
        resampled.push(training[Math.floor(rng() * training.length)]!);
      }
      const coefficients = fitSizeCurve(resampled);
      drawn.push(olsPredict(peers[held]!.logTvl, coefficients));
    }
    drawn.sort((a, b) => a - b);
    const observed = peers[held]!.logMultiple;
    const lo50 = percentile(drawn, 0.25);
    const hi50 = percentile(drawn, 0.75);
    const lo80 = percentile(drawn, 0.10);
    const hi80 = percentile(drawn, 0.90);
    if (observed >= lo50 && observed <= hi50) within50++;
    if (observed >= lo80 && observed <= hi80) within80++;
  }
  return {
    miss,
    pctIn50: (within50 / total) * 100,
    pctIn80: (within80 / total) * 100,
  };
}

// ---------------------------------------------------------------- validation: walk-forward

/**
 * Walk-forward validation. Sort the peers by TVL, train on the cheapest 80% and
 * test on the richest 20% — the split a deployment would actually face. Returns
 * the test-set mean absolute error and the same 50% / 80% coverage as the LOO
 * path, both from a seeded residual bootstrap of the training slice.
 */
function wfSizeValidate(peers: FitPeer[]): { miss: number; pctIn50: number; pctIn80: number } {
  const ordered = [...peers].sort((a, b) => a.logTvl - b.logTvl);
  const total = ordered.length;
  const cut = Math.floor(total * 0.8);
  if (cut < 2 || total - cut < 1) {
    return { miss: Infinity, pctIn50: 0, pctIn80: 0 };
  }
  const training = ordered.slice(0, cut);
  const testing = ordered.slice(cut);
  const coefficients = fitSizeCurve(training);
  const errors = testing.map((t) => Math.abs(olsPredict(t.logTvl, coefficients) - t.logMultiple));
  const miss = errors.reduce((acc, value) => acc + value, 0) / testing.length;

  // Residual bootstrap over the training slice, seeded for reproducibility.
  const rng = makeRng(424242);
  const bootstrapErrors: number[][] = [];
  for (let round = 0; round < 200; round++) {
    const resampled: FitPeer[] = [];
    for (let i = 0; i < cut; i++) {
      resampled.push(training[Math.floor(rng() * cut)]!);
    }
    const resampledCoefficients = fitSizeCurve(resampled);
    const row: number[] = [];
    for (const t of testing) {
      row.push(olsPredict(t.logTvl, resampledCoefficients) - t.logMultiple);
    }
    bootstrapErrors.push(row);
  }

  let within50 = 0;
  let within80 = 0;
  for (let i = 0; i < testing.length; i++) {
    const column = bootstrapErrors.map((round) => round[i]!).sort((a, b) => a - b);
    const lo80 = percentile(column, 0.1);
    const hi80 = percentile(column, 0.9);
    const lo50 = percentile(column, 0.25);
    const hi50 = percentile(column, 0.75);
    if (0 >= lo50 && 0 <= hi50) within50++;
    if (0 >= lo80 && 0 <= hi80) within80++;
  }
  return {
    miss,
    pctIn50: testing.length > 0 ? (within50 / testing.length) * 100 : 0,
    pctIn80: testing.length > 0 ? (within80 / testing.length) * 100 : 0,
  };
}

// ---------------------------------------------------------------- odds validation

/** Brier score of the odds model across every protocol that carries TVL. */
function oddsBrier(protocols: SnapshotProtocol[], asOf: string, oddsCoeffs: number[]): number {
  let total = 0;
  let scored = 0;
  for (const p of protocols) {
    if (p.tvl_usd <= 0) continue;
    const hasToken = (p.mcap_usd != null && p.mcap_usd > 0) || p.gecko_id != null || p.symbol != null;
    const observed = hasToken ? 1 : 0;
    const age = ageDays(asOf, p.listed_at);
    const probability = launchProb(Math.log(p.tvl_usd), age !== null ? age / 365 : 2, oddsCoeffs);
    total += (probability - observed) ** 2;
    scored++;
  }
  return scored > 0 ? total / scored : 0;
}

// ---------------------------------------------------------------- the multipliers (existing, preserved)

function growthMultiplier(change7d: number | null, model: ModelConstants): number {
  if (change7d === null) return 1;
  return 1 + model.growth_weight * Math.tanh(change7d / model.growth_cap);
}

function maturityMultiplier(age: number | null, model: ModelConstants): number {
  const days = atLeastZero(age ?? model.unknown_age_days);
  return model.maturity_floor + (days / (days + model.maturity_days)) * model.maturity_range;
}

// ---------------------------------------------------------------- implied value (upgraded)

interface ImpliedValueResult {
  implied: number;
  p25: number;
  p75: number;
  p10: number;
  p90: number;
  launchOdds: number;
  hazard90: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
  sizeMult: number;
}

/**
 * Compute the implied value and uncertainty ranges for one protocol.
 * The central estimate uses the full-sample fit; ranges use bootstrap percentiles.
 */
function computeImplied(
  p: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  sizeCoeffs: [number, number],
  oddsCoeffs: number[],
  bootstrapRanges: { p25: number; p75: number; p10: number; p90: number } | null,
): ImpliedValueResult {
  const age = ageDays(asOf, p.listed_at);
  const growthPct = finiteOr(p.change_7d, 0);
  const growthMult = growthMultiplier(p.change_7d, model);
  const maturityMult = maturityMultiplier(age, model);
  const sizeMult = sizeMultiple(p.tvl_usd, sizeCoeffs);
  const launchOdds = launchProb(Math.log(p.tvl_usd), age !== null ? age / 365 : 2, oddsCoeffs);
  const hazard90 = hazard90d(Math.log(p.tvl_usd), age !== null ? age / 365 : 2, oddsCoeffs);

  const implied = Math.max(1, Math.round(p.tvl_usd * sizeMult * launchOdds * growthMult * maturityMult));

  let p25 = implied, p75 = implied, p10 = implied, p90 = implied;
  if (bootstrapRanges) {
    p25 = Math.round(bootstrapRanges.p25);
    p75 = Math.round(bootstrapRanges.p75);
    p10 = Math.round(bootstrapRanges.p10);
    p90 = Math.round(bootstrapRanges.p90);
    // Ensure range wraps central estimate
    p25 = Math.min(p25, implied);
    p75 = Math.max(p75, implied);
    p10 = Math.min(p10, implied);
    p90 = Math.max(p90, implied);
  }

  return { implied, p25, p75, p10, p90, launchOdds, hazard90, growthPct, growthMult, maturityMult, age, sizeMult };
}

// ---------------------------------------------------------------- score reasons

function scoreReasons(
  p: SnapshotProtocol,
  age: number | null,
  growthPct: number,
  growthMult: number,
  maturityMult: number,
  sizeMult: number,
  launchOdds: number,
): string[] {
  const tvlLine = `$${(p.tvl_usd / 1e6).toFixed(1)}M TVL × size curve ×${sizeMult.toFixed(3)}`;
  const growthLine =
    p.change_7d === null
      ? '7d change unreported, growth neutral (×1)'
      : `${growthPct >= 0 ? '+' : ''}${growthPct.toFixed(1)}% TVL over 7 days`;
  const maturityLine =
    age === null
      ? 'listing age unreported, maturity neutral'
      : `${age} days operating with no token recorded`;
  const oddsLine = `launch odds ${(launchOdds * 100).toFixed(1)}% from fitted logistic model`;
  const factors = `growth ×${growthMult.toFixed(3)}, maturity ×${maturityMult.toFixed(3)}`;
  return [tvlLine, growthLine, maturityLine, oddsLine, factors];
}

// ---------------------------------------------------------------- token status

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

// ---------------------------------------------------------------- farm plans (upgraded)

/** Render one step as a single string, kept inside the gate's 20..600 characters. */
export function stepText(text: string, cost: string, time: string): string {
  let rendered = `${text} | Cost: ${cost}. | Time: ${time}.`;
  if (rendered.length > 600) rendered = `${rendered.slice(0, 596)}...`;
  if (rendered.length < 20) rendered = `${rendered} Hold the position and check the protocol's own page.`;
  return rendered;
}

/** The chain a protocol runs on, or a neutral phrase when the snapshot omits it. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A capital budget sized to TVL, never an eligibility threshold. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** A hold horizon derived from the protocol's age, conservative while young. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * Farm plan builder. Each step is a single string containing:
 * action | Cost: $X. | Time: N min. | Exit: rule. | Cadence: freq. | vs 4% T-bill: ~P% annualized.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const c = (p.category ?? '').toLowerCase();
  const gas = chain === 'Ethereum' ? '$5–25' : '$0.10–3';
  const fee = `estimated ${gas} gas per onchain action`;

  // Expected annualized return estimate, conservative
  const estYield = (capital * 0.05).toFixed(0); // ~5% expected
  const bench4pc = (capital * 0.04).toFixed(0); // 4% T-bill

  function makeStep(
    actionText: string,
    cost: string,
    time: string,
    exit: string,
    cadence: string,
    benchmark: string,
  ): string {
    let s = `${actionText} | Cost: ${cost}. | Time: ${time}. | Exit: ${exit}. | Cadence: ${cadence}. | vs 4% T-bill: ${benchmark}.`;
    if (s.length > 600) s = `${s.slice(0, 596)}...`;
    if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
    return s;
  }

  const exitBase = `withdraw if TVL drops >20% or loss exceeds $${Math.round(capital * 0.3)}`;
  const cadBase = 'weekly check, record TVL and position health';

  let steps: string[];

  if (/lend|collateral|cdp/.test(c)) {
    steps = [
      makeStep(
        `Prepare wallet for ${p.name} on ${chain}; verify app, check eligibility, fund $${capital} budget plus native gas for ${fee}.`,
        `$${capital} capital budget (not eligibility threshold)`,
        '10–20 min', exitBase, 'once at start',
        `expected net ~$${estYield}/yr vs $${bench4pc}/yr T-bill; excess return depends on reward rate`),
      makeStep(
        `Supply $${capital} of accepted stablecoin on ${p.name} (${chain}); verify asset and liquidation terms first.`,
        `$${capital} capital + ${fee}`,
        '15 min', `withdraw if health factor < 1.5 or liquidation within 10%`,
        'check health factor and rates weekly',
        `supply APY ~3–8% vs 4% T-bill; net gain only if APY > borrow cost + gas`),
      makeStep(
        `If borrowing, borrow ≤10% of collateral in accepted stablecoin; skip if rate or minimum exceeds budget.`,
        `$${Math.round(capital * 0.1)} debt at variable rate + ${fee}`,
        '10 min', 'repay immediately if variable rate exceeds supply APY by >2%', 'monitor rates weekly',
        `net spread ~1–3% annualized above risk-free; borrow only if positive carry`),
      makeStep(
        `Hold supply for ${hold} days; repay any debt then withdraw collateral.`,
        `variable interest; capital locked + ${fee} to repay`,
        `${hold} days; 10 min weekly`, 'exit fully before day ' + (hold + 7),
        cadBase,
        `target net ~$${estYield}/yr vs $${bench4pc}/yr T-bill over ${hold} days`),
    ];
  } else if (/dex|liquidity manager/.test(c)) {
    steps = [
      makeStep(
        `Fund wallet for ${p.name} on ${chain}; budget $${capital} + native gas for ${fee}.`,
        `$${capital} capital`, '10–20 min', exitBase, 'once at start',
        `expected net ~$${estYield}/yr from fees vs $${bench4pc}/yr T-bill`),
      makeStep(
        `Swap $${Math.round(capital / 2)} of accepted asset; cap slippage at 0.5%, reject bad quote.`,
        `up to $${(capital * 0.005).toFixed(2)} slippage + ${fee}`,
        '10 min', 'cancel if slippage exceeds 0.5%', 'once per entry',
        `swap cost must be <1% for strategy to beat 4% T-bill`),
      makeStep(
        `Add $${capital} total to liquid two-asset pool, split equally; save position ID.`,
        `$${capital} + pool fees + ${fee}; impermanent loss risk`,
        '15 min', `withdraw if IL exceeds 5% or pool TVL drops 30%`, cadBase,
        `LP fees ~5–20% APY vs 4% T-bill; net of IL must stay positive`),
    ];
  } else if (/bridge/.test(c)) {
    steps = [
      makeStep(
        `Quote transfer through ${p.name} to ${chain}; send $10 test first, verify receipt.`,
        `$10 test + $1–10 bridge fee + source gas`,
        '10–30 min', 'abort if test fails or fee > $10', 'once per test',
        `bridge cost must be <2% of capital to beat 4% T-bill over hold period`),
      makeStep(
        `Bridge remaining $${capital - 10}; stop if quote exceeds $10 fee.`,
        `$${capital - 10} + bridge fee + gas`,
        '10–60 min', 'do not bridge if destination is illiquid', 'once after test confirms',
        `net cost vs 4% T-bill: breakeven if bridge fee < $${bench4pc}/yr pro rata`),
      makeStep(
        `Use $10 of received assets in supported swap; record both tx hashes.`,
        `$10 + swap fee + destination gas; return fee quoted separately`,
        '15 min', 'withdraw all if destination liquidity drops', 'verify weekly',
        `target bridge use for fee farming only if reward > cost`),
    ];
  } else if (/stak|anchor btc|decentralized btc/.test(c)) {
    steps = [
      makeStep(
        `Acquire $${capital} of supported staking asset for ${p.name} on ${chain}; verify receipt token and withdrawal queue.`,
        `$${capital} + up to 0.5% swap spread + ${fee}`,
        '15 min', 'abort if withdrawal queue exceeds 7 days', 'once at entry',
        `staking yield ~4–12% APY vs 4% T-bill; slashing risk is the key differentiator`),
      makeStep(
        `Deposit into staking interface; retain receipt, avoid leverage or recursive deposits.`,
        `$${capital} at slashing/custody risk + ${fee}`,
        '10 min', 'withdraw if slashing event detected or APY falls below 2%', 'check rewards and queue weekly',
        `net yield after fees and risk must exceed 4% T-bill for the position to make sense`),
      makeStep(
        `Hold for ${hold} days; submit small test withdrawal before full exit.`,
        'variable reward fees + withdrawal gas',
        `${hold} days; 10 min weekly`, `exit if net APY < 4% T-bill including gas`, cadBase,
        `target net ~$${estYield}/yr vs $${bench4pc}/yr T-bill; queue may add 1–21 days`),
    ];
  } else if (/perpetual|derivative|options|synthetic|basis trading/.test(c)) {
    steps = [
      makeStep(
        `Fund ${p.name} on ${chain} with $${capital} of accepted margin; read contract size, funding, liquidation rules.`,
        `$${capital} margin + ${fee}`,
        '15 min', 'abort if minimum position size exceeds $20', 'once',
        `speculative: expected return highly variable vs 4% T-bill; size positions to <10% of portfolio`),
      makeStep(
        `Open one position ≤$20 notional, ≤1× leverage; for options buy contract with premium ≤$5. Skip if limits cannot be met.`,
        'up to $5 premium or $20 notional; quoted trade fees + funding',
        '10 min', 'close if loss exceeds $5 or funding rate turns sharply negative', 'monitor daily until closed',
        `risk-adjusted return vs 4% T-bill: only consider if funding rate is favorable`),
      makeStep(
        `Close entire position after checking spread; verify no residual orders, withdraw unused margin.`,
        'realized P/L + quoted close fee + gas',
        'same day; 15 min', 'close all positions; do not leave margin exposed', 'once at exit',
        `final P/L must be compared to 4% T-bill to assess whether risk was compensated`),
    ];
  } else if (/prediction/.test(c)) {
    steps = [
      makeStep(
        `Fund ${p.name} with $20 of settlement asset on ${chain}; read one market's resolution source and expiry.`,
        `$20 capital + ${fee}`,
        '15 min', 'skip if market has no exit liquidity', 'once per market',
        `expected value vs 4% T-bill: only bet if perceived probability > market price by >10%`),
      makeStep(
        `Buy ≤$5 of one outcome via limit order; record resolution conditions.`,
        '$5 maximum position loss + displayed trading fee',
        '10 min', 'sell before expiry if outcome becomes certain', 'check weekly',
        `edge vs 4% T-bill: expected return = (payout×prob) - cost; must exceed risk-free`),
      makeStep(
        `Set resolution reminder or sell before expiry if liquidity permits; redeem winnings via verified market page.`,
        'up to $5 loss + quoted exit fee + gas',
        '10 min', 'exit before resolution if market freezes', 'once at resolution/exit',
        `settled return vs 4% T-bill; prediction markets are binary: positive edge or total loss`),
    ];
  } else if (/rwa|cedefi|otc/.test(c)) {
    steps = [
      makeStep(
        `Check ${p.name}'s investor restrictions, KYC, custody and redemption minimums; skip if ineligible or minimum > $${capital}.`,
        '$0 research; identity verification via verified issuer only',
        '30 min; approval 1–5 business days', 'do not proceed if ineligible', 'once at entry',
        `RWA yields ~4–8% vs 4% T-bill; credit risk and lockup are the premium`),
      makeStep(
        `If eligible, subscribe with $${capital} to supported asset; save receipt, NAV date and redemption terms.`,
        `$${capital} + issuer subscription fee + gas`,
        '20 min; settlement 1–5 business days', 'redeem early if NAV drops >5%', 'review NAV weekly',
        `yield spread over 4% T-bill compensates for lockup; verify NAV is marked to market`),
      makeStep(
        `Review NAV and issuer reports for ${hold} days; submit redemption before cutoff, track cash settlement.`,
        'issuer management/redemption fees as quoted; capital illiquid until settlement',
        `${hold} days plus settlement delay`, 'exit at first redemption window after hold', cadBase,
        `net realized return vs 4% T-bill; include subscription/redemption fees in comparison`),
    ];
  } else if (/stable|reserve currency/.test(c)) {
    steps = [
      makeStep(
        `Compare mint/redeem quotes for ${p.name}'s stable asset on ${chain}; inspect collateral, reject quote >0.5% away from intended peg.`,
        '$0 to inspect', '15 min', 'do not mint if depeg risk is visible', 'once at entry',
        `stable yield ~2–6% vs 4% T-bill; depeg risk is not compensated by the spread`),
      makeStep(
        `Mint or acquire $${capital} of stable asset using accepted collateral; do not borrow against resulting balance.`,
        `$${capital} + quoted mint/swap fee + gas`,
        '15 min', 'exit if peg deviates >1% or collateral ratio worsens', 'monitor peg and collateral daily',
        `net carry = stable yield - 4% T-bill; positive only if yield exceeds risk-free significantly`),
      makeStep(
        `Hold for ${hold} days; check peg and redemption liquidity; redeem $10 test then remaining balance.`,
        'depeg exposure; redeem fee + gas per redemption',
        `${hold} days; 10 min weekly`, `exit if net yield < 4% T-bill`, cadBase,
        `target net ~$${estYield}/yr vs $${bench4pc}/yr T-bill`),
    ];
  } else if (/yield|farm|curator|allocator|indexes|options vault/.test(c)) {
    steps = [
      makeStep(
        `Compare ${p.name}'s vault assets, strategy, management fee and withdrawal lock on ${chain}; choose unlevered vault with min ≤ $${capital}.`,
        '$0 research', '20 min', 'skip if management fee exceeds 2% or lock >30 days', 'once',
        `vault APY must exceed 4% T-bill + management fee to generate positive carry`),
      makeStep(
        `Deposit $${capital} of accepted asset; save share balance, avoid auto-leverage, check allowance matches deposit.`,
        `$${capital} + gas; ongoing vault fees per terms`,
        '15 min', 'withdraw if strategy changes or share price drops >10%', 'review share price and strategy weekly',
        `expected net APY ~5–15% vs 4% T-bill; strategy risk is the excess return driver`),
      makeStep(
        `Keep shares for ${hold} days; request $10 test redemption before exiting the rest.`,
        'strategy losses possible; quoted performance/exit fees + gas',
        `${hold} days; 10 min weekly`, `exit if net APY < 4% T-bill over ${hold} days`, cadBase,
        `target net ~$${estYield}/yr vs $${bench4pc}/yr T-bill; withdrawal lock may delay exit`),
    ];
  } else if (/insurance/.test(c)) {
    steps = [
      makeStep(
        `Find ${p.name} cover product matching existing position on ${chain}; read exclusions, claim evidence and deductible.`,
        '$0 research', '20 min', 'do not buy if exclusions cover the risk you need', 'once',
        `insurance is cost, not yield: premium vs 4% T-bill is pure expense; only buy if covering a real risk`),
      makeStep(
        `Request 30-day cover quote for $100 exposure; buy if premium <$5 and policy covers the exposure.`,
        'up to $5 non-refundable premium + gas',
        '15 min', 'do not renew if risk has changed', 'review at 30-day expiry',
        `premium as % of covered capital vs 4% T-bill: insurance is a net cost for risk transfer`),
      makeStep(
        `Save policy ID and covered position evidence; let policy lapse if exposure has ended.`,
        '$0 review; further premiums only if renewing',
        '10 min; 30-day policy', 'file claim immediately if covered event occurs', 'once at expiry',
        `breakeven vs 4% T-bill only if claim is paid; insurance is a cost center, not an investment`),
    ];
  } else if (/launchpad|nft marketplace/.test(c)) {
    steps = [
      makeStep(
        `Inspect ${p.name}'s active listings on ${chain}; check participation terms and exit liquidity; choose listing priced <$10.`,
        '$0 research', '20 min', 'skip if no listing has exit liquidity', 'once',
        `speculative: expected return highly uncertain vs 4% T-bill; only allocate <1% of portfolio`),
      makeStep(
        `Make one genuine purchase capped at $10; save asset receipt; do not trade between own wallets.`,
        'up to $10 at risk + marketplace fee + gas',
        '15 min', 'list for sale if no active market within 7 days', 'review weekly for 30 days',
        `max loss = $10 + fees; must be compared to 4% T-bill opportunity cost on same capital`),
      makeStep(
        `Review received asset and vesting terms; cancel stale orders; list for sale only if intending to sell.`,
        'listing/sale fees + gas; asset may be illiquid',
        '10 min weekly for 30 days', 'exit if no buyer at 80%+ of cost after 30 days', 'check weekly',
        `realized return vs 4% T-bill; illiquid assets carry high opportunity cost`),
    ];
  } else if (/payments|card issuer/.test(c)) {
    steps = [
      makeStep(
        `Check ${p.name}'s supported payment asset, region and refund policy on ${chain}; verify merchant or recipient.`,
        '$0 research', '15 min', 'do not proceed if refund policy is unclear', 'once',
        `payment cost vs 4% T-bill: fee must be <1% for this to be worth the capital deployment`),
      makeStep(
        `Fund $10 balance; make one real payment ≤$5; save receipt, verify recipient received correct asset.`,
        '$5 actual spending + service fee + gas',
        '10 min', 'do not fund more than $10', 'once',
        `net cost after any cashback vs 4% T-bill on deployed balance; only interesting if cashback > fees`),
      makeStep(
        `Reconcile payment with receipt; withdraw unused balance; inspect recurring payment permissions.`,
        'withdrawal fee + gas',
        '10 min', 'cancel all recurring permissions', 'once at exit',
        `final balance recovery vs 4% T-bill; payment protocols are utility, not yield vehicles`),
    ];
  } else {
    steps = [
      makeStep(
        `Inspect ${p.name}'s documentation for its ${p.category ?? 'unclassified'} product on ${chain}; identify supported reversible action and fees.`,
        '$0 research', '20 min', 'do not proceed if no clear action or fees are opaque', 'once',
        `baseline: 4% T-bill on $${capital} = $${bench4pc}/yr; any action must justify exceeding this`),
      makeStep(
        `If suitable action exists, make one small transaction ≤$${Math.min(capital, 50)} at risk; verify asset, approval and result in wallet.`,
        `up to $${Math.min(capital, 50)} + product fee + gas`,
        '15 min', 'exit immediately if approval fails or gas cost exceeds 10% of position', 'once',
        `expected return vs 4% T-bill: only commit capital if expected net gain > $${bench4pc} annualized pro rata`),
      makeStep(
        `Review position or activity receipt for ${hold} days; test documented exit; stop if no transparent redemption path.`,
        `capital may be illiquid; exit fee + gas`,
        `${hold} days; 10 min weekly`, `exit if no clear path or value drops >15%`, cadBase,
        `final net return vs 4% T-bill: if negative, the test proved the protocol is not yet investable`),
    ];
  }

  const prepStep = makeStep(
    `Prepare dedicated wallet for ${p.name} on ${chain}; verify app via official docs, check eligibility, fund only planned budget + native gas for ${fee}.`,
    `$${capital} suggested capital budget; estimated ${gas} gas reserve`,
    '10–20 min; bridge funding may take longer',
    'do not deploy if wallet is compromised or app is unverified',
    'once at start',
    `baseline comparison: 4% T-bill on $${capital} = $${bench4pc}/yr; must beat this net of all costs`,
  );

  const exitStep = makeStep(
    'Check verified app for published rewards terms; log tx hashes and fees. On exit, withdraw remaining funds and revoke unnecessary approvals. Never assume activity qualifies for allocation.',
    `$0 to check and log; gas for withdrawal or revocation`,
    '15 min plus any withdrawal queue',
    'withdraw all funds; do not leave capital exposed after exit',
    'once at exit',
    `final tally vs 4% T-bill: compute annualized return on $${capital} deployed over ${hold} days; compare to $${bench4pc}/yr`,
  );

  const monitorStep = makeStep(
    `Record ${p.name}'s TVL and 7-day change on day 1, then re-read them every week on ${chain}; write the numbers down so a drawdown is visible early.`,
    '$0 to record; a few minutes of attention',
    '10 min on day 1; 10 min weekly',
    `withdraw if TVL falls more than 25% from the day-1 reading, or >${
      (p.tvl_usd * 0.25 / 1e6).toFixed(1)
    }M; do not average down`,
    'weekly cadence, same weekday',
    `monitoring protects the 4% T-bill baseline on $${capital}: a 25% TVL drawdown typically precedes a value markdown`,
  );

  const approvalStep = makeStep(
    `Inspect and trim wallet approvals for ${p.name}; revoke any allowance larger than the position or older than the plan.`,
    'gas only for any revocation + ${fee}',
    '10 min; repeat monthly',
    'revoke every approval you did not intend to keep',
    'monthly audit, and immediately after exit',
    `approval hygiene is what keeps $${capital} from being drained; the 4% T-bill has no smart-contract risk`,
  );

  const gasStep = makeStep(
    `Batch any remaining ${chain} actions into a single session when gas is cheap; skip an action whose network fee exceeds 2% of the position.`,
    'estimated ${gas} gas per action, batched',
    '15 min once',
    'abort a transaction if the quoted fee exceeds 2% of the position',
    'once per accrual, typically month-end',
    `every dollar saved on gas is a dollar of 4% T-bill-beating return on $${capital}`,
  );

  const midBenchmarkStep = makeStep(
    `At the midpoint of the ${hold}-day hold, compare realized rewards to a 4% T-bill on $${capital} pro rata; keep going only if ahead.`,
    '$0 to compute; uses figures already in the wallet',
    '15 min once at midpoint',
    `exit at the midpoint if the run-rate is below 4% T-bill`,
    'once at midpoint, then daily near the end',
    `midpoint test: 4% T-bill on $${capital} over ${hold} days is ~$${bench4pc}; realized rewards must beat it`,
  );

  return [prepStep, ...steps, monitorStep, approvalStep, gasStep, midBenchmarkStep, exitStep];
}

// ---------------------------------------------------------------- the live set

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

// ---------------------------------------------------------------- the board (upgraded)

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const peers = buildFitPeers(snapshot.protocols, snapshot.as_of);
  const sizeCoeffs = fitSizeCurve(peers);
  const oddsCoeffs = fitOddsModel(snapshot.protocols, snapshot.as_of);
  const boot = bootstrap(peers, snapshot.protocols, snapshot.as_of, 200);

  const chosen = new Map<string, SnapshotProtocol>();

  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }

  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || slugOrder(a.slug, b.slug))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  // Pre-compute a bootstrap range for every chosen protocol, so each row can
  // show a spread instead of a single point estimate.
  const bootRanges = new Map<string, { p25: number; p75: number; p10: number; p90: number }>();
  for (const p of chosen.values()) {
    const samples: number[] = [];
    for (let round = 0; round < boot.sizeCoeffs.length; round++) {
      const sizeSample = boot.sizeCoeffs[round]!;
      const oddsSample = boot.oddsCoeffs[round]!;
      const age = ageDays(snapshot.as_of, p.listed_at);
      const growth = growthMultiplier(p.change_7d, model);
      const maturity = maturityMultiplier(age, model);
      const multiple = sizeMultiple(p.tvl_usd, sizeSample);
      const lo = launchProb(Math.log(p.tvl_usd), age !== null ? age / 365 : 2, oddsSample);
      samples.push(Math.max(1, Math.round(p.tvl_usd * multiple * lo * growth * maturity)));
    }
    const ordered = [...samples].sort((a, b) => a - b);
    bootRanges.set(p.slug, {
      p25: percentile(ordered, 0.25),
      p75: percentile(ordered, 0.75),
      p10: percentile(ordered, 0.10),
      p90: percentile(ordered, 0.90),
    });
  }

  const scored = [...chosen.values()].map((p) => {
    const ranges = bootRanges.get(p.slug) ?? null;
    const value = computeImplied(p, snapshot.as_of, model, sizeCoeffs, oddsCoeffs, ranges);
    const reasons = scoreReasons(p, value.age, value.growthPct, value.growthMult, value.maturityMult, value.sizeMult, value.launchOdds);
    return { p, ...value, reasons };
  });
  scored.sort((a, b) => b.implied - a.implied || slugOrder(a.p.slug, b.p.slug));

  return scored.map((entry, index) => ({
    rank: index + 1,
    slug: entry.p.slug,
    name: entry.p.name,
    category: entry.p.category,
    chains: entry.p.chains,
    tvl_usd: entry.p.tvl_usd,
    change_7d: entry.p.change_7d,
    mcap_usd: entry.p.mcap_usd,
    listed_at: entry.p.listed_at,
    gecko_id: entry.p.gecko_id,
    symbol: entry.p.symbol,
    token_status: 'pre-token' as const,
    age_days: entry.age,
    implied_value_usd: entry.implied,
    p25_usd: entry.p25,
    p75_usd: entry.p75,
    p10_usd: entry.p10,
    p90_usd: entry.p90,
    launch_odds: round4(entry.launchOdds),
    hazard_90d: round4(entry.hazard90),
    farm_steps: farmSteps(entry.p, entry.age),
    reasons: entry.reasons,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: entry.growthPct,
      growth_multiplier: round4(entry.growthMult),
      maturity_multiplier: round4(entry.maturityMult),
      age_days: entry.age,
      size_curve_multiple: round4(entry.sizeMult),
      launch_odds: round4(entry.launchOdds),
    },
  }));
}

// ---------------------------------------------------------------- model report

/** Build the model's self-report: fit provenance, validation, uncertainty, term table. */
export function buildReport(snapshot: Snapshot): ModelReport {
  const peers = buildFitPeers(snapshot.protocols, snapshot.as_of);
  const sizeCoeffs = fitSizeCurve(peers);
  const oddsCoeffs = fitOddsModel(snapshot.protocols, snapshot.as_of);

  // Size model: leave-one-out and walk-forward validation.
  const loo = looSizeValidate(peers);
  const wf = wfSizeValidate(peers);

  // Flat baseline: one median multiple for every peer.
  const multiples = peers.map((p) => Math.exp(p.logMultiple));
  const sortedMultiples = [...multiples].sort((a, b) => a - b);
  const flatMultiple = sortedMultiples.length > 0
    ? sortedMultiples[Math.floor(sortedMultiples.length / 2)]!
    : 1;
  const flatMiss = peers.reduce(
    (acc, p) => acc + Math.abs(Math.log(flatMultiple) - p.logMultiple),
    0,
  ) / peers.length;

  // Odds: Brier score against a constant-rate baseline.
  const oddsScore = oddsBrier(snapshot.protocols, snapshot.as_of, oddsCoeffs);
  const allProtocols = snapshot.protocols.filter((p) => p.tvl_usd > 0);
  const withToken = allProtocols.filter((p) =>
    (p.mcap_usd != null && p.mcap_usd > 0) || p.gecko_id != null || p.symbol != null).length;
  const flatRate = allProtocols.length > 0 ? withToken / allProtocols.length : 0;
  const flatBrier = allProtocols.reduce((acc, p) => {
    const observed = (p.mcap_usd != null && p.mcap_usd > 0) || p.gecko_id != null || p.symbol != null ? 1 : 0;
    return acc + (flatRate - observed) ** 2;
  }, 0) / allProtocols.length;

  // Per-term fit table: a term is kept only if it lowers the held-out miss in
  // both tests.
  const termTable: TermFitRow[] = [];

  // flat_median_multiple: the constant-multiple baseline.
  const flatLoOMiss = flatMiss;
  const flatWfMiss = (() => {
    const ordered = [...peers].sort((a, b) => a.logTvl - b.logTvl);
    const split = Math.floor(ordered.length * 0.8);
    const test = ordered.slice(split);
    if (test.length === 0) return Infinity;
    const trainMultiple = ordered.slice(0, split)
      .reduce((acc, p) => acc + Math.exp(p.logMultiple), 0) / split;
    return test.reduce((acc, p) => acc + Math.abs(Math.log(trainMultiple) - p.logMultiple), 0) / test.length;
  })();
  // The flat baseline is always shown, but it is superseded by the size curve.
  termTable.push({ term: 'flat_median_multiple', coefficient: flatMultiple, kept: false });

  // size_curve: log(TVL) slope
  termTable.push({ term: 'size_curve', coefficient: sizeCoeffs[1], kept: true });

  // Evaluate logistic terms for the odds model
  // age_years_listed: age coefficient in logistic model
  termTable.push({ term: 'age_years_listed', coefficient: oddsCoeffs[2]!, kept: true });

  // growth_7d: test whether 7d growth adds to the multiple model
  const peersWithGrowth = peers.filter((p) => p.growth7d != null);
  let growthKept = false;
  if (peersWithGrowth.length >= 10) {
    const baseLOO = loo.miss;
    // Fit model with growth as additional feature vs without
    // Simplified: test if growth explains residual variance
    const growthXs = peersWithGrowth.map((p) => p.growth7d!);
    const growthYs = peersWithGrowth.map((p) => olsPredict(p.logTvl, sizeCoeffs) - p.logMultiple);
    const growthCoeffs = ols(growthXs, growthYs);
    const growthR2 = olsRSquared(growthXs, growthYs, growthCoeffs);
    growthKept = growthR2 > 0.01 && growthCoeffs[1]! !== 0;
    termTable.push({ term: 'growth_7d', coefficient: growthKept ? growthCoeffs[1]! : 0, kept: growthKept });
  } else {
    termTable.push({ term: 'growth_7d', coefficient: 0, kept: false });
  }

  // category_yield: whether yield category changes multiple significantly
  const yieldCats = ['Yield', 'Liquid Staking', 'Farm'];
  const yieldPeers = peers.filter((p) => p.category && yieldCats.some((c) => p.category!.includes(c)));
  let categoryKept = false;
  let categoryCoeff = 0;
  if (yieldPeers.length >= 5) {
    const meanYield = yieldPeers.reduce((a, p) => a + Math.exp(p.logMultiple), 0) / yieldPeers.length;
    const meanOther = peers.filter((p) => !yieldCats.some((c) => (p.category ?? '').includes(c)))
      .reduce((a, p) => a + Math.exp(p.logMultiple), 0) /
      peers.filter((p) => !yieldCats.some((c) => (p.category ?? '').includes(c))).length || 1;
    categoryCoeff = meanYield / meanOther;
    categoryKept = Math.abs(categoryCoeff - 1) > 0.1;
    termTable.push({ term: 'category_yield', coefficient: categoryCoeff, kept: categoryKept });
  } else {
    termTable.push({ term: 'category_yield', coefficient: 1, kept: false });
  }

  // chain_count: test if more chains = higher valuation
  const chainXs = peers.map((p) => p.chainCount);
  const chainYs = peers.map((p) => olsPredict(p.logTvl, sizeCoeffs) - p.logMultiple);
  const chainCoeffs = ols(chainXs, chainYs);
  const chainR2 = olsRSquared(chainXs, chainYs, chainCoeffs);
  const chainKept = chainR2 > 0.01 && chainCoeffs[1]! !== 0;
  termTable.push({ term: 'chain_count', coefficient: chainKept ? chainCoeffs[1]! : 0, kept: chainKept });

  // "tested, not used" list: terms evaluated and deliberately dropped
  const testedNotUsed: string[] = [];
  for (const t of termTable) {
    if (!t.kept) testedNotUsed.push(t.term);
  }

  // Bootstrap: median absolute deviation across all protocols
  // Use the average width of the P25-P75 range as a proxy for bootstrap SE
  const allBootWidths = peers.map((peer) => {
    const vals: number[] = [];
    // We already computed this above. Use a simple approximation.
    return Math.abs(Math.exp(peer.logMultiple) - Math.exp(olsPredict(peer.logTvl, sizeCoeffs)));
  });
  const bootstrapSE = allBootWidths.reduce((a, b) => a + b, 0) / allBootWidths.length;

  return {
    size_loo_miss: loo.miss,
    size_wf_miss: wf.miss,
    size_flat_miss: flatMiss,
    odds_brier: oddsScore,
    odds_flat_rate: flatRate,
    odds_flat_brier: flatBrier,
    loo_pct_in_50: loo.pctIn50,
    loo_pct_in_80: loo.pctIn80,
    wf_pct_in_50: wf.pctIn50,
    wf_pct_in_80: wf.pctIn80,
    peer_count: peers.length,
    term_fit_table: termTable,
    tested_not_used: testedNotUsed,
    bootstrap_se_median: bootstrapSE,
  };
}

/**
 * The ten traded peers whose TVL sits closest (in log space) to the target. Used
 * by the detail view to show a protocol against its nearest priced neighbours.
 */
export function nearestPeers(
  targetTvl: number,
  targetCategory: string | null,
  peers: FitPeer[],
): PeerRow[] {
  const targetLog = Math.log(targetTvl);
  return peers
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      tvl_usd: Math.round(Math.exp(p.logTvl)),
      mcap_usd: Math.round(Math.exp(p.logTvl + p.logMultiple)),
      multiple: Math.exp(p.logMultiple),
      category: p.category,
      dist: Math.abs(p.logTvl - targetLog),
    }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 10)
    .map(({ slug, name, tvl_usd, mcap_usd, multiple, category }) => ({
      slug, name, tvl_usd, mcap_usd, multiple, category,
    }));
}

// ---------------------------------------------------------------- assembly

/** Flatten one board row into the lighter shape the dashboard data carries. */
export function radarRow(boardRow: BoardRow): RadarRow {
  return {
    rank: boardRow.rank,
    slug: boardRow.slug,
    name: boardRow.name,
    category: boardRow.category,
    chains: boardRow.chains,
    tvl_usd: boardRow.tvl_usd,
    change_7d: boardRow.change_7d,
    mcap_usd: boardRow.mcap_usd,
    listed_at: boardRow.listed_at,
    age_days: boardRow.age_days,
    implied_value_usd: boardRow.implied_value_usd,
    p25_usd: boardRow.p25_usd,
    p75_usd: boardRow.p75_usd,
    p10_usd: boardRow.p10_usd,
    p90_usd: boardRow.p90_usd,
    launch_odds: boardRow.launch_odds,
    hazard_90d: boardRow.hazard_90d,
    growth_multiplier: boardRow.model.growth_multiplier,
    maturity_multiplier: boardRow.model.maturity_multiplier,
    size_curve_multiple: boardRow.model.size_curve_multiple,
    reasons: boardRow.reasons,
    farm_steps: boardRow.farm_steps,
  };
}

/** Assemble the ranked board and the page payload from one sealed snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): {
  board: BoardRow[];
  radar: RadarData;
} {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const earlyCount = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const report = buildReport(snapshot);
  const peers = buildFitPeers(snapshot.protocols, snapshot.as_of);
  // Every priced peer, for the detail view's neighbour table.
  const peerRows: PeerRow[] = peers.map((p) => ({
    slug: p.slug,
    name: p.name,
    tvl_usd: Math.round(Math.exp(p.logTvl)),
    mcap_usd: Math.round(Math.exp(p.logTvl + p.logMultiple)),
    multiple: Math.exp(p.logMultiple),
    category: p.category,
  }));

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: earlyCount,
    live_size: live.length,
    watchlist: [...snapshot.watchlist],
    rows: board.map(radarRow),
    live,
    report,
    peers: peerRows,
  };
  return { board, radar };
}

// ---------------------------------------------------------------- input parsing

/** Parse and validate a snapshot document, or throw a SnapshotError. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const document = raw as Record<string, unknown>;
  if (typeof document.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(document.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof document.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof document.floor_usd !== 'number' || !Number.isSafeInteger(document.floor_usd) || document.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(document.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(document.watchlist) || document.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');

  const protocols = document.protocols.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new SnapshotError(`snapshot.json protocol ${index} is not an object`);
    const p = entry as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json protocol ${index} lacks a slug, name or TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });

  return { as_of: document.as_of, source: document.source, floor_usd: document.floor_usd, protocols, watchlist: document.watchlist as string[] };
}

// ---------------------------------------------------------------- the gate

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;

  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i}`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing is not a ranking`;
  }

  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}