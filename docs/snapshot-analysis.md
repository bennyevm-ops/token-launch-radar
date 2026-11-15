# Snapshot analysis (15 Nov 2026)
- File: input/snapshot.json — DeFiLlama, as_of 2026-11-14, fetched 2026-11-14T01:18Z.
- 758 protocols. Fields per protocol: slug, name, category, chains[], tvl_usd, change_7d, mcap_usd (null = pre-token), listed_at, gecko_id, symbol.
- watchlist: 40 slugs (floor TVL $50jt), all present in protocols.
- Comps set for the value model = protocols with mcap_usd != null (the already-tokenised ones): fit mcap/TVL multiples per category, adjust for change_7d and age (listed_at), apply to pre-token protocols to get implied launch value. Exact counts + distribution to be computed in the model step.
- Board rules to honour: >=100 rows, watchlist 40/40, ranks contiguous, implied_value_usd non-increasing, farm_steps 3-12 strings of 20-600 chars, net farm cost <= $0.50 per $1.
