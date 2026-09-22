# PantaScope: Build Plan

**Bounty:** Panta API Sidetrack, Colosseum Crypto World's Fair, Superteam Earn
**Listing:** https://superteam.fun/earn/listing/panta-api-side-track
**Prizes:** 5,000 USDG total (1st 2,000 / 2nd 1,000 / 3rd 1,000 / 4th 1,000)
**Deadline:** Oct 13, 2026, 6:59 AM UTC (winners announced by Oct 27, 2026)
**Submissions so far:** 2 (as of 2026-09-21)
**Judging:** depth of Panta API integration, technical execution, originality;
working demo required. Eligibility also requires registering and submitting on
the official Colosseum platform, not just the Earn sidetrack.

## 0. What the API really is (verified 2026-09-21, not assumed)

Research notes from the official docs (https://docs.panta.market) and the Panta
blog post "Panta API: Prediction Market Infrastructure for Builders":

- Base URL `https://live-api.panta.market/api/v1`. Trailing slashes required.
  Auth: `X-Api-Key` (`pk_test_`/`pk_live_`) or `Authorization: Bearer <access>`.
  **Even read-only catalog calls require a key** (verified: 401 without one).
- Panta is binary YES/NO prediction-market infrastructure on Solana, USDC
  denominated. Market lifecycle: Primary Market (bonding curve) -> Secondary
  Market (order book) -> resolved. Parimutuel payouts; AI Resolution Agent with
  a dispute process.
- The write flow is always quote -> build -> sign -> broadcast -> register.
  Panta prepares the transaction; the user signs with their own wallet; the
  app broadcasts on its own RPC; then the signature is submitted to Panta for
  verification and attribution. **Panta never holds keys or funds.**
- Timing: create sessions last ~5 minutes, trade quotes ~90 seconds. Apps must
  rebuild on expiry.
- Market creation costs real USDC: Standard $50, Breaking $20. Amounts for
  creation are USDC base units (6 decimals, integer strings); primary buys use
  human-readable decimal strings.
- **There is no testnet or devnet.** The API is mainnet-only. Any signed and
  broadcast transaction moves real USDC.
- Full endpoint table is in README.md. The catalog `GET /markets/` rows come
  from the registry (prices null on list); `GET /markets/{id}/` fills spot
  prices from on-chain state when RPC is available.

## 1. Recommended concept: PantaScope

A prediction-market intelligence terminal on the Panta API. The differentiator
is treating *market data as the product*, not building another trading UI:

1. **Market screener:** the full catalog with category/phase filters, ranked
   by volume, with spot implied probabilities and phase badges. The discovery
   layer the track explicitly asks for ("market discovery tools").
2. **Market deep dive:** spot prices (primary vs secondary), price history
   charted from the public trade tape, taker imbalance, whale-trade
   highlights, time-to-resolution countdown.
3. **Portfolio tracker:** paste any wallet: positions with shares, phase,
   claim eligibility, and mark-to-market value (shares x spot price) via
   `GET /positions/` + `GET /markets/{id}/`. Claimable positions surface a
   "build claim" action.
4. **Paper-trade lab:** the depth-of-integration hook. Runs the real
   `POST /primaryorderquote/` -> `POST /primaryorderbuild/` pipeline and
   renders the unsigned instructions, expected shares, fee, and slippage
   without ever signing or broadcasting. Zero-cost, but it exercises the exact
   write path judges care about. Same treatment for market creation:
   quote -> unsigned build, stopping before the wallet signature.
5. **Attribution wiring:** `POST /trades/report/` and `GET /trades/status/`
   integrated so any trade placed through PantaScope is credited to the app.

**Why this wins on the rubric:**
- *Depth of integration:* catalog, detail, tape, positions, categories, both
  quote/build pipelines, claim builds, attribution reporting. Read and
  write-planning surfaces, end to end.
- *Technical execution:* full-stack TypeScript, every type verified against
  the published docs, quote-expiry and blockhash-expiry handled, no key
  custody anywhere.
- *Originality:* nobody is building the analytics layer. Tape-derived
  imbalance, whale detection, and portfolio mark-to-market turn raw Panta data
  into something traders cannot get on panta.market itself.

## 2. Alternatives considered (not recommended)

- **Conviction Copilot (AI market analyst):** an LLM that reads Panta market
  data and writes plain-English briefings, drafting create-quotes for ideas it
  likes. Strong "AI + Prediction Markets" fit, but the demo hinges on
  subjective output quality and adds an LLM dependency for marginal judging
  upside over the terminal. Keep as a stretch feature, not the core.
- **Market launcher studio:** a guided market-creation flow ending at the
  unsigned transaction. Deep create-flow integration, but the track demands a
  working demo and a real creation costs $20-50 USDC plus a funded wallet, so
  the demo would stop one step short of done. Fold the create-quote flow into
  PantaScope's lab instead of making it the product.
- **Social prediction feed:** community debate around markets. Needs users to
  be interesting; we have three weeks and no audience. Kill.

## 3. Architecture

```
pantoscope/
  src/
    types.ts         # API shapes, verified against docs.panta.market
    client.ts        # typed REST client (no signing, no broadcasting)
    markets.ts       # read-only analytics: ranking, tape stats, formatting
    mock.ts          # fixture client for the offline demo
    screener.ts      # CLI slice: screener + deep dive + portfolio
    lab.ts           # (week 2) paper-trade lab: quote -> build -> inspect
    web/             # (week 2-3) Next.js terminal UI: screener, dive, portfolio, lab
    api/             # (week 2-3) thin backend: holds the API key, proxies Panta
  PLAN.md
  README.md
```

- Frontend: React/Next.js, wallet-adapter for the optional sign step. The API
  key lives server-side; the browser never sees it. CORS: the docs note only
  rate-limit headers are exposed cross-origin, so browser-direct calls are out.
- Backend: thin proxy that attaches `X-Api-Key`, plus unsigned-tx assembly
  for the lab. No key custody: users sign with their own wallets.
- Money rule: nothing in this repo signs or broadcasts. The lab stops at
  unsigned instructions by design. Any future live-trade toggle needs Carlos's
  explicit approval and his own funded wallet.

## 4. Milestone breakdown (~3 weeks)

**Week 1 (by Sep 28): API core, verified**
- [x] Official docs researched; full endpoint surface documented (2026-09-21)
- [x] Typed client + verified types, `tsc --noEmit` clean
- [x] Read-only slice: screener CLI with live and mock modes
- [x] **API key in hand:** free Panta signup + `pk_test_` key (2026-09-21;
      stored in the Secure Vault as connector custom.panta; verified live
      2026-09-21; test keys hit Panta's sandbox fixtures, not mainnet data)
      into `.env`. Read-only calls cost nothing. This is the one ask.
- [x] Live verification: `lab.ts --live` runs quote -> build against the
      Panta sandbox via the vault-held key (2026-09-21); `web/` live /api
      proxy still to build (week 2-3)
- [ ] **GROK REVIEW round 1:** client types vs the published docs, error
      handling, no-key fail behavior

**Week 2 (by Oct 5): terminal UI + paper-trade lab**
- [x] Next.js app: screener table, market deep-dive page with tape chart,
      portfolio page (2026-09-21, `web/`, mock data, `npm run build` clean;
      live /api proxy awaits the API key)
- [x] `lab.ts`: quote -> build -> unsigned-instruction inspector for primary
      buys; create-market quote -> build preview (2026-09-21, mock mode;
      live verification awaits the API key)
- [ ] Backend proxy holding the API key; rate-limit handling per the docs
      (switch on `code`, respect `Retry-After` on 429)
- [ ] Claim-readiness panel: claimable positions -> claim-build preview

**Week 3 (by Oct 12): polish + submission**
- [ ] Attribution reporting wired (`/trades/report/`, `/trades/status/`)
- [ ] Demo video (2-3 min): screener -> deep dive -> portfolio -> paper-trade
      lab on live data, mock mode as the offline fallback
- [ ] README, repo public, submission writeup
- [ ] **GROK QUALITY GATE (see section 6): mandatory before submission**
- [ ] Submit via Earn listing AND the Colosseum platform (both, after
      Carlos's go-ahead; Colosseum registration is on him)

## 5. Open questions

1. **API key: the one ask for Carlos.** Free signup at
   https://docs.panta.market (Authentication guide), mint a `pk_test_` key,
   paste it into `.env`. Read-only calls cost nothing. Nothing else about
   this lane needs him until submission.
2. **Colosseum registration:** required for eligibility alongside the Earn
   submission. On Carlos (account + project submission).
3. **Live trading in the demo:** deliberately out of scope. The lab proves the
   full quote -> build path at zero cost; executing a trade would need his
   funded wallet and explicit approval, and the rubric does not require it.
4. **No Earn wallet connected yet:** needed before any USDG payout lands.
   Separate key decision, not blocking the build.

## 6. STANDING QUALITY GATE: Grok review before submission

Carlos's standing directive: **double-check with Grok before filing anything.**
This is a hard gate, not a suggestion.

- Before ANYTHING is submitted to Superteam Earn or Colosseum (code, README,
  demo script, submission writeup), the full build must pass a Grok quality
  review.
- The review bundle is assembled as a single markdown file:
  `~/workspace/panta-track/GROK_REVIEW_BUNDLE.md`
  (assembled at week 3, same template as the Meteora lane).
- The main agent runs the bundle through the Grok review wrapper on the PC
  relay (grok-4.6) when the build is complete.
- Review scope: correctness of every endpoint call against the published
  docs, auth handling (key server-side only, never in the frontend bundle),
  quote/blockhash expiry handling, no-signature/no-broadcast guarantees,
  README accuracy, and submission-writeup claims vs. what was actually
  verified.
- A submission goes out only after Grok's findings are addressed and Carlos
  gives the go-ahead. Do not skip this step.
