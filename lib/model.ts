// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and may add
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board.
//
// Implied value follows only from the snapshot's own figures, in three factors:
//
//   base       = tvl_usd x base_multiple(row)
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   implied    = max(1, round(base x growthMult x maturity))
//
// radar-2 fits base_multiple(row) from the snapshot's own tokenised protocols instead of fixing it at
// one house constant: a winsorised log-log regression of market cap on TVL over the comps (mcap > 0,
// TVL > 0, CEX excluded), plus a per-category intercept shrunk toward the global fit by sample size,
// recalibrated around the growth and maturity factors (the regression target is log(mcap) with those
// two factors divided out). The effective multiple a row carries is exp(a + adj_category) x
// tvl^(slope - 1), so implied = tvl x base_multiple(row) x growthMult x maturity holds exactly, the
// same arithmetic the dashboard recomputes. Fitted growth and age coefficients of their own were
// tested on a holdout and rejected (docs/model-v1.md): the house growth/maturity factors stay, with
// the base recalibrated around them. No protocol name is ever special-cased: the same function scores
// every row, and a category with no comps falls back to the global fit.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The model's factor constants. base_multiple is only the fallback for a snapshot with no comps to
 * fit: the dashboard states the fitted headline multiple buildRadar derives (see FittedBase). */
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
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
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
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
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
  base_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
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

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The growth and maturity factors one protocol gets under `model`, and its age. */
export function growthMaturity(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): { growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  return { growthPct, growthMult, maturityMult, age };
}

/** The fitted base of radar-2: a log-log regression over the snapshot's own tokenised protocols. */
export interface FittedBase {
  /** Regression intercept: log market cap at log TVL 0, growth/maturity factors divided out. */
  intercept: number;
  /** Regression slope: the TVL elasticity of market cap. */
  slope: number;
  /** Per-category intercept adjustment in log space, shrunk toward zero by sample size. */
  category_adjustments: Map<string, number>;
  /** How many comps the fit used. */
  comps_used: number;
  /** The comps' median TVL: the reference size for the headline base multiple. */
  median_tvl_usd: number;
}

/** How strongly a category's own intercept counts against the global fit, by sample size. */
const CATEGORY_SHRINKAGE = 6;

/** The protocols the base is fitted on: tokenised, with a real market cap and TVL, never an exchange. */
export function isComp(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX';
}

/** The median of a non-empty list. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A quantile of a non-empty list, linearly interpolated between closest ranks. */
function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const at = q * (sorted.length - 1);
  const lo = Math.floor(at);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/** Least squares y ~ x: intercept and slope. */
function ols(xs: number[], ys: number[]): { intercept: number; slope: number } {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  return { intercept: my - slope * mx, slope };
}

/**
 * Fit the base on `protocols` (the whole snapshot in production, the fit set in validation): regress
 * log(mcap / (growthMult x maturityMult)) on log(TVL) over the comps, winsorise the residuals at the
 * 5th/95th percentile and refit, then take each category's mean residual as its intercept, shrunk
 * toward the global fit by n / (n + CATEGORY_SHRINKAGE). Deterministic: no randomness, no network.
 */
export function fitBaseModel(protocols: SnapshotProtocol[], asOf: string, model: ModelConstants): FittedBase {
  const comps = protocols.filter(isComp);
  if (comps.length === 0) return { intercept: Math.log(model.base_multiple), slope: 1, category_adjustments: new Map(), comps_used: 0, median_tvl_usd: 0 };
  const xs = comps.map((p) => Math.log(p.tvl_usd));
  const target = (p: SnapshotProtocol): number => {
    const { growthMult, maturityMult } = growthMaturity(p, asOf, model);
    return Math.log(p.mcap_usd!) - Math.log(growthMult * maturityMult);
  };
  const ys = comps.map(target);
  const first = ols(xs, ys);
  const residuals = comps.map((p, i) => ys[i]! - (first.intercept + first.slope * xs[i]!));
  const rLo = quantile(residuals, 0.05);
  const rHi = quantile(residuals, 0.95);
  const winsorised = comps.map((p, i) => first.intercept + first.slope * xs[i]! + Math.min(rHi, Math.max(rLo, residuals[i]!)));
  const fit = ols(xs, winsorised);
  const byCategory = new Map<string, number[]>();
  comps.forEach((p, i) => {
    const key = p.category ?? '';
    const list = byCategory.get(key) ?? [];
    list.push(winsorised[i]! - (fit.intercept + fit.slope * xs[i]!));
    byCategory.set(key, list);
  });
  const adjustments = new Map<string, number>();
  for (const key of [...byCategory.keys()].sort()) {
    const list = byCategory.get(key)!;
    const mean = list.reduce((s, v) => s + v, 0) / list.length;
    adjustments.set(key, (list.length / (list.length + CATEGORY_SHRINKAGE)) * mean);
  }
  return {
    intercept: fit.intercept,
    slope: fit.slope,
    category_adjustments: adjustments,
    comps_used: comps.length,
    median_tvl_usd: median(comps.map((p) => p.tvl_usd)),
  };
}

/** The effective base multiple a row carries under the fitted base: exp(a + adj) x tvl^(slope - 1). */
export function effectiveMultiple(protocol: SnapshotProtocol, fitted: FittedBase): number {
  const adj = fitted.category_adjustments.get(protocol.category ?? '') ?? 0;
  if (protocol.tvl_usd <= 0) return Math.exp(fitted.intercept + adj);
  return Math.exp(fitted.intercept + adj + (fitted.slope - 1) * Math.log(protocol.tvl_usd));
}

/** The fitted base's headline multiple: the effective multiple at the comps' median TVL, category-neutral. */
export function headlineMultiple(fitted: FittedBase): number {
  if (fitted.median_tvl_usd <= 0) return Math.exp(fitted.intercept);
  return Math.exp(fitted.intercept + (fitted.slope - 1) * Math.log(fitted.median_tvl_usd));
}

/** One protocol scored by radar-2: the fitted base with the growth and maturity factors applied. */
export function scoreProtocol(protocol: SnapshotProtocol, asOf: string, model: ModelConstants, fitted: FittedBase): { implied: number; baseMultiple: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const { growthPct, growthMult, maturityMult, age } = growthMaturity(protocol, asOf, model);
  const baseMultiple = effectiveMultiple(protocol, fitted);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * baseMultiple * growthMult * maturityMult));
  return { implied, baseMultiple, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const fitted = fitBaseModel(snapshot.protocols, snapshot.as_of, model);
  const scored = [...chosen.values()].map((p) => {
    const { implied, baseMultiple, growthPct, growthMult, maturityMult, age } = scoreProtocol(p, snapshot.as_of, model, fitted);
    return { p, implied, baseMultiple, growthPct, growthMult, maturityMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
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
      base_multiple: s.baseMultiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * Chain economics the farm plans price with: a typical contract transaction's gas in US dollars and
 * the chain's native asset. Reference constants, like the model's own: stated in one place so a
 * reader can disagree with them. Every per-protocol figure still derives from the snapshot row —
 * which chains the protocol runs on, its category, its TVL, its age, its seven-day move. A chain the
 * table does not name gets the default alt-L1/L2 estimate.
 */
interface ChainEcon {
  gas_usd: number;
  asset: string;
}

const CHAIN_ECON: Record<string, ChainEcon> = {
  Ethereum: { gas_usd: 2.4, asset: 'ETH' },
  Bitcoin: { gas_usd: 1.5, asset: 'BTC' },
  Tron: { gas_usd: 0.6, asset: 'TRX' },
  Cardano: { gas_usd: 0.25, asset: 'ADA' },
  Solana: { gas_usd: 0.02, asset: 'SOL' },
  Binance: { gas_usd: 0.05, asset: 'BNB' },
  Op_Bnb: { gas_usd: 0.03, asset: 'BNB' },
  Arbitrum: { gas_usd: 0.1, asset: 'ETH' },
  Base: { gas_usd: 0.04, asset: 'ETH' },
  Optimism: { gas_usd: 0.06, asset: 'ETH' },
  Unichain: { gas_usd: 0.03, asset: 'ETH' },
  Linea: { gas_usd: 0.05, asset: 'ETH' },
  Scroll: { gas_usd: 0.05, asset: 'ETH' },
  Blast: { gas_usd: 0.03, asset: 'ETH' },
  'zkSync Era': { gas_usd: 0.05, asset: 'ETH' },
  Taiko: { gas_usd: 0.03, asset: 'ETH' },
  Avalanche: { gas_usd: 0.1, asset: 'AVAX' },
  Polygon: { gas_usd: 0.01, asset: 'POL' },
  'Hyperliquid L1': { gas_usd: 0.02, asset: 'HYPE' },
  Monad: { gas_usd: 0.01, asset: 'MON' },
  Berachain: { gas_usd: 0.05, asset: 'BERA' },
  Sonic: { gas_usd: 0.02, asset: 'S' },
  Sui: { gas_usd: 0.01, asset: 'SUI' },
  Aptos: { gas_usd: 0.01, asset: 'APT' },
  Near: { gas_usd: 0.01, asset: 'NEAR' },
  Stellar: { gas_usd: 0.01, asset: 'XLM' },
  Ripple: { gas_usd: 0.01, asset: 'XRP' },
  Algorand: { gas_usd: 0.01, asset: 'ALGO' },
  TON: { gas_usd: 0.05, asset: 'TON' },
  Doge: { gas_usd: 0.05, asset: 'DOGE' },
  Litecoin: { gas_usd: 0.02, asset: 'LTC' },
  Zcash: { gas_usd: 0.05, asset: 'ZEC' },
  Starknet: { gas_usd: 0.06, asset: 'STRK' },
  Mantle: { gas_usd: 0.02, asset: 'MNT' },
  Sei: { gas_usd: 0.01, asset: 'SEI' },
  Celo: { gas_usd: 0.01, asset: 'CELO' },
  Fantom: { gas_usd: 0.02, asset: 'FTM' },
  Cronos: { gas_usd: 0.02, asset: 'CRO' },
  Metis: { gas_usd: 0.05, asset: 'METIS' },
};

const DEFAULT_ECON: ChainEcon = { gas_usd: 0.12, asset: 'its native token' };

/** A dollar figure the way the plans write it: cents under ten dollars, no trailing zeros. */
function money(n: number): string {
  const r = Math.round(n * 100) / 100;
  return `$${r.toFixed(2).replace(/\.?0+$/, '')}`;
}

/** A signed seven-day change the way the plans write it: one decimal, an explicit sign. */
function pct(n: number): string {
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  if (p.tvl_usd >= 15_000_000) return 75;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The farm kinds the templates speak: one per way a protocol is actually used. */
type FarmKind =
  | 'lending' | 'uncollat' | 'cdp' | 'synth' | 'dex' | 'yield' | 'yieldagg' | 'curator' | 'allocator'
  | 'lstaking' | 'staking' | 'restaking' | 'bridge' | 'perps' | 'basis' | 'levfarm' | 'farm'
  | 'liqmgr' | 'rwa' | 'chain' | 'btc' | 'stable' | 'indexes' | 'insurance' | 'payments' | 'gov'
  | 'prediction' | 'cedefi' | 'options' | 'privacy' | 'generic';

/** A protocol's farm kind, from its snapshot category: exact names first, then keyword families. */
function farmKind(category: string | null): FarmKind {
  const exact: Record<string, FarmKind> = {
    Lending: 'lending',
    'Uncollateralized Lending': 'uncollat',
    'Collateral Markets': 'lending',
    'Collateral Management': 'lending',
    CDP: 'cdp',
    'CDP Manager': 'cdp',
    Synthetics: 'synth',
    Dexs: 'dex',
    Yield: 'yield',
    'Yield Aggregator': 'yieldagg',
    'Risk Curators': 'curator',
    'Onchain Capital Allocator': 'allocator',
    'Liquid Staking': 'lstaking',
    'Staking Pool': 'staking',
    Restaking: 'restaking',
    'Liquid Restaking': 'restaking',
    Bridge: 'bridge',
    'Canonical Bridge': 'bridge',
    'Cross Chain Bridge': 'bridge',
    Derivatives: 'perps',
    'Basis Trading': 'basis',
    'Leveraged Farming': 'levfarm',
    Farm: 'farm',
    'Liquidity Manager': 'liqmgr',
    RWA: 'rwa',
    Chain: 'chain',
    'Anchor BTC': 'btc',
    'Decentralized BTC': 'btc',
    'Restaked BTC': 'btc',
    'Dual-Token Stablecoin': 'stable',
    'Algo-Stables': 'stable',
    'Stablecoin Wrapper': 'stable',
    'Stablecoin Issuer': 'stable',
    Indexes: 'indexes',
    Insurance: 'insurance',
    Payments: 'payments',
    'Crypto Card Issuer': 'payments',
    'Governance Incentives': 'gov',
    'Prediction Market': 'prediction',
    CeDeFi: 'cedefi',
    Options: 'options',
    'Options Vault': 'options',
    Privacy: 'privacy',
  };
  if (category !== null && exact[category] !== undefined) return exact[category]!;
  const c = (category ?? '').toLowerCase();
  if (c.includes('uncollateral')) return 'uncollat';
  if (c.includes('lend') || c.includes('collateral')) return 'lending';
  if (c.includes('cdp')) return 'cdp';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('restak')) return 'restaking';
  if (c.includes('liquid staking')) return 'lstaking';
  if (c.includes('staking')) return 'staking';
  if (c.includes('perpetual') || c.includes('derivative')) return 'perps';
  if (c.includes('curator')) return 'curator';
  if (c.includes('allocat')) return 'allocator';
  if (c.includes('stable')) return 'stable';
  if (c.includes('yield')) return 'yield';
  if (c.includes('dex') || c.includes('swap')) return 'dex';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('insur')) return 'insurance';
  if (c.includes('predict')) return 'prediction';
  if (c.includes('option')) return 'options';
  if (c.includes('index')) return 'indexes';
  if (c.includes('pay') || c.includes('card')) return 'payments';
  if (c.includes('btc')) return 'btc';
  if (c.includes('farm')) return 'farm';
  return 'generic';
}

/** The plan's working figures for one protocol, all derived before any step is written. */
interface FarmPlan {
  kind: FarmKind;
  chain: string;
  home: string;
  gas: number;
  asset: string;
  capital: number;
  hold: number;
  funding: number;
  setupCost: number;
  actions: number;
  cadence: string;
  actionCost: number;
  activityCost: number;
  exitCost: number;
  net: number;
  ratio: number;
}

/**
 * Price one protocol's farm before writing it: pick the chain to transact on (its first chain,
 * unless an expensive one can be escaped to a far cheaper deployment of the same protocol),
 * size the capital from its TVL, set the hold from its age, then cost funding, setup, a recurring
 * activity cadence the chain's gas can afford, and the exit. If the recurring activity alone would
 * push the net cost past the ceiling the plans are held to ($0.50 per $1 deployed), the cadence is
 * thinned first; a plan that still cannot fit says so in its own budget step rather than hiding it.
 */
function planFarm(p: SnapshotProtocol, age: number | null): FarmPlan {
  const kind = farmKind(p.category);
  const home = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  let chain = home;
  let gas = (CHAIN_ECON[home] ?? DEFAULT_ECON).gas_usd;
  let asset = (CHAIN_ECON[home] ?? DEFAULT_ECON).asset;
  // The plan farms where the protocol's activity concentrates — its first chain — unless that chain
  // is expensive and another of its chains is at least three times cheaper to transact on: then the
  // plan moves, and its setup step says why. Chasing a cent of difference onto a thin deployment
  // would be false economy, so a merely cheaper chain is not enough.
  if (gas >= 0.5) {
    for (const c of p.chains) {
      const econ = CHAIN_ECON[c] ?? DEFAULT_ECON;
      if (econ.gas_usd * 3 <= gas && econ.gas_usd < gas) {
        chain = c;
        gas = econ.gas_usd;
        asset = econ.asset;
      }
    }
  }
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const funding = chain === 'Bitcoin' ? 5 : Math.max(2.5 * gas, 0.3);
  const setupTxs = kind === 'dex' || kind === 'cdp' || kind === 'synth' || kind === 'levfarm' || kind === 'farm' ? 3 : kind === 'perps' ? 1 : 2;
  const entryFee = kind === 'dex' || kind === 'farm' ? 0.0015 * capital : kind === 'stable' || kind === 'bridge' ? 0.001 * capital : 0;
  const setupCost = setupTxs * gas + entryFee;
  const per = gas <= 0.3 ? 7 : gas <= 1.2 ? 14 : 30;
  const cadence = per === 7 ? 'once a week' : per === 14 ? 'once every two weeks' : 'once a month';
  const actionCost = kind === 'bridge' ? 2 * gas + 0.001 * capital : kind === 'perps' ? 2 * gas + 0.04 : gas;
  const exitFee = kind === 'dex' || kind === 'farm' ? 0.001 * capital : kind === 'stable' ? 0.0005 * capital : 0;
  const exitCost = 2 * gas + exitFee;
  let actions = Math.max(1, Math.floor(hold / per));
  let activityCost = actions * actionCost;
  let net = funding + setupCost + activityCost + exitCost;
  while (net / capital > 0.48 && actions > 1) {
    actions -= 1;
    activityCost = actions * actionCost;
    net = funding + setupCost + activityCost + exitCost;
  }
  return { kind, chain, home, gas, asset, capital, hold, funding, setupCost, actions, cadence, actionCost, activityCost, exitCost, net, ratio: net / capital };
}

/** The two steps that open the position, in the words of the protocol's own kind of product. */
function coreSteps(plan: FarmPlan, name: string): FarmStep[] {
  const { kind, chain, asset, capital: cap, gas } = plan;
  const gasCost = `about ${money(gas)} of gas`;
  const capCost = `${money(cap)} of capital, back on exit, plus ${gasCost}`;
  switch (kind) {
    case 'lending':
      return [
        { text: `Supply ${money(cap)} of USDC to ${name} on ${chain} as collateral and leave it supplied; this deposit is the position everything else builds on.`, cost: capCost, time: '10 minutes' },
        { text: `Borrow ${money(Math.round(cap * 0.4))} of USDC against the deposit — about 40% of it, keeping the health factor above 2 — and repay it after a week: one clean borrow-and-repay cycle is the activity lending points programs count.`, cost: `about ${money(2 * gas)} of gas for the borrow and the repay, plus a few cents of borrow interest`, time: '10 minutes, twice' },
      ];
    case 'uncollat':
      return [
        { text: `Read ${name}'s pool list first and supply ${money(cap)} of USDC to its longest-running pool on ${chain} — in uncollateralised lending the pool's track record is the only collateral there is.`, cost: capCost, time: '25 minutes, reading included' },
        { text: `Check the pool's borrowers and past defaults before the money moves: if borrowers are unnamed or defaults unexplained, do not supply at all — run this plan's free steps instead and keep the capital.`, cost: 'no transaction, just the reading', time: '15 minutes of reading' },
      ];
    case 'cdp':
      return [
        { text: `Open a vault on ${name} (${chain}) and deposit ${money(cap)} of ${asset} or its liquid-staking version as collateral.`, cost: capCost, time: '15 minutes' },
        { text: `Mint the protocol's stablecoin against about 35% of the collateral's value — roughly ${money(Math.round(cap * 0.35))} — and hold it or swap half back to USDC; keep the collateral ratio above 200% so a bad week cannot liquidate the vault.`, cost: `about ${money(2 * gas)} of gas`, time: '10 minutes' },
      ];
    case 'synth':
      return [
        { text: `Deposit ${money(cap)} of USDC or ${asset} as collateral on ${name} (${chain}) and open a minting position.`, cost: capCost, time: '15 minutes' },
        { text: `Mint synthetic dollars against about 35% of the collateral — roughly ${money(Math.round(cap * 0.35))} — and hold them or park them in the protocol's own pool; keep the collateral ratio above 200% so a bad week cannot liquidate the position.`, cost: `about ${money(2 * gas)} of gas`, time: '10 minutes' },
      ];
    case 'dex':
      return [
        { text: `Swap half of the capital — ${money(Math.round(cap / 2))} of USDC — into the pair asset of ${name}'s main pool on ${chain}, then add both sides as liquidity in that pool.`, cost: `${capCost}, plus about ${money(0.0015 * cap)} of swap fees`, time: '15 minutes' },
        { text: `Stake the LP receipt in ${name}'s farm or gauge if it offers one; if it does not, the pool position alone is the record.`, cost: gasCost, time: '5 minutes' },
      ];
    case 'yield':
      return [
        { text: `Deposit ${money(cap)} of USDC into ${name}'s main vault on ${chain}; the vault, not a manual strategy, does the routing from here.`, cost: capCost, time: '10 minutes' },
        { text: `Turn on auto-compounding if the vault offers it; if rewards pay out in a separate token, claim and re-deposit them at the mid-hold check instead of letting them sit idle.`, cost: 'no transaction until the mid-hold claim', time: '5 minutes' },
      ];
    case 'yieldagg':
      return [
        { text: `Deposit ${money(cap)} of USDC into ${name}'s main aggregator vault on ${chain} and keep the shares.`, cost: capCost, time: '10 minutes' },
        { text: `Write down which underlying farms the aggregator holds on the day you deposit; if it later rotates into something you would not hold directly, that rotation is the exit signal.`, cost: 'no transaction, just the note', time: '10 minutes' },
      ];
    case 'curator':
      return [
        { text: `Deposit ${money(cap)} of USDC into the largest USDC vault curated through ${name} on ${chain} and keep the vault shares.`, cost: capCost, time: '10 minutes' },
        { text: `Read the vault's market list once before the hold starts: know which lending markets your USDC actually sits in, because the curator, not you, picks them — and can move them.`, cost: 'no transaction, just the reading', time: '15 minutes of reading' },
      ];
    case 'allocator':
      return [
        { text: `Deposit ${money(cap)} of USDC into an allocator vault on ${name} (${chain}) and keep the shares; one vault, one strategy, no splitting at this size.`, cost: capCost, time: '10 minutes' },
        { text: `Note which strategies the allocator is running and their weights on day one; allocators earn by moving capital, so a strategy list that changes over the hold is normal, not a warning.`, cost: 'no transaction, just the note', time: '10 minutes' },
      ];
    case 'lstaking':
      return [
        { text: `Stake ${money(cap)} of ${asset} through ${name} on ${chain} and keep the liquid staking token it returns.`, cost: capCost, time: '10 minutes' },
        { text: `Put the receipt token to work in one place that accepts it — supplied as collateral in a major lending market, or in its main liquidity pool; if neither exists on ${chain}, simply holding the receipt is a complete position.`, cost: gasCost, time: '10 minutes' },
      ];
    case 'staking':
      return [
        { text: `Delegate ${money(cap)} of ${asset} through ${name}'s pool on ${chain}, to the pool's default or largest validator rather than the highest advertised rate.`, cost: capCost, time: '10 minutes' },
        { text: `Leave the stake untouched for the hold: rewards compound inside the receipt, and moving validators mid-hold usually resets the reward clock.`, cost: 'nothing', time: 'no action' },
      ];
    case 'restaking':
      return [
        { text: `Deposit ${money(cap)} of a liquid staking token — or ${asset}, which ${name} converts — into ${name} on ${chain} and keep the restaking receipt.`, cost: capCost, time: '10 minutes' },
        { text: `Choose the default operator set if ${name} asks: restaking adds slashing exposure on top of ordinary staking, so the conservative operator choice is the plan, not a missed optimisation.`, cost: 'nothing', time: '5 minutes' },
      ];
    case 'bridge':
      return [
        { text: `Bridge ${money(cap)} of USDC through ${name} to ${chain} and keep the bridged funds in the destination wallet; bridges count completed routes, so finish the trip in one sitting.`, cost: `${capCost}, plus about ${money(0.001 * cap)} of bridge fee`, time: '15 minutes, plus the wait for the transfer itself' },
        { text: `Use the bridged USDC once on the destination chain — one swap or one small lending deposit — so the trip is real usage, not a bare transfer.`, cost: gasCost, time: '10 minutes' },
      ];
    case 'perps':
      return [
        { text: `Deposit ${money(cap)} of USDC as margin on ${name} (${chain}) and set leverage to 2x or lower; this is a volume farm, not a directional bet.`, cost: capCost, time: '10 minutes' },
        { text: `Trade small and flat: open a ${money(40)}-notional position and close it the same day, never leaving leverage on overnight. The target over the hold is about ${money(plan.actions * 80)} of total volume, built from the round trips below.`, cost: 'the trading fees ride on the activity step', time: '10 minutes a round trip' },
      ];
    case 'basis':
      return [
        { text: `Deposit ${money(cap)} of USDC into ${name}'s delta-neutral basis vault on ${chain}; the vault holds the hedge, you hold the shares.`, cost: capCost, time: '10 minutes' },
        { text: `Check the funding regime the vault lives on once at the start: basis yield is funding paid by leveraged longs, and it thins or flips when the market deleverages.`, cost: 'no transaction, just the reading', time: '10 minutes of reading' },
      ];
    case 'levfarm':
      return [
        { text: `Open a leveraged farm on ${name} with ${money(cap)} of equity at no more than 2x leverage, in its main stable pair on ${chain}.`, cost: `${capCost}, plus about ${money(0.0015 * cap)} of swap fees`, time: '20 minutes' },
        { text: `Keep the liquidation buffer wide: if the position's health falls into the warning zone the app marks, repay part of the borrow the same day rather than adding collateral in a panic.`, cost: 'a repay transaction if it comes to that, about ' + money(gas), time: '10 minutes, only if needed' },
      ];
    case 'farm':
      return [
        { text: `Provide ${money(cap)} of liquidity to ${name}'s main incentivised pool on ${chain} and stake the LP token in its farm.`, cost: `${capCost}, plus about ${money(0.0015 * cap)} of swap fees`, time: '15 minutes' },
        { text: `Harvest once at mid-hold and restake the rewards; harvesting more often than that spends more on gas than the rewards are worth at this size.`, cost: `about ${money(2 * gas)} of gas at mid-hold`, time: '10 minutes, once' },
      ];
    case 'liqmgr':
      return [
        { text: `Deposit ${money(cap)} of USDC into ${name}'s managed liquidity vault on ${chain}; the manager rebalances the range, which is the service being farmed.`, cost: capCost, time: '10 minutes' },
        { text: `Note the manager's fee and the vault's realised fee income on day one; a managed vault that earns less than its fee over the hold is one to exit, not to top up.`, cost: 'no transaction, just the note', time: '10 minutes' },
      ];
    case 'rwa':
      return [
        { text: `Check eligibility first: most of ${name}'s products ask for KYC, and some for accredited-investor status. If you qualify, subscribe ${money(cap)} to its main yield product on ${chain}; if you do not, the honest farm is the waitlist plus this plan's free steps — there is no low-cost on-chain route around a gate.`, cost: 'no fee to check; the subscription itself is the capital step', time: '20 minutes, plus KYC time if required' },
        { text: `Hold the issued asset to the end of the hold; RWA positions usually redeem on the issuer's schedule, not instantly, so treat the capital as committed for the full hold.`, cost: 'nothing during the hold', time: 'no action' },
      ];
    case 'chain':
      return [
        { text: `Fund a wallet on ${chain} itself with ${money(cap)} of USDC — bridged in or withdrawn directly — plus ${asset} for gas: farming a pre-token chain means being a real user of it.`, cost: capCost, time: '15 minutes' },
        { text: `Use the chain's own core apps: swap on its main DEX, supply to its main lending market if it has one, and always keep a small ${asset} balance so you are never stuck without gas.`, cost: `about ${money(2 * gas)} of gas`, time: '15 minutes' },
      ];
    case 'btc':
      return [
        { text: `Deposit ${money(cap)} of BTC or wrapped BTC into ${name} to mint its BTC-backed asset; Bitcoin-side confirmations make this the slowest step in the plan, so start it first.`, cost: capCost, time: '1 to 3 hours, mostly waiting for confirmations' },
        { text: `Supply the minted asset in ${name}'s main market or pool on ${chain} — or hold it if no market exists yet — so the deposit counts as usage, not just custody.`, cost: gasCost, time: '10 minutes' },
      ];
    case 'stable':
      return [
        { text: `Mint or wrap ${money(cap)} of ${name}'s stable asset on ${chain}, depositing USDC or the asset it wraps, and keep the minted balance.`, cost: `${capCost}, plus about ${money(0.001 * cap)} of mint or swap fees`, time: '10 minutes' },
        { text: `Add the stable asset to its main stable-swap pool, or lend it in the protocol's own market: a stable asset that only sits in a wallet earns nothing and signals nothing.`, cost: gasCost, time: '10 minutes' },
      ];
    case 'indexes':
      return [
        { text: `Buy ${money(cap)} of ${name}'s index token through its app or its main pool on ${chain} and keep the token.`, cost: capCost, time: '10 minutes' },
        { text: `Do nothing clever with it: index products rebalance internally, so the farm is the holding itself, plus any governance or points registration the issuer runs.`, cost: 'nothing', time: 'no action' },
      ];
    case 'insurance':
      return [
        { text: `Supply ${money(cap)} of USDC to ${name}'s underwriting capital pool on ${chain}; supplied capital is what cover is written against.`, cost: capCost, time: '10 minutes' },
        { text: `Accept the lock honestly: underwriting capital is typically locked for about 90 days, and a large claim can pay out of it, so this position may outlast the hold — size it as capital you can leave.`, cost: 'nothing during the lock', time: 'no action' },
      ];
    case 'payments':
      return [
        { text: `Sign up for ${name} and complete its KYC with your own ID; a card or payments account cannot be farmed with a fresh anonymous wallet, and pretending otherwise wastes the application.`, cost: 'no fee to apply; a virtual card is free to about $5', time: '20 to 30 minutes' },
        { text: `Route ${money(cap)} of spending you would make anyway through the card or account during the hold; points here come from real spend, and manufacturing spend costs more than the points are worth.`, cost: 'only money you were spending anyway', time: 'spread over the hold' },
      ];
    case 'gov':
      return [
        { text: `Put ${money(cap)} into ${name}'s governance or incentive position on ${chain} — the stake, lock or vote-escrow its app offers — and keep the receipt.`, cost: capCost, time: '10 minutes' },
        { text: `Vote on every proposal that opens during the hold; votes are the activity this category rewards, and each one costs a signature, not a position change.`, cost: 'a signature per vote', time: '5 minutes a vote' },
      ];
    case 'prediction':
      return [
        { text: `Fund ${name} with ${money(cap)} of USDC on ${chain} and register on its points or rewards page if it runs one.`, cost: `${money(cap)} of capital, at risk in the positions below, plus ${gasCost}`, time: '10 minutes' },
        { text: `Place five small positions of ${money(10)} on its most liquid markets and close each before resolution where the market allows; treat every position as money that can go to zero, because it can.`, cost: `${money(50)} at risk across the five positions, by design`, time: '10 minutes a position' },
      ];
    case 'cedefi':
      return [
        { text: `Deposit ${money(cap)} of USDC into ${name}'s main earn product; know whose balance sheet holds it — CeDeFi yield is a company's promise, not a contract's.`, cost: capCost, time: '10 minutes' },
        { text: `Withdraw to your own wallet at the end of the hold rather than rolling into a new term automatically; counterparty risk is managed by limiting how long funds sit there.`, cost: 'nothing during the hold', time: 'no action' },
      ];
    case 'options':
      return [
        { text: `Deposit ${money(cap)} of USDC or ${asset} into ${name}'s main options vault on ${chain} before its weekly epoch starts.`, cost: capCost, time: '10 minutes' },
        { text: `Let the epochs roll: the vault sells the options and collects the premium itself, so your only job is not to interrupt it mid-epoch, when withdrawals are usually locked.`, cost: 'nothing during the hold', time: 'no action' },
      ];
    case 'privacy':
      return [
        { text: `Move ${money(cap)} of USDC or ${asset} through ${name} once — shield, hold briefly, unshield to a second wallet of yours — so the usage is real and complete.`, cost: capCost, time: '15 minutes' },
        { text: `Keep the transaction records: some exchanges ask questions about funds that have passed through privacy pools, and a clean paper trail is what separates a farm from a problem.`, cost: 'nothing but the records', time: '5 minutes' },
      ];
    default:
      return [
        { text: `Deposit ${money(cap)} of USDC into ${name} on ${chain} through its main app and keep the position open.`, cost: capCost, time: '10 minutes' },
        { text: `Use one more of ${name}'s core features during the first week; the second action is what separates a user from a drive-by deposit in most points systems.`, cost: gasCost, time: '10 minutes' },
      ];
  }
}

/** What to watch while the position sits, in the words of the protocol's kind of product. */
function monitorText(kind: FarmKind): string {
  switch (kind) {
    case 'lending':
    case 'cdp':
    case 'synth':
    case 'levfarm':
      return `Check the health factor twice a week and keep it comfortably above liquidation; a farmed position that gets liquidated loses the capital, not just the points.`;
    case 'dex':
    case 'farm':
    case 'liqmgr':
      return `Check weekly for impermanent loss: if one side of the pair has run away, the fee income rarely covers the drift at this size.`;
    case 'stable':
      return `Check the peg weekly; a stable asset sitting below $0.99 for days is an exit signal, not a discount.`;
    case 'yield':
    case 'yieldagg':
    case 'curator':
    case 'allocator':
    case 'basis':
      return `Check weekly that the vault's strategy and yield are roughly what they were at deposit; silent strategy changes are the main risk in this category.`;
    case 'lstaking':
    case 'staking':
    case 'restaking':
      return `Check the receipt's exchange rate monthly; it should only creep up, and a drop means slashing or an incident, not noise.`;
    case 'btc':
      return `Check monthly that the minted asset still trades at par with BTC; a persistent discount is the exit signal.`;
    case 'rwa':
    case 'insurance':
    case 'uncollat':
    case 'cedefi':
      return `Check monthly for issuer or pool notices; in this category the news page matters more than the price page.`;
    default:
      return `Check the position and the protocol's announcements weekly; silence from the team for a month is information too.`;
  }
}

/** The recurring-activity step, by kind: bridges bridge again, perps round-trip, the rest repeat a small qualifying action. */
function activityStep(plan: FarmPlan): FarmStep {
  const { kind, cadence, actions, actionCost, activityCost, capital } = plan;
  const times = `${actions} time${actions === 1 ? '' : 's'} over the hold`;
  if (kind === 'bridge') {
    return {
      text: `Bridge a smaller amount — about ${money(Math.round(capital / 2))} — on another route ${cadence}, ${times}; spaced round trips are the volume bridges count.`,
      cost: `about ${money(actionCost)} a trip in gas and fees, ${money(activityCost)} in all`,
      time: '10 minutes a trip',
    };
  }
  if (kind === 'perps') {
    return {
      text: `Open and close one ${money(40)}-notional position ${cadence}, ${times}, always flat by the end of the day.`,
      cost: `about ${money(actionCost)} a round trip in trading fees and gas, ${money(activityCost)} in all`,
      time: '10 minutes a round trip',
    };
  }
  const example =
    kind === 'lending' || kind === 'cdp' || kind === 'synth' || kind === 'uncollat'
      ? 'a small top-up, a borrow or a repay'
      : kind === 'lstaking' || kind === 'staking' || kind === 'restaking'
        ? 'a claim or a small top-up stake'
        : kind === 'gov'
          ? 'a vote, or a claim of any incentives due'
          : kind === 'payments'
            ? 'one payment or transfer through the account'
            : kind === 'prediction'
              ? 'one small market position, closed before resolution'
              : 'a claim, a compound or a small top-up';
  return {
    text: `Make one qualifying action ${cadence} — ${example} — ${times}.`,
    cost: `about ${money(actionCost)} a time in gas, ${money(activityCost)} in all`,
    time: '5 to 10 minutes a time',
  };
}

/**
 * A protocol's farm plan (radar-3): eight or nine steps, each an action with a cost and a time,
 * priced from the protocol's own record before a word is written — its category decides the actions,
 * its farm chain decides the gas, its TVL decides the capital, its age decides the hold, and its
 * seven-day move can add a risk step or a warning. The last step is the plan's own budget check: the
 * net cost (gas and fees, never the recoverable capital) per $1 deployed, held to $0.50 — or, where
 * no route fits under the ceiling, a plain statement of that fact and the size that would fit.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const plan = planFarm(p, age);
  const { kind, chain, home, gas, capital: cap, hold } = plan;
  const name = p.name;
  const homeEcon = CHAIN_ECON[home] ?? DEFAULT_ECON;
  const steps: FarmStep[] = [];

  let setup = `Create a fresh wallet for this farm, keep its seed phrase offline, and fund it on ${chain} with the capital and the ${plan.asset} for gas the steps below need.`;
  if (chain !== home) {
    setup = `Create a fresh wallet for this farm, keep its seed phrase offline, and fund it on ${chain} — the cheapest of ${name}'s ${p.chains.length} chains to transact on, at about ${money(gas)} a transaction against ${money(homeEcon.gas_usd)} on ${home}.`;
  }
  if (age !== null && age < 120) {
    setup += ` ${name} is only ${age} days old in the index, so keep to this plan's size until it has a longer record.`;
  }
  steps.push({ text: setup, cost: `about ${money(plan.funding)} in withdrawal and transfer fees`, time: '15 minutes' });

  steps.push(...coreSteps(plan, name));

  const chg = p.change_7d;
  if (chg !== null && chg <= -25) {
    steps.push({
      text: `Respect the trend: ${name}'s TVL fell ${pct(chg)} in the week before the snapshot. Add nothing beyond this plan during the hold, and bring the exit forward if TVL falls another quarter from here.`,
      cost: 'no transaction, just the discipline',
      time: '5 minutes to check, weekly',
    });
  }

  let points = `Open ${name}'s own site and follow only its link to any points, season or rewards page, and register this wallet there. If it runs no program, this step costs nothing and the position itself is the record — never trust a points page linked from anywhere else.`;
  if (chg !== null && chg >= 50) {
    points += ` TVL is up ${pct(chg)} in seven days, so expect company: hot protocols draw mercenary farmers, and this plan's size does not change for momentum.`;
  }
  steps.push({ text: points, cost: 'nothing, or one signature', time: '10 minutes' });

  steps.push(activityStep(plan));

  let monitor = `Hold the position for the full ${hold} days so the activity lands in more than one weekly snapshot. ${monitorText(kind)}`;
  if (age !== null && age >= 900) {
    monitor += ` ${name} has also run ${(age / 365).toFixed(1)} years with no token — longer than most launches take — so if nothing is announced by the end of this hold, unwind instead of rolling.`;
  }
  steps.push({ text: monitor, cost: 'no transactions, just the checking', time: `${hold} days, a few minutes a check` });

  const unbond =
    kind === 'lstaking' || kind === 'staking' || kind === 'restaking'
      ? ' (staking exits can queue for days, so start the exit that early)'
      : kind === 'rwa' || kind === 'insurance'
        ? ' (redemptions follow the issuer\u2019s schedule, not yours)'
        : '';
  steps.push({
    text: `Unwind in reverse order: withdraw or unstake${unbond}, swap back to USDC, and claim any points or token only from the link in ${name}'s official announcement — never pay a third party to claim for you. Write the wallet, the dates and every transaction hash in a farm log as you go.`,
    cost: `about ${money(plan.exitCost)} in gas and fees`,
    time: '15 minutes, plus any unbonding queue',
  });

  const perDollar = plan.ratio < 0.01 ? 'under $0.01' : money(plan.ratio);
  if (plan.ratio <= 0.5) {
    steps.push({
      text: `Budget check: funding ${money(plan.funding)}, setup ${money(plan.setupCost)}, activity ${money(plan.activityCost)} and exit ${money(plan.exitCost)} total about ${money(plan.net)} of net cost on ${money(cap)} deployed — ${perDollar} per $1, under the $0.50 ceiling. The capital itself comes back on exit unless the protocol fails; the net figure is gas and fees only.`,
      cost: 'no further spend',
      time: '2 minutes to verify',
    });
  } else {
    const needed = Math.ceil(plan.net / 0.5 / 5) * 5;
    steps.push({
      text: `Budget check, honestly: even this leanest route nets about ${money(plan.net)} on ${money(cap)} deployed — ${perDollar} per $1, over the $0.50 ceiling — because ${chain} transaction costs dominate at this size. Either deploy at least ${money(needed)} to bring the same route under the ceiling, or run only the free steps above (wallet, registration, monitoring) until ${name} supports a cheaper chain.`,
      cost: 'no further spend',
      time: '2 minutes to verify',
    });
  }
  return steps;
}

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

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow, watchlist: ReadonlySet<string>): RadarRow {
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
    base_multiple: row.model.base_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    watchlist: watchlist.has(row.slug),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  // The dashboard states the model's constants: the base multiple it names is the fitted headline
  // multiple (at the comps' median TVL); each row carries its own effective multiple in data.js.
  const fitted = fitBaseModel(snapshot.protocols, snapshot.as_of, model);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: { ...model, base_multiple: headlineMultiple(fitted) },
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, new Set(snapshot.watchlist))),
    live,
  };
  return { board, radar };
}

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
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
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
