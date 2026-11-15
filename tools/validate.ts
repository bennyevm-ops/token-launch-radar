// Holdout validation for the radar-2 value model, run against the shipped code in lib/model.ts.
//
//   node tools/validate.ts [path/to/snapshot.json]
//
// Method: the snapshot's tokenised protocols with a real market cap (mcap > 0, TVL > 0) are the only
// rows whose true value is known. Sorted by slug, every fifth one (index % 5 == 4) is the holdout;
// the rest are the fit set. The fitted base is trained on the fit set ONLY (fitBaseModel, the same
// function production runs) and predicts the holdout's market caps; the radar-1 starter formula
// predicts them too, from the same rows. Headline metric: median absolute log10 error (0.3 = a
// typical 2x miss, 0.5 = ~3.2x). A pooled 5-fold pass follows for stability. Deterministic, offline.

import { readFileSync } from 'node:fs';
import { MODEL, fitBaseModel, growthMaturity, headlineMultiple, parseSnapshot, scoreProtocol } from '../lib/model.ts';
import type { Snapshot, SnapshotProtocol } from '../lib/model.ts';

const file = process.argv[2] ?? new URL('../input/snapshot.json', import.meta.url).pathname;
const snapshot: Snapshot = parseSnapshot(readFileSync(file, 'utf8'));

/** The radar-1 starter formula, kept here as the baseline the fitted model has to beat. */
function starterPredict(p: SnapshotProtocol): number {
  const { growthMult, maturityMult } = growthMaturity(p, snapshot.as_of, MODEL);
  return Math.max(1, Math.round(p.tvl_usd * 0.25 * growthMult * maturityMult));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

interface Score {
  medianAbsLog10: number;
  meanAbsLog10: number;
  within2x: number;
}

function score(predict: (p: SnapshotProtocol) => number, rows: SnapshotProtocol[]): Score {
  const errs = rows.map((p) => Math.abs(Math.log10(predict(p) / p.mcap_usd!)));
  const within = rows.filter((p) => {
    const ratio = predict(p) / p.mcap_usd!;
    return ratio >= 0.5 && ratio <= 2;
  }).length;
  return {
    medianAbsLog10: median(errs),
    meanAbsLog10: errs.reduce((s, v) => s + v, 0) / errs.length,
    within2x: within / rows.length,
  };
}

const known = snapshot.protocols
  .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
  .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));

function runSplit(holdoutIdx: (i: number) => boolean): { fit: SnapshotProtocol[]; hold: SnapshotProtocol[] } {
  const fit: SnapshotProtocol[] = [];
  const hold: SnapshotProtocol[] = [];
  known.forEach((p, i) => (holdoutIdx(i) ? hold : fit).push(p));
  return { fit, hold };
}

function fittedPredictor(fit: SnapshotProtocol[]): (p: SnapshotProtocol) => number {
  const fitted = fitBaseModel(fit, snapshot.as_of, MODEL);
  return (p) => scoreProtocol(p, snapshot.as_of, MODEL, fitted).implied;
}

const fmt = (s: Score): string =>
  `median |log10 err| ${s.medianAbsLog10.toFixed(4)} | mean ${s.meanAbsLog10.toFixed(4)} | within 2x ${(s.within2x * 100).toFixed(0)}%`;

const primary = runSplit((i) => i % 5 === 4);
console.log(`comps with known value: ${known.length} | fit set ${primary.fit.length} | holdout ${primary.hold.length}`);
console.log(`primary split (every 5th by slug):`);
console.log(`  starter radar-1 : ${fmt(score(starterPredict, primary.hold))}`);
console.log(`  fitted  radar-2 : ${fmt(score(fittedPredictor(primary.fit), primary.hold))}`);

const pooled: { starter: number[]; fitted: number[] } = { starter: [], fitted: [] };
for (let fold = 0; fold < 5; fold++) {
  const { fit, hold } = runSplit((i) => i % 5 === fold);
  const fp = fittedPredictor(fit);
  for (const p of hold) {
    pooled.starter.push(Math.abs(Math.log10(starterPredict(p) / p.mcap_usd!)));
    pooled.fitted.push(Math.abs(Math.log10(fp(p) / p.mcap_usd!)));
  }
}
console.log(`pooled 5-fold (every protocol held out once):`);
console.log(`  starter radar-1 : median |log10 err| ${median(pooled.starter).toFixed(4)}`);
console.log(`  fitted  radar-2 : median |log10 err| ${median(pooled.fitted).toFixed(4)}`);

const production = fitBaseModel(snapshot.protocols, snapshot.as_of, MODEL);
console.log(
  `production fit (all comps): n=${production.comps_used} intercept=${production.intercept.toFixed(4)} slope=${production.slope.toFixed(4)} ` +
    `headline multiple at median TVL ($${Math.round(production.median_tvl_usd).toLocaleString('en-US')}) = ${headlineMultiple(production).toFixed(4)} | categories adjusted: ${production.category_adjustments.size}`,
);
