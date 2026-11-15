# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/bennyevm-ops/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/bennyevm-ops/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads one sealed DeFiLlama snapshot of the protocol universe and ranks every pre-token protocol in it by the value its token would plausibly launch at — then gives each one a concrete, priced farm plan. The 40-protocol watchlist (every pre-token protocol at or above the snapshot's $50M TVL floor) is covered in full, and the board reaches below the floor for early rows: 200 protocols ranked in all, each with its implied launch value, the model factors behind it, and a farm plan whose net cost stays at or under $0.50 per $1 farmed.

The valuation model is fitted, not fixed. From the snapshot's own tokenised protocols (the comps), it fits a winsorised log-log regression of market cap on TVL — TVL elasticity ≈ 0.51 — with a per-category intercept shrunk toward the global fit by sample size, recalibrated around growth (7-day TVL change, clamped) and maturity (age without a token) factors. Fitted growth and age coefficients of their own were tested on a blind holdout and rejected; the fitted base is what beat the starter: holdout median |log10 error| 0.499 against the starter baseline's 0.646. No protocol name is ever special-cased — one function scores every row, and a category with no comps falls back to the global fit. The method, the fit and the holdout numbers are written up in `docs/model-v1.md`.

Farm plans are generated per protocol from its own record — category, chains, TVL, age — never from a hand-written list of names: a lending market gets a supply-and-hold plan, a DEX a liquidity plan, a bridge a bridge-and-use plan, each step carrying its action, its dollar cost (capital, chain-specific gas, weekly upkeep) and its time, checked against the $0.50-per-$1 net budget. Where a protocol has no plausible low-cost route, the plan says so instead of inventing one.

The dashboard is a static page — no framework, no network — that renders the same board: sortable and filterable (text, category, chain, watchlist-only), with a per-protocol detail drawer showing the model factors and the full farm plan.

## Run it

```sh
./main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=5fx3awqt&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

## Running it locally

The grader runs `./main.ts` with the sealed snapshot mounted at `/input` and writes to `/output`. Outside that container (Node.js 22.18 or later, nothing to install — standard library only):

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out ./main.ts --input input
```

`--input` takes the snapshot file or the directory holding it; this repository's `input/` carries the snapshot the board was built from. A run is deterministic and offline, and refuses a board that breaks the gate's rules (watchlist coverage, contiguous ranks, non-increasing implied value, farm-step shape) rather than writing it.

Outputs in the output directory:

- `board.json` — the ranked board: every row with its implied value, model factors and farm plan.
- `dossier.json` — the summary the judge reads, built with the vendored make.fun library.
- `data.js` + `dashboard/` — the static dashboard's data and page.
- `screenshots/` — the board, a protocol detail view, and a filtered view.

## Repository layout

- `main.ts` — the entrypoint: snapshot in, board, dashboard data and dossier out.
- `lib/model.ts` — the fitted valuation model, the board builder and the farm-plan generator.
- `vendor/makefun-board.ts` — the vendored make.fun board/dossier library.
- `dashboard/` — the static dashboard (`index.html`, `app.css`, `app.js`).
- `screenshots/` — the three dashboard views.
- `input/` — the sealed DeFiLlama snapshot this entry is scored on.
- `docs/` — `model-v1.md` (the fit and its holdout validation), `radar-3.md` (the farm-plan and dashboard build), `snapshot-analysis.md` (the snapshot's structure).
- `tools/validate.ts` — the board-rule validator used while building.

## License

MIT — see `LICENSE`.
