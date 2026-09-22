# PantaScope

A prediction-market intelligence terminal built on the Panta API. Browse every
live Panta market, rank them by volume, drill into spot prices and the public
trade tape, price any wallet's portfolio mark-to-market, and plan trades
through the real quote pipeline. All without custodying keys: Panta prepares
transactions, the user signs with their own wallet.

Built for the Colosseum Crypto World's Fair **Panta API Sidetrack**
(5,000 USDG prize pool).

## What works today

`src/screener.ts` is the first working slice. It exercises the read-only Panta
surface end to end:

- `GET /markets/` (paginated catalog, category/status filters)
- `GET /markets/{marketId}/` (detail with spot prices from on-chain state)
- `GET /markets/{marketId}/trades/` (public trade tape, summarized into
  volume, taker imbalance, and largest-trade stats)
- `GET /positions/?wallet=` (holdings with claim eligibility, priced
  mark-to-market against spot prices)

The typed client in `src/client.ts` also covers the write-planning endpoints
(quote and build for primary buys, market creation, and win claims). Those
return quotes or unsigned instructions only. This repo never signs,
never broadcasts, and never touches private keys.

## Setup

Prerequisites: Node 18+ and npm.

```bash
cd ~/workspace/panta-track
npm install
npm run typecheck
```

### Getting a Panta API key (free, read-only calls cost nothing)

Even read-only catalog calls need an API key. Registration is free and takes
a minute in the docs playground at https://docs.panta.market (Authentication
guide: register, then create an API key). A `pk_test_` key works on the public
API. Put it in a `.env` file (never commit it):

```bash
echo 'PANTA_API_KEY=pk_test_your_key_here' > .env
```

Note: Panta runs on Solana mainnet. There is no testnet. Quote and build calls
are free, but actually signing and broadcasting moves real USDC, so the demo
below stops at unsigned transactions by design.

## Demo

Offline demo with fixture data (no key, no network):

```bash
npm run screener -- --mock
```

Live demo against the real API:

```bash
npm run screener -- --limit 10
npm run screener -- --category crypto --limit 5
npm run screener -- --wallet <base58-wallet>   # portfolio mark-to-market
```

Expected output in mock mode: a ranked market table, a deep dive on the top
market with spot prices, tape stats (trade count, YES/NO volume, imbalance,
largest trade), and, with `--wallet`, per-position mark-to-market values.

## Paper-trade lab

`src/lab.ts` is a zero-risk rehearsal of the write path. It walks the real
planning pipeline, quote then build, and inspects the unsigned instructions
the API returns: program id, account counts, signer/writable summary, and
data length per instruction.

```bash
npm run lab -- --demo
```

What it runs:

1. **Primary buy rehearsal.** Quotes a 20 USDC YES fill on the top fixture
   market (expected shares, average price, fee, quote expiry), then builds
   the unsigned instruction set and prints it instruction by instruction.
2. **Market creation rehearsal.** Quotes the creation fee (50 USDC for a
   standard market), then builds the unsigned transaction preview and prints
   the same inspection.

What it proves: the lab exercises the exact quote-to-build flow a real trade
uses, including the timing rules (primary quotes last about 90 seconds,
creation sessions about 5 minutes; the mock rejects expired quotes just
like the live API).

The no-signing guarantee: the lab stops at unsigned instructions by design.
No code path in this repo loads a private key, signs anything, or submits
anything to the network. Each rehearsal ends by printing that nothing was
signed and nothing was broadcast. Turning a rehearsal into a real trade
always happens in your own wallet, outside this repo.

## Project layout

```
panta-track/
  PLAN.md            # build plan, milestones, judging strategy
  TRACK.md           # track facts (prize, deadline, requirements)
  README.md          # this file
  package.json
  tsconfig.json
  src/
    types.ts         # API shapes, verified against docs.panta.market
    client.ts        # typed REST client (no signing, no broadcasting)
    markets.ts       # read-only analytics: ranking, tape stats, formatting
    mock.ts          # fixture client for the offline demo
    screener.ts      # CLI: market screener + deep dive + portfolio
    lab.ts           # CLI: paper-trade lab (quote -> build -> inspect)
```

## API reference (verified 2026-09-21)

Base URL: `https://live-api.panta.market/api/v1` (trailing slashes required).
Auth: `X-Api-Key` or `Authorization: Bearer`. Errors come back as
`{ "code", "message" }`; switch on `code`.

| Endpoint | What it does |
| --- | --- |
| `GET /markets/` | Paginated catalog (category, status, createdBy filters) |
| `GET /markets/{id}/` | Detail with spot prices |
| `GET /markets/{id}/trades/` | Public trade tape |
| `GET /categories/` | Category allowlist |
| `GET /positions/?wallet=` | Holdings, phase, claim eligibility |
| `POST /primaryorderquote/` | Simulate a YES/NO fill (~90s quote) |
| `POST /primaryorderbuild/` | Unsigned buy instructions + blockhash |
| `POST /primaryordersubmit/` | Register a broadcast signature |
| `POST /markets/create/quote/` | Validate params, return USDC fee (~5min session) |
| `POST /markets/create/build/` | Unsigned create transaction |
| `POST /markets/create/register/` | Register the confirmed create |
| `POST /claim/build/` | Unsigned win-claim instructions |
| `POST /claim/creator-fees/` | Unsigned creator-fee claim |
| `POST /trades/report/` | Attribution for a signature |

Full docs: https://docs.panta.market
