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
// Valuation. For every ranked row, on the same code path:
//
//   implied = TVL × base × growth × maturity          (whole dollars, min $1)
//
//   growth   = 1 + weight · tanh(change_7d / cap)     bounded to [1-weight, 1+weight]
//   maturity = floor + range · age / (age + days)     floor at launch, saturating up
//
// The base multiple (0.25) is an explicit valuation assumption, not a fitted market
// price. tanh keeps one explosive week from dominating: growth can never leave its
// band no matter how large change_7d is. Maturity rewards a longer operating record
// but with diminishing returns, so a decade-old protocol is not infinitely worth
// more than a one-year-old one. Listing age is a proxy for operating history, not
// proof the token was absent the whole time. Missing growth is neutral (×1); missing
// age falls back to a neutral year. Ties on implied value break deterministically by
// slug, so two runs always produce the same board.

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

/** The model's version label, named by the dashboard and quoted by the rules. */
export const MODEL_VERSION = 'radar-2';

/** How many below-floor pre-token protocols the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm action: what to do, what it costs, how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
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
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
  reasons: string[];
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
  growth_multiplier: number;
  maturity_multiplier: number;
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
  rows: RadarRow[];
  live: LiveRow[];
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

/** A finite number, or a fallback when the value is absent or not numeric. */
function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Never let a negative age leak into the maturity curve. */
function atLeastZero(n: number): number {
  return n < 0 ? 0 : n;
}

/** Four-decimal rounding for the multipliers the page displays. */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** A deterministic, locale-independent slug ordering: the tie-break for every sort. */
function slugOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or unparseable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

// ---------------------------------------------------------------- the multipliers

/**
 * The bounded growth multiplier. tanh squashes any 7-day change into (-1, 1), so
 * the result never leaves [1 - weight, 1 + weight]: a +500% week and a +50% week
 * both land near the cap, and a crash near the floor. An unreported change is
 * neutral (exactly 1), never penalised and never rewarded.
 */
function growthMultiplier(change7d: number | null, model: ModelConstants): number {
  if (change7d === null) return 1;
  return 1 + model.growth_weight * Math.tanh(change7d / model.growth_cap);
}

/**
 * The age-maturity multiplier. At launch (age 0) it sits at the floor; it climbs
 * toward floor + range as the operating record lengthens, with diminishing returns
 * (age / (age + days) saturates at 1). An unknown age falls back to a neutral year.
 */
function maturityMultiplier(age: number | null, model: ModelConstants): number {
  const days = atLeastZero(age ?? model.unknown_age_days);
  return model.maturity_floor + (days / (days + model.maturity_days)) * model.maturity_range;
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = finiteOr(protocol.change_7d, 0);
  const growthMult = growthMultiplier(protocol.change_7d, model);
  const maturityMult = maturityMultiplier(age, model);
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age };
}

/** A per-row explanation of the score: the figures it came from and the factors applied. */
function scoreReasons(
  p: SnapshotProtocol,
  age: number | null,
  growthPct: number,
  growthMult: number,
  maturityMult: number,
  baseMultiple: number,
): string[] {
  const tvl = `$${(p.tvl_usd / 1e6).toFixed(1)}M TVL recorded`;
  const growth =
    p.change_7d === null
      ? '7d change unreported, growth neutral (×1)'
      : `${growthPct >= 0 ? '+' : ''}${growthPct.toFixed(1)}% TVL over 7 days`;
  const maturity =
    age === null
      ? 'listing age unreported, maturity neutral (365d, ×1)'
      : `${age} days operating with no token recorded`;
  const factors = `growth ×${growthMult.toFixed(2)}, maturity ×${maturityMult.toFixed(2)}, base ×${baseMultiple}`;
  return [tvl, growth, maturity, factors];
}

// ---------------------------------------------------------------- token status

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether the board may rank a protocol: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** Index the universe by slug for O(1) watchlist lookup. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

// ---------------------------------------------------------------- the board

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();

  // The watchlist is the floor: take every slug it names that the snapshot carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }

  // The early radar: rankable pre-token protocols below the floor, by TVL, capped.
  // These never replace a watchlist row; a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || slugOrder(a.slug, b.slug))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  // Score every chosen protocol on the same path, then rank by implied value with
  // a deterministic slug tie-break so the board is reproducible run to run.
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v, reasons: scoreReasons(p, v.age, v.growthPct, v.growthMult, v.maturityMult, model.base_multiple) };
  });
  scored.sort((a, b) => b.implied - a.implied || slugOrder(a.p.slug, b.p.slug));

  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
    reasons: s.reasons,
  }));
}

// ---------------------------------------------------------------- farm plans

/** Render one step as a single string within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A suggested capital budget from the protocol's own TVL. A budget, not an eligibility minimum. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** A qualifying hold window from the protocol's age: younger protocols get longer. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * Category routes are suggested workflows, not claims about a points program. Each
 * route is three category-specific actions wrapped by a preparation step and an
 * exit check. Capital is a budget; supported assets and eligibility must be checked
 * in-app. No route assumes activity qualifies for an allocation.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const c = (p.category ?? '').toLowerCase();
  const step = (text: string, cost: string, time: string): FarmStep => ({ text, cost, time });
  const gas = chain === 'Ethereum' ? '$5–25' : '$0.10–3';
  const fee = `estimated ${gas} gas per onchain action; check the wallet quote`;

  let route: FarmStep[];
  if (/lend|collateral|cdp/.test(c)) {
    route = [
      step(`On ${p.name}, supply $${capital} of an accepted stablecoin on ${chain}; for a CDP use accepted collateral instead. Verify the asset and liquidation terms first.`, `$${capital} capital + ${fee}`, '15 minutes'),
      step('If borrowing is supported, borrow no more than 10% of collateral value in an accepted stablecoin; skip borrowing if the rate or minimum size exceeds this budget.', `$${Math.round(capital * 0.1)} debt, variable interest shown in-app + ${fee}`, '10 minutes; monitor weekly'),
      step(`Keep the supply for ${hold} days; inspect health factor and rates weekly, then repay any debt before withdrawing collateral.`, `variable borrow interest, capital locked + ${fee} to repay`, `${hold} days; 10 minutes weekly`),
    ];
  } else if (/dex|liquidity manager/.test(c)) {
    route = [
      step(`Swap $${Math.round(capital / 2)} of an accepted asset in ${p.name} on ${chain}; cap slippage at 0.5% and reject an unfavorable quote.`, `up to $${(capital * 0.005).toFixed(2)} swap fee/slippage budget + ${fee}`, '10 minutes'),
      step(`Add $${capital} total to a liquid two-asset pool, split equally by value; use a wide range if liquidity is concentrated and save the position identifier.`, `$${capital} capital; pool fees and impermanent loss exposure + ${fee}`, '15 minutes'),
      step(`Check the pool weekly for ${hold} days, including whether the range is active; collect accrued fees only when they exceed the gas quote.`, `capital exposed to price divergence; ${fee} only if collecting`, `${hold} days; 10 minutes weekly`),
    ];
  } else if (/bridge/.test(c)) {
    route = [
      step(`Quote a $${capital} transfer through ${p.name} to ${chain}; verify the destination asset contract and send a $10 test first.`, `$10 test capital, estimated $1–10 bridge fee + source gas`, '10–30 minutes; wait for finality'),
      step(`After confirming receipt, bridge the remaining $${capital - 10} on the same verified route; stop if the fee quote exceeds $10.`, `$${capital - 10} capital + quoted bridge fee and gas`, '10–60 minutes; route dependent'),
      step('Use $10 of received assets in a supported destination swap, then quote a return transfer and record both transaction hashes.', `$10 swap capital, up to $1 swap fee + destination gas; return fee quoted separately`, '15 minutes plus bridge finality'),
    ];
  } else if (/stak|anchor btc|decentralized btc/.test(c)) {
    route = [
      step(`Acquire $${capital} of the supported staking or BTC asset for ${p.name} on ${chain}; verify any receipt token and withdrawal queue before depositing.`, `$${capital} capital, up to 0.5% swap spread + ${fee}`, '15 minutes'),
      step('Deposit the asset into the staking interface; retain the receipt and avoid adding leverage or recursively depositing it.', `$${capital} remains exposed to slashing, custody or depeg risk + ${fee}`, '10 minutes; activation may take days'),
      step(`Hold for ${hold} days and inspect rewards weekly; submit a small withdrawal request to understand the queue before a full exit.`, `variable reward fees; ${fee} for withdrawal request`, `${hold} days; withdrawal queue may add 1–21 days`),
    ];
  } else if (/perpetual|derivative|options|synthetic|basis trading/.test(c)) {
    route = [
      step(`Fund ${p.name} on ${chain} with $${capital} of accepted margin; read contract size, funding and liquidation rules before trading.`, `$${capital} margin + ${fee}`, '15 minutes'),
      step('If minimum size allows, open one position with at most $20 notional and at most 1× leverage; for options buy a contract with premium capped at $5. Skip if limits cannot be met.', 'up to $5 premium or trading loss budget; quoted trade fees and funding', '10 minutes; monitor until closed'),
      step('Close the entire position after checking execution spread; verify there are no residual orders and withdraw unused margin. Do not create wash volume.', `realized P/L, funding and quoted close fee + ${fee}`, 'same day; 15 minutes to close and verify'),
    ];
  } else if (/prediction/.test(c)) {
    route = [
      step(`Fund ${p.name} with $20 of its supported settlement asset on ${chain}; read one market's resolution source and expiry.`, `$20 capital + ${fee}`, '15 minutes'),
      step('Buy no more than $5 of one outcome you understand using a limit order; record resolution conditions and avoid markets without exit liquidity.', '$5 maximum position loss + displayed trading fee', '10 minutes'),
      step('Set a reminder for resolution, or sell the position before expiry if liquidity permits; redeem settled winnings only via the verified market page.', `up to $5 loss, quoted exit fee + ${fee}`, '10 minutes to exit; expiry can take days or months'),
    ];
  } else if (/rwa|cedefi|otc/.test(c)) {
    route = [
      step(`Check ${p.name}'s investor restrictions, KYC, custody and redemption minimums before funding on ${chain}; skip if ineligible or minimums exceed $${capital}.`, '$0 research; identity verification only through verified issuer', '30 minutes; approval may take 1–5 business days'),
      step(`If eligible, subscribe with $${capital} to a supported asset and save the receipt, NAV date and redemption terms. Do not assume a token allocation.`, `$${capital} capital, issuer subscription fee if any + ${fee}`, '20 minutes; settlement 1–5 business days'),
      step(`Review NAV and issuer reports weekly for ${hold} days; submit redemption before the published cutoff and track cash settlement.`, `issuer management/redemption fees as quoted; capital illiquid until settlement`, `${hold} days plus published settlement delay`),
    ];
  } else if (/stable|reserve currency/.test(c)) {
    route = [
      step(`Compare mint and redeem quotes for ${p.name}'s supported stable asset on ${chain}; inspect collateral and reject a quote over 0.5% away from its intended peg.`, '$0 to inspect; no transaction required', '15 minutes'),
      step(`Mint or acquire $${capital} of the stable asset using accepted collateral; do not borrow against the resulting balance.`, `$${capital} capital, quoted mint/swap fee + ${fee}`, '15 minutes'),
      step(`Hold for ${hold} days, check peg and redemption liquidity weekly, then redeem a $10 test before the remaining balance.`, `depeg exposure; quoted redeem fee + ${fee} per redemption`, `${hold} days; 10 minutes weekly; settlement per app`),
    ];
  } else if (/yield|farm|curator|allocator|indexes|options vault/.test(c)) {
    route = [
      step(`Compare ${p.name}'s vault assets, strategy, management fee and withdrawal lock on ${chain}; choose an unlevered vault only if its minimum is within $${capital}.`, '$0 research; no approval needed', '20 minutes'),
      step(`Deposit $${capital} of an accepted asset into that vault and save the share balance; avoid auto-leverage and check the allowance matches the deposit.`, `$${capital} capital + ${fee}; ongoing vault fees per terms`, '15 minutes'),
      step(`Keep shares for ${hold} days, review share price and strategy weekly, and request a $10 test redemption before exiting the rest.`, `strategy losses possible; quoted performance/exit fees + ${fee}`, `${hold} days; 10 minutes weekly; withdrawal lock per vault`),
    ];
  } else if (/insurance/.test(c)) {
    route = [
      step(`Find a ${p.name} cover product matching an existing position on ${chain}; read exclusions, claim evidence and deductible before paying.`, '$0 research; use an existing exposure', '20 minutes'),
      step('Request a 30-day cover quote for $100 of exposure; buy only if the total premium is under $5 and the policy actually covers that exposure.', `up to $5 non-refundable premium + ${fee}`, '15 minutes; 30-day policy'),
      step('Save the policy ID and evidence of the covered position; review expiry and let the policy lapse if the exposure has ended.', '$0 review; further premiums only if renewing', '10 minutes now and at 30-day expiry'),
    ];
  } else if (/launchpad|nft marketplace/.test(c)) {
    route = [
      step(`Inspect ${p.name}'s active listings on ${chain}, participation terms and exit liquidity; choose only a listing with a purchase price below $10.`, '$0 research; no purchase if no suitable listing', '20 minutes'),
      step('If eligible, make one genuine purchase capped at $10; save the asset or allocation receipt and do not trade between your own wallets.', `up to $10 at risk, quoted marketplace fee + ${fee}`, '15 minutes; allocation settlement per listing'),
      step('Review the received asset and any vesting terms weekly; cancel stale orders and list for sale only if you actually intend to sell.', `quoted listing/sale fees + ${fee}; asset may be illiquid`, '10 minutes weekly for 30 days'),
    ];
  } else if (/payments|card issuer/.test(c)) {
    route = [
      step(`Check ${p.name}'s supported payment asset, region and refund policy on ${chain}; use a verified merchant or a recipient you actually owe.`, '$0 research; do not pay a setup fee without reviewing terms', '15 minutes'),
      step('Fund a $10 balance and make one real payment of at most $5; save the receipt and verify the recipient received the correct asset.', `$5 actual spending + quoted service fee and ${fee}`, '10 minutes plus settlement'),
      step('Reconcile the payment with your receipt, withdraw the unused balance and inspect any recurring payment permissions.', `withdrawal fee as quoted + ${fee}`, '10 minutes; settlement per service'),
    ];
  } else {
    route = [
      step(`Inspect ${p.name}'s documentation for its ${p.category ?? 'unclassified'} product on ${chain}; identify a supported, reversible action and read fees before connecting. Do not assume it accepts deposits.`, '$0 research', '20 minutes'),
      step(`If a suitable action exists, make one small genuine transaction with at most $${Math.min(capital, 50)} at risk; verify the asset, approval and result in the wallet. Otherwise stop after research.`, `up to $${Math.min(capital, 50)} capital + quoted product fee and ${fee}`, '15 minutes; settlement per product'),
      step(`Review the position or activity receipt weekly for ${hold} days; test the documented exit and stop if the product has no transparent redemption path.`, `capital may be illiquid; quoted exit fee + ${fee}`, `${hold} days; 10 minutes weekly; exit delay per documentation`),
    ];
  }

  return [
    step(`Prepare a dedicated wallet for ${p.name} on ${chain}; verify the app through official documentation, check eligibility and fund only the planned budget plus native gas.`, `$${capital} suggested capital budget, not an eligibility threshold; estimated ${gas} gas reserve`, '10–20 minutes; bridge funding can take longer'),
    ...route,
    step('Check the verified app for any published rewards terms; log transaction hashes and fees. On exit, withdraw remaining funds and revoke unnecessary approvals. Never assume activity qualifies for an allocation.', `$0 to check and log; ${fee} for withdrawal or revocation`, '15 minutes plus any withdrawal queue'),
  ];
}

// ---------------------------------------------------------------- the live set

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
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

// ---------------------------------------------------------------- assembly

/** A board row's form for data.js; plans are serialized once, never reimplemented in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    reasons: row.reasons,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

// ---------------------------------------------------------------- input parsing

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');

  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
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

  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

// ---------------------------------------------------------------- the gate

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;

  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }

  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}