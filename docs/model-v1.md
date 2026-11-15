# Model v1 — radar-2: fitted base multiple (15 Nov 2026)

## What changed

The starter (radar-1) scored every protocol with one fixed house multiple:
`implied = TVL x 0.25 x growth factor x maturity factor`. (Note: the build brief described the
starter as a rough per-category median multiple; the shipped starter code was actually the flat
0.25 formula above. The baseline numbers below are measured against the real starter code.)

radar-2 keeps the same three-factor shape — so the dashboard's stated formula and its per-row
recompute stay exact (verified: 0/200 rows mismatch) — but the base multiple is now **fitted from
the snapshot's own tokenised protocols**, per row:

```
base_multiple(row) = exp(intercept + adj_category) x TVL^(slope - 1)
implied            = round(TVL x base_multiple(row) x growthMult x maturityMult)
```

## Method

- **Comps**: protocols with `mcap_usd > 0` and `tvl_usd > 0`, category `CEX` excluded from the fit
  (exchange "TVL" is not protocol TVL). 144 protocols carry a market cap; 16 record mcap = 0 and are
  unusable in log space; the production fit uses **119 comps** across 33 categories.
- **Regression**: OLS of `log(mcap / (growthMult x maturityMult))` on `log(TVL)` — i.e. the base is
  recalibrated *around* the house growth/maturity factors instead of double-counting them.
  Residuals winsorised at the 5th/95th percentile, then refit.
- **Category intercepts**: each category's mean (winsorised) residual, shrunk toward the global fit
  by `n / (n + 6)`. Thin categories (most have 1–5 comps) borrow the global fit; a category with no
  comps gets no adjustment.
- **Production fit** (all 119 comps): intercept 7.3287, slope (TVL elasticity) 0.5087, headline
  multiple 0.3386 at the comps' median TVL of $27.3M. The slope well below 1 is the snapshot's real
  pattern: market cap grows sub-linearly with TVL, so mega-TVL protocols carry far lower multiples
  than the flat 0.25 assumed (Steakhouse Financial: effective multiple 0.036).

## Tested and rejected

Fitted corrections of their own for the two house factors did **not** survive validation:

- A fitted 7d-growth coefficient came out at about −4.0 per unit of growth (an absurd ×0.018 at
  +120% growth — a few fit rows driving it) and *raised* holdout median error at every shrinkage
  level (0.25 / 0.5 / 1.0).
- Fitted age terms (linear age fraction and log-age) likewise never beat the base-only model on the
  pooled folds.
- Keeping the house growth/maturity factors with the base recalibrated around them beat dropping
  them to neutral: 29 of 40 seeded random 80/20 splits head-to-head (mean of split medians 0.5372
  vs 0.5542). So the factors stay as house priors; the base absorbs their average effect.

## Holdout validation (shipped code, `node tools/validate.ts`)

Tokenised protocols with known value: 128. Deterministic split — sorted by slug, every 5th row is
holdout (fit 103 / holdout 25); the fitted model is trained on the fit set only.

| model | median \|log10 err\| | mean \|log10 err\| | within 2× |
|---|---|---|---|
| starter radar-1 | 0.6460 | 0.6751 | 32% |
| fitted radar-2 | **0.4992** | **0.5579** | **36%** |

Pooled 5-fold (every protocol held out once): starter **0.7086** → fitted **0.5341**.
Median miss improves from ~4.4× to ~3.2× on the primary split (~5.1× to ~3.4× pooled).

## Top-10 change (implied value)

| # | radar-2 | value | radar-1 was |
|---|---|---|---|
| 1 | Steakhouse Financial | $98,851,596 | #1 ($543,636,080) |
| 2 | Gauntlet | $77,408,630 | #2 ($323,776,463) |
| 3 | Veda | $41,204,331 | #3 ($311,287,338) |
| 4 | USDD | $32,303,235 | #4 ($214,232,685) |
| 5 | Nonce Capital | $31,251,042 | #6 |
| 6 | Hive Protocol | $29,662,590 | #13 |
| 7 | OnRe | $29,108,815 | #7 |
| 8 | OpenTrade | $28,088,149 | #10 |
| 9 | Hyperithm | $27,133,381 | #14 |
| 10 | RockawayX | $27,064,738 | #11 |

Upshift falls #5 → #12, Symbiotic #9 → #14, Bittensor dTAO #8 → #15. Values compress across the
top: the fitted elasticity stops TVL size alone from dominating the ranking.

## Board rules after the run

`node main.ts --input input/snapshot.json` (≈0.4 s, offline, deterministic): 200 rows,
watchlist 40/40 covered, ranks 1..200 contiguous, `implied_value_usd` non-increasing — all pass
(the program's own `boardIssue` gate also passes, and dossier.json is written).

## Limitations

- 119 comps is a thin training set, and most categories contribute 1–5 of them; shrinkage keeps
  category effects modest, but they are still estimates, not measurements.
- The model predicts the *typical market cap for a given TVL and category* in this snapshot. A
  launch valuation also depends on float, unlocks and narrative — none of which the snapshot
  carries — so implied values are ranking signals, not price predictions.
- The snapshot is a single day (14 Nov 2026); the fit inherits that day's market regime.
- 38 of 144 tokenised protocols (and some board rows) have no `listed_at`; their age uses the
  365-day default, in the fit as in scoring.
- The growth/maturity factors remain unfitted house priors (see "Tested and rejected"): they are
  the model's stated prior, and the fitted base is calibrated around them.

## Reproduce

```
node tools/validate.ts                          # holdout numbers above
node main.ts --input input/snapshot.json        # writes /output (or $MAKEFUN_OUTPUT_DIR)
```
