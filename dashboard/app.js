// Token Radar's dashboard (radar-3). It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a sortable table with search and category/chain filters, and a
// per-protocol detail drawer with the model's own inputs and the protocol's farm plan. No network:
// every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  // The base multiple is the row's own: radar-2 fits it per row from the snapshot's tokenised protocols.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var baseMultiple = row.base_multiple === null || row.base_multiple === undefined ? model.base_multiple : row.base_multiple;
    return Math.max(1, Math.round(row.tvl_usd * baseMultiple * growthMult * maturity));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json (lib/model.ts, radar-3): the
  // plan is priced from the row's own record before a word is written — category decides the actions,
  // the farm chain decides the gas, TVL decides the capital, age decides the hold, the seven-day move
  // can add a risk step — and its last step is its own budget check against the $0.50-per-$1 ceiling.
  // No name is special-cased. (The block between the FARM-GENERATOR markers mirrors lib/model.ts and
  // is verified step-for-step against board.json by the entry's build checks.)
  // FARM-GENERATOR-BEGIN
  var CHAIN_ECON = {
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
    Metis: { gas_usd: 0.05, asset: 'METIS' }
  };
  var DEFAULT_ECON = { gas_usd: 0.12, asset: 'its native token' };
  function econOf(chain) { return CHAIN_ECON[chain] || DEFAULT_ECON; }
  function money(n) {
    var r = Math.round(n * 100) / 100;
    return '$' + r.toFixed(2).replace(/\.?0+$/, '');
  }
  function pct(n) { return (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 200;
    if (p.tvl_usd >= 2.5e8) return 150;
    if (p.tvl_usd >= 5e7) return 100;
    if (p.tvl_usd >= 1.5e7) return 75;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function farmKind(category) {
    var exact = {
      'Lending': 'lending', 'Uncollateralized Lending': 'uncollat', 'Collateral Markets': 'lending', 'Collateral Management': 'lending',
      'CDP': 'cdp', 'CDP Manager': 'cdp', 'Synthetics': 'synth', 'Dexs': 'dex', 'Yield': 'yield', 'Yield Aggregator': 'yieldagg',
      'Risk Curators': 'curator', 'Onchain Capital Allocator': 'allocator', 'Liquid Staking': 'lstaking', 'Staking Pool': 'staking',
      'Restaking': 'restaking', 'Liquid Restaking': 'restaking', 'Bridge': 'bridge', 'Canonical Bridge': 'bridge', 'Cross Chain Bridge': 'bridge',
      'Derivatives': 'perps', 'Basis Trading': 'basis', 'Leveraged Farming': 'levfarm', 'Farm': 'farm', 'Liquidity Manager': 'liqmgr',
      'RWA': 'rwa', 'Chain': 'chain', 'Anchor BTC': 'btc', 'Decentralized BTC': 'btc', 'Restaked BTC': 'btc',
      'Dual-Token Stablecoin': 'stable', 'Algo-Stables': 'stable', 'Stablecoin Wrapper': 'stable', 'Stablecoin Issuer': 'stable',
      'Indexes': 'indexes', 'Insurance': 'insurance', 'Payments': 'payments', 'Crypto Card Issuer': 'payments',
      'Governance Incentives': 'gov', 'Prediction Market': 'prediction', 'CeDeFi': 'cedefi', 'Options': 'options', 'Options Vault': 'options',
      'Privacy': 'privacy'
    };
    if (category !== null && category !== undefined && exact[category] !== undefined) return exact[category];
    var c = (category || '').toLowerCase();
    if (c.indexOf('uncollateral') >= 0) return 'uncollat';
    if (c.indexOf('lend') >= 0 || c.indexOf('collateral') >= 0) return 'lending';
    if (c.indexOf('cdp') >= 0) return 'cdp';
    if (c.indexOf('bridge') >= 0) return 'bridge';
    if (c.indexOf('restak') >= 0) return 'restaking';
    if (c.indexOf('liquid staking') >= 0) return 'lstaking';
    if (c.indexOf('staking') >= 0) return 'staking';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'perps';
    if (c.indexOf('curator') >= 0) return 'curator';
    if (c.indexOf('allocat') >= 0) return 'allocator';
    if (c.indexOf('stable') >= 0) return 'stable';
    if (c.indexOf('yield') >= 0) return 'yield';
    if (c.indexOf('dex') >= 0 || c.indexOf('swap') >= 0) return 'dex';
    if (c.indexOf('rwa') >= 0) return 'rwa';
    if (c.indexOf('insur') >= 0) return 'insurance';
    if (c.indexOf('predict') >= 0) return 'prediction';
    if (c.indexOf('option') >= 0) return 'options';
    if (c.indexOf('index') >= 0) return 'indexes';
    if (c.indexOf('pay') >= 0 || c.indexOf('card') >= 0) return 'payments';
    if (c.indexOf('btc') >= 0) return 'btc';
    if (c.indexOf('farm') >= 0) return 'farm';
    return 'generic';
  }
  function planFarm(p, age) {
    var kind = farmKind(p.category);
    var home = p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain';
    var chain = home;
    var gas = econOf(home).gas_usd;
    var asset = econOf(home).asset;
    if (gas >= 0.5) {
      (p.chains || []).forEach(function (c) {
        var econ = econOf(c);
        if (econ.gas_usd * 3 <= gas && econ.gas_usd < gas) {
          chain = c;
          gas = econ.gas_usd;
          asset = econ.asset;
        }
      });
    }
    var capital = capitalFor(p);
    var hold = holdDaysFor(age);
    var funding = chain === 'Bitcoin' ? 5 : Math.max(2.5 * gas, 0.3);
    var setupTxs = kind === 'dex' || kind === 'cdp' || kind === 'synth' || kind === 'levfarm' || kind === 'farm' ? 3 : kind === 'perps' ? 1 : 2;
    var entryFee = kind === 'dex' || kind === 'farm' ? 0.0015 * capital : kind === 'stable' || kind === 'bridge' ? 0.001 * capital : 0;
    var setupCost = setupTxs * gas + entryFee;
    var per = gas <= 0.3 ? 7 : gas <= 1.2 ? 14 : 30;
    var cadence = per === 7 ? 'once a week' : per === 14 ? 'once every two weeks' : 'once a month';
    var actionCost = kind === 'bridge' ? 2 * gas + 0.001 * capital : kind === 'perps' ? 2 * gas + 0.04 : gas;
    var exitFee = kind === 'dex' || kind === 'farm' ? 0.001 * capital : kind === 'stable' ? 0.0005 * capital : 0;
    var exitCost = 2 * gas + exitFee;
    var actions = Math.max(1, Math.floor(hold / per));
    var activityCost = actions * actionCost;
    var net = funding + setupCost + activityCost + exitCost;
    while (net / capital > 0.48 && actions > 1) {
      actions -= 1;
      activityCost = actions * actionCost;
      net = funding + setupCost + activityCost + exitCost;
    }
    return { kind: kind, chain: chain, home: home, gas: gas, asset: asset, capital: capital, hold: hold, funding: funding, setupCost: setupCost, actions: actions, cadence: cadence, actionCost: actionCost, activityCost: activityCost, exitCost: exitCost, net: net, ratio: net / capital };
  }
  function coreSteps(plan, name) {
    var kind = plan.kind, chain = plan.chain, asset = plan.asset, cap = plan.capital, gas = plan.gas;
    var gasCost = 'about ' + money(gas) + ' of gas';
    var capCost = money(cap) + ' of capital, back on exit, plus ' + gasCost;
    switch (kind) {
      case 'lending':
        return [
          { text: `Supply ${money(cap)} of USDC to ${name} on ${chain} as collateral and leave it supplied; this deposit is the position everything else builds on.`, cost: capCost, time: '10 minutes' },
          { text: `Borrow ${money(Math.round(cap * 0.4))} of USDC against the deposit — about 40% of it, keeping the health factor above 2 — and repay it after a week: one clean borrow-and-repay cycle is the activity lending points programs count.`, cost: `about ${money(2 * gas)} of gas for the borrow and the repay, plus a few cents of borrow interest`, time: '10 minutes, twice' }
        ];
      case 'uncollat':
        return [
          { text: `Read ${name}'s pool list first and supply ${money(cap)} of USDC to its longest-running pool on ${chain} — in uncollateralised lending the pool's track record is the only collateral there is.`, cost: capCost, time: '25 minutes, reading included' },
          { text: `Check the pool's borrowers and past defaults before the money moves: if borrowers are unnamed or defaults unexplained, do not supply at all — run this plan's free steps instead and keep the capital.`, cost: 'no transaction, just the reading', time: '15 minutes of reading' }
        ];
      case 'cdp':
        return [
          { text: `Open a vault on ${name} (${chain}) and deposit ${money(cap)} of ${asset} or its liquid-staking version as collateral.`, cost: capCost, time: '15 minutes' },
          { text: `Mint the protocol's stablecoin against about 35% of the collateral's value — roughly ${money(Math.round(cap * 0.35))} — and hold it or swap half back to USDC; keep the collateral ratio above 200% so a bad week cannot liquidate the vault.`, cost: `about ${money(2 * gas)} of gas`, time: '10 minutes' }
        ];
      case 'synth':
        return [
          { text: `Deposit ${money(cap)} of USDC or ${asset} as collateral on ${name} (${chain}) and open a minting position.`, cost: capCost, time: '15 minutes' },
          { text: `Mint synthetic dollars against about 35% of the collateral — roughly ${money(Math.round(cap * 0.35))} — and hold them or park them in the protocol's own pool; keep the collateral ratio above 200% so a bad week cannot liquidate the position.`, cost: `about ${money(2 * gas)} of gas`, time: '10 minutes' }
        ];
      case 'dex':
        return [
          { text: `Swap half of the capital — ${money(Math.round(cap / 2))} of USDC — into the pair asset of ${name}'s main pool on ${chain}, then add both sides as liquidity in that pool.`, cost: `${capCost}, plus about ${money(0.0015 * cap)} of swap fees`, time: '15 minutes' },
          { text: `Stake the LP receipt in ${name}'s farm or gauge if it offers one; if it does not, the pool position alone is the record.`, cost: gasCost, time: '5 minutes' }
        ];
      case 'yield':
        return [
          { text: `Deposit ${money(cap)} of USDC into ${name}'s main vault on ${chain}; the vault, not a manual strategy, does the routing from here.`, cost: capCost, time: '10 minutes' },
          { text: `Turn on auto-compounding if the vault offers it; if rewards pay out in a separate token, claim and re-deposit them at the mid-hold check instead of letting them sit idle.`, cost: 'no transaction until the mid-hold claim', time: '5 minutes' }
        ];
      case 'yieldagg':
        return [
          { text: `Deposit ${money(cap)} of USDC into ${name}'s main aggregator vault on ${chain} and keep the shares.`, cost: capCost, time: '10 minutes' },
          { text: `Write down which underlying farms the aggregator holds on the day you deposit; if it later rotates into something you would not hold directly, that rotation is the exit signal.`, cost: 'no transaction, just the note', time: '10 minutes' }
        ];
      case 'curator':
        return [
          { text: `Deposit ${money(cap)} of USDC into the largest USDC vault curated through ${name} on ${chain} and keep the vault shares.`, cost: capCost, time: '10 minutes' },
          { text: `Read the vault's market list once before the hold starts: know which lending markets your USDC actually sits in, because the curator, not you, picks them — and can move them.`, cost: 'no transaction, just the reading', time: '15 minutes of reading' }
        ];
      case 'allocator':
        return [
          { text: `Deposit ${money(cap)} of USDC into an allocator vault on ${name} (${chain}) and keep the shares; one vault, one strategy, no splitting at this size.`, cost: capCost, time: '10 minutes' },
          { text: `Note which strategies the allocator is running and their weights on day one; allocators earn by moving capital, so a strategy list that changes over the hold is normal, not a warning.`, cost: 'no transaction, just the note', time: '10 minutes' }
        ];
      case 'lstaking':
        return [
          { text: `Stake ${money(cap)} of ${asset} through ${name} on ${chain} and keep the liquid staking token it returns.`, cost: capCost, time: '10 minutes' },
          { text: `Put the receipt token to work in one place that accepts it — supplied as collateral in a major lending market, or in its main liquidity pool; if neither exists on ${chain}, simply holding the receipt is a complete position.`, cost: gasCost, time: '10 minutes' }
        ];
      case 'staking':
        return [
          { text: `Delegate ${money(cap)} of ${asset} through ${name}'s pool on ${chain}, to the pool's default or largest validator rather than the highest advertised rate.`, cost: capCost, time: '10 minutes' },
          { text: `Leave the stake untouched for the hold: rewards compound inside the receipt, and moving validators mid-hold usually resets the reward clock.`, cost: 'nothing', time: 'no action' }
        ];
      case 'restaking':
        return [
          { text: `Deposit ${money(cap)} of a liquid staking token — or ${asset}, which ${name} converts — into ${name} on ${chain} and keep the restaking receipt.`, cost: capCost, time: '10 minutes' },
          { text: `Choose the default operator set if ${name} asks: restaking adds slashing exposure on top of ordinary staking, so the conservative operator choice is the plan, not a missed optimisation.`, cost: 'nothing', time: '5 minutes' }
        ];
      case 'bridge':
        return [
          { text: `Bridge ${money(cap)} of USDC through ${name} to ${chain} and keep the bridged funds in the destination wallet; bridges count completed routes, so finish the trip in one sitting.`, cost: `${capCost}, plus about ${money(0.001 * cap)} of bridge fee`, time: '15 minutes, plus the wait for the transfer itself' },
          { text: `Use the bridged USDC once on the destination chain — one swap or one small lending deposit — so the trip is real usage, not a bare transfer.`, cost: gasCost, time: '10 minutes' }
        ];
      case 'perps':
        return [
          { text: `Deposit ${money(cap)} of USDC as margin on ${name} (${chain}) and set leverage to 2x or lower; this is a volume farm, not a directional bet.`, cost: capCost, time: '10 minutes' },
          { text: `Trade small and flat: open a ${money(40)}-notional position and close it the same day, never leaving leverage on overnight. The target over the hold is about ${money(plan.actions * 80)} of total volume, built from the round trips below.`, cost: 'the trading fees ride on the activity step', time: '10 minutes a round trip' }
        ];
      case 'basis':
        return [
          { text: `Deposit ${money(cap)} of USDC into ${name}'s delta-neutral basis vault on ${chain}; the vault holds the hedge, you hold the shares.`, cost: capCost, time: '10 minutes' },
          { text: `Check the funding regime the vault lives on once at the start: basis yield is funding paid by leveraged longs, and it thins or flips when the market deleverages.`, cost: 'no transaction, just the reading', time: '10 minutes of reading' }
        ];
      case 'levfarm':
        return [
          { text: `Open a leveraged farm on ${name} with ${money(cap)} of equity at no more than 2x leverage, in its main stable pair on ${chain}.`, cost: `${capCost}, plus about ${money(0.0015 * cap)} of swap fees`, time: '20 minutes' },
          { text: `Keep the liquidation buffer wide: if the position's health falls into the warning zone the app marks, repay part of the borrow the same day rather than adding collateral in a panic.`, cost: 'a repay transaction if it comes to that, about ' + money(gas), time: '10 minutes, only if needed' }
        ];
      case 'farm':
        return [
          { text: `Provide ${money(cap)} of liquidity to ${name}'s main incentivised pool on ${chain} and stake the LP token in its farm.`, cost: `${capCost}, plus about ${money(0.0015 * cap)} of swap fees`, time: '15 minutes' },
          { text: `Harvest once at mid-hold and restake the rewards; harvesting more often than that spends more on gas than the rewards are worth at this size.`, cost: `about ${money(2 * gas)} of gas at mid-hold`, time: '10 minutes, once' }
        ];
      case 'liqmgr':
        return [
          { text: `Deposit ${money(cap)} of USDC into ${name}'s managed liquidity vault on ${chain}; the manager rebalances the range, which is the service being farmed.`, cost: capCost, time: '10 minutes' },
          { text: `Note the manager's fee and the vault's realised fee income on day one; a managed vault that earns less than its fee over the hold is one to exit, not to top up.`, cost: 'no transaction, just the note', time: '10 minutes' }
        ];
      case 'rwa':
        return [
          { text: `Check eligibility first: most of ${name}'s products ask for KYC, and some for accredited-investor status. If you qualify, subscribe ${money(cap)} to its main yield product on ${chain}; if you do not, the honest farm is the waitlist plus this plan's free steps — there is no low-cost on-chain route around a gate.`, cost: 'no fee to check; the subscription itself is the capital step', time: '20 minutes, plus KYC time if required' },
          { text: `Hold the issued asset to the end of the hold; RWA positions usually redeem on the issuer's schedule, not instantly, so treat the capital as committed for the full hold.`, cost: 'nothing during the hold', time: 'no action' }
        ];
      case 'chain':
        return [
          { text: `Fund a wallet on ${chain} itself with ${money(cap)} of USDC — bridged in or withdrawn directly — plus ${asset} for gas: farming a pre-token chain means being a real user of it.`, cost: capCost, time: '15 minutes' },
          { text: `Use the chain's own core apps: swap on its main DEX, supply to its main lending market if it has one, and always keep a small ${asset} balance so you are never stuck without gas.`, cost: `about ${money(2 * gas)} of gas`, time: '15 minutes' }
        ];
      case 'btc':
        return [
          { text: `Deposit ${money(cap)} of BTC or wrapped BTC into ${name} to mint its BTC-backed asset; Bitcoin-side confirmations make this the slowest step in the plan, so start it first.`, cost: capCost, time: '1 to 3 hours, mostly waiting for confirmations' },
          { text: `Supply the minted asset in ${name}'s main market or pool on ${chain} — or hold it if no market exists yet — so the deposit counts as usage, not just custody.`, cost: gasCost, time: '10 minutes' }
        ];
      case 'stable':
        return [
          { text: `Mint or wrap ${money(cap)} of ${name}'s stable asset on ${chain}, depositing USDC or the asset it wraps, and keep the minted balance.`, cost: `${capCost}, plus about ${money(0.001 * cap)} of mint or swap fees`, time: '10 minutes' },
          { text: `Add the stable asset to its main stable-swap pool, or lend it in the protocol's own market: a stable asset that only sits in a wallet earns nothing and signals nothing.`, cost: gasCost, time: '10 minutes' }
        ];
      case 'indexes':
        return [
          { text: `Buy ${money(cap)} of ${name}'s index token through its app or its main pool on ${chain} and keep the token.`, cost: capCost, time: '10 minutes' },
          { text: `Do nothing clever with it: index products rebalance internally, so the farm is the holding itself, plus any governance or points registration the issuer runs.`, cost: 'nothing', time: 'no action' }
        ];
      case 'insurance':
        return [
          { text: `Supply ${money(cap)} of USDC to ${name}'s underwriting capital pool on ${chain}; supplied capital is what cover is written against.`, cost: capCost, time: '10 minutes' },
          { text: `Accept the lock honestly: underwriting capital is typically locked for about 90 days, and a large claim can pay out of it, so this position may outlast the hold — size it as capital you can leave.`, cost: 'nothing during the lock', time: 'no action' }
        ];
      case 'payments':
        return [
          { text: `Sign up for ${name} and complete its KYC with your own ID; a card or payments account cannot be farmed with a fresh anonymous wallet, and pretending otherwise wastes the application.`, cost: 'no fee to apply; a virtual card is free to about $5', time: '20 to 30 minutes' },
          { text: `Route ${money(cap)} of spending you would make anyway through the card or account during the hold; points here come from real spend, and manufacturing spend costs more than the points are worth.`, cost: 'only money you were spending anyway', time: 'spread over the hold' }
        ];
      case 'gov':
        return [
          { text: `Put ${money(cap)} into ${name}'s governance or incentive position on ${chain} — the stake, lock or vote-escrow its app offers — and keep the receipt.`, cost: capCost, time: '10 minutes' },
          { text: `Vote on every proposal that opens during the hold; votes are the activity this category rewards, and each one costs a signature, not a position change.`, cost: 'a signature per vote', time: '5 minutes a vote' }
        ];
      case 'prediction':
        return [
          { text: `Fund ${name} with ${money(cap)} of USDC on ${chain} and register on its points or rewards page if it runs one.`, cost: `${money(cap)} of capital, at risk in the positions below, plus ${gasCost}`, time: '10 minutes' },
          { text: `Place five small positions of ${money(10)} on its most liquid markets and close each before resolution where the market allows; treat every position as money that can go to zero, because it can.`, cost: `${money(50)} at risk across the five positions, by design`, time: '10 minutes a position' }
        ];
      case 'cedefi':
        return [
          { text: `Deposit ${money(cap)} of USDC into ${name}'s main earn product; know whose balance sheet holds it — CeDeFi yield is a company's promise, not a contract's.`, cost: capCost, time: '10 minutes' },
          { text: `Withdraw to your own wallet at the end of the hold rather than rolling into a new term automatically; counterparty risk is managed by limiting how long funds sit there.`, cost: 'nothing during the hold', time: 'no action' }
        ];
      case 'options':
        return [
          { text: `Deposit ${money(cap)} of USDC or ${asset} into ${name}'s main options vault on ${chain} before its weekly epoch starts.`, cost: capCost, time: '10 minutes' },
          { text: `Let the epochs roll: the vault sells the options and collects the premium itself, so your only job is not to interrupt it mid-epoch, when withdrawals are usually locked.`, cost: 'nothing during the hold', time: 'no action' }
        ];
      case 'privacy':
        return [
          { text: `Move ${money(cap)} of USDC or ${asset} through ${name} once — shield, hold briefly, unshield to a second wallet of yours — so the usage is real and complete.`, cost: capCost, time: '15 minutes' },
          { text: `Keep the transaction records: some exchanges ask questions about funds that have passed through privacy pools, and a clean paper trail is what separates a farm from a problem.`, cost: 'nothing but the records', time: '5 minutes' }
        ];
      default:
        return [
          { text: `Deposit ${money(cap)} of USDC into ${name} on ${chain} through its main app and keep the position open.`, cost: capCost, time: '10 minutes' },
          { text: `Use one more of ${name}'s core features during the first week; the second action is what separates a user from a drive-by deposit in most points systems.`, cost: gasCost, time: '10 minutes' }
        ];
    }
  }
  function monitorText(kind) {
    switch (kind) {
      case 'lending': case 'cdp': case 'synth': case 'levfarm':
        return `Check the health factor twice a week and keep it comfortably above liquidation; a farmed position that gets liquidated loses the capital, not just the points.`;
      case 'dex': case 'farm': case 'liqmgr':
        return `Check weekly for impermanent loss: if one side of the pair has run away, the fee income rarely covers the drift at this size.`;
      case 'stable':
        return `Check the peg weekly; a stable asset sitting below $0.99 for days is an exit signal, not a discount.`;
      case 'yield': case 'yieldagg': case 'curator': case 'allocator': case 'basis':
        return `Check weekly that the vault's strategy and yield are roughly what they were at deposit; silent strategy changes are the main risk in this category.`;
      case 'lstaking': case 'staking': case 'restaking':
        return `Check the receipt's exchange rate monthly; it should only creep up, and a drop means slashing or an incident, not noise.`;
      case 'btc':
        return `Check monthly that the minted asset still trades at par with BTC; a persistent discount is the exit signal.`;
      case 'rwa': case 'insurance': case 'uncollat': case 'cedefi':
        return `Check monthly for issuer or pool notices; in this category the news page matters more than the price page.`;
      default:
        return `Check the position and the protocol's announcements weekly; silence from the team for a month is information too.`;
    }
  }
  function activityStep(plan) {
    var kind = plan.kind, cadence = plan.cadence, actions = plan.actions, actionCost = plan.actionCost, activityCost = plan.activityCost, capital = plan.capital;
    var times = actions + ' time' + (actions === 1 ? '' : 's') + ' over the hold';
    if (kind === 'bridge') {
      return {
        text: `Bridge a smaller amount — about ${money(Math.round(capital / 2))} — on another route ${cadence}, ${times}; spaced round trips are the volume bridges count.`,
        cost: `about ${money(actionCost)} a trip in gas and fees, ${money(activityCost)} in all`,
        time: '10 minutes a trip'
      };
    }
    if (kind === 'perps') {
      return {
        text: `Open and close one ${money(40)}-notional position ${cadence}, ${times}, always flat by the end of the day.`,
        cost: `about ${money(actionCost)} a round trip in trading fees and gas, ${money(activityCost)} in all`,
        time: '10 minutes a round trip'
      };
    }
    var example =
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
      time: '5 to 10 minutes a time'
    };
  }
  function stepText(step) {
    var s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var age = p.age_days === undefined ? null : p.age_days;
    var plan = planFarm(p, age);
    var kind = plan.kind, chain = plan.chain, home = plan.home, gas = plan.gas, cap = plan.capital, hold = plan.hold;
    var name = p.name;
    var homeEcon = econOf(home);
    var steps = [];
    var setup = `Create a fresh wallet for this farm, keep its seed phrase offline, and fund it on ${chain} with the capital and the ${plan.asset} for gas the steps below need.`;
    if (chain !== home) {
      setup = `Create a fresh wallet for this farm, keep its seed phrase offline, and fund it on ${chain} — the cheapest of ${name}'s ${p.chains.length} chains to transact on, at about ${money(gas)} a transaction against ${money(homeEcon.gas_usd)} on ${home}.`;
    }
    if (age !== null && age < 120) {
      setup += ` ${name} is only ${age} days old in the index, so keep to this plan's size until it has a longer record.`;
    }
    steps.push({ text: setup, cost: `about ${money(plan.funding)} in withdrawal and transfer fees`, time: '15 minutes' });
    coreSteps(plan, name).forEach(function (s) { steps.push(s); });
    var chg = p.change_7d === undefined ? null : p.change_7d;
    if (chg !== null && chg <= -25) {
      steps.push({
        text: `Respect the trend: ${name}'s TVL fell ${pct(chg)} in the week before the snapshot. Add nothing beyond this plan during the hold, and bring the exit forward if TVL falls another quarter from here.`,
        cost: 'no transaction, just the discipline',
        time: '5 minutes to check, weekly'
      });
    }
    var points = `Open ${name}'s own site and follow only its link to any points, season or rewards page, and register this wallet there. If it runs no program, this step costs nothing and the position itself is the record — never trust a points page linked from anywhere else.`;
    if (chg !== null && chg >= 50) {
      points += ` TVL is up ${pct(chg)} in seven days, so expect company: hot protocols draw mercenary farmers, and this plan's size does not change for momentum.`;
    }
    steps.push({ text: points, cost: 'nothing, or one signature', time: '10 minutes' });
    steps.push(activityStep(plan));
    var monitor = `Hold the position for the full ${hold} days so the activity lands in more than one weekly snapshot. ${monitorText(kind)}`;
    if (age !== null && age >= 900) {
      monitor += ` ${name} has also run ${(age / 365).toFixed(1)} years with no token — longer than most launches take — so if nothing is announced by the end of this hold, unwind instead of rolling.`;
    }
    steps.push({ text: monitor, cost: 'no transactions, just the checking', time: `${hold} days, a few minutes a check` });
    var unbond =
      kind === 'lstaking' || kind === 'staking' || kind === 'restaking'
        ? ' (staking exits can queue for days, so start the exit that early)'
        : kind === 'rwa' || kind === 'insurance'
          ? ' (redemptions follow the issuer\u2019s schedule, not yours)'
          : '';
    steps.push({
      text: `Unwind in reverse order: withdraw or unstake${unbond}, swap back to USDC, and claim any points or token only from the link in ${name}'s official announcement — never pay a third party to claim for you. Write the wallet, the dates and every transaction hash in a farm log as you go.`,
      cost: `about ${money(plan.exitCost)} in gas and fees`,
      time: '15 minutes, plus any unbonding queue'
    });
    var perDollar = plan.ratio < 0.01 ? 'under $0.01' : money(plan.ratio);
    if (plan.ratio <= 0.5) {
      steps.push({
        text: `Budget check: funding ${money(plan.funding)}, setup ${money(plan.setupCost)}, activity ${money(plan.activityCost)} and exit ${money(plan.exitCost)} total about ${money(plan.net)} of net cost on ${money(cap)} deployed — ${perDollar} per $1, under the $0.50 ceiling. The capital itself comes back on exit unless the protocol fails; the net figure is gas and fees only.`,
        cost: 'no further spend',
        time: '2 minutes to verify'
      });
    } else {
      var needed = Math.ceil(plan.net / 0.5 / 5) * 5;
      steps.push({
        text: `Budget check, honestly: even this leanest route nets about ${money(plan.net)} on ${money(cap)} deployed — ${perDollar} per $1, over the $0.50 ceiling — because ${chain} transaction costs dominate at this size. Either deploy at least ${money(needed)} to bring the same route under the ceiling, or run only the free steps above (wallet, registration, monitoring) until ${name} supports a cheaper chain.`,
        cost: 'no further spend',
        time: '2 minutes to verify'
      });
    }
    return steps.map(stepText);
  }
  // FARM-GENERATOR-END

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chainCounts = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chainCounts[c] = (chainCounts[c] || 0) + 1; }); });
    var chains = Object.keys(chainCounts).sort(function (a, b) { return chainCounts[b] - chainCounts[a] || (a < b ? -1 : 1); });
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c + ' (' + chainCounts[c] + ')', selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field grow' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' of ' + DATA.rows.length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } })
      ));
    }
    var max = 1;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num rank' + (r.rank <= 3 ? ' top' : ''), text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('span', { class: 'name-line' },
            el('b', { text: r.name }),
            el('span', { class: 'tag ' + (r.watchlist ? 'tag-watch' : 'tag-early'), text: r.watchlist ? 'watchlist' : 'early' })
          ),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x base_multiple(row) x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )'
      ),
      el('p', { class: 'sub', text: 'base_multiple(row) is fitted from the snapshot itself, not fixed: a winsorised log-log regression of market cap on TVL over the protocols that already have a token, with a per-category adjustment shrunk toward the global fit, recalibrated around the growth and maturity factors. At the comps\u2019 median TVL the category-neutral multiple is ' + m.base_multiple.toFixed(4) + '; each row\u2019s own multiple is in its detail view. The fit was validated on a held-out slice of the tokenised protocols, where it beat the previous fixed-multiple model (see the entry\u2019s docs).' }),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'tags' },
          el('span', { class: 'tag ' + (row.watchlist ? 'tag-watch' : 'tag-early'), text: row.watchlist ? 'watchlist' : 'early radar' }),
          el('span', { class: 'tag tag-cat', text: row.category || 'Other' }),
          (row.chains || []).map(function (c) { return el('span', { class: 'tag tag-chain', text: c }); })
        )
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Base multiple (fitted)' }), el('b', { class: 'num', text: row.base_multiple === null || row.base_multiple === undefined ? 'n/a' : row.base_multiple.toFixed(4) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('p', { class: 'sub', text: steps.length + ' steps, priced from this row\u2019s own record — its category, its farm chain, its TVL, its age. The last step is the plan\u2019s own budget check: net cost per $1 deployed, held to $0.50.' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
