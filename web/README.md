# PantaScope Web Terminal

The PantaScope terminal UI: a market screener, market deep dives, a portfolio
tracker, and a paper-trade lab, all running against the Panta API shapes.

## Run it

```bash
cd web
npm install
npm run dev
```

Open http://localhost:3000. Four routes:

- `/` : market screener (sortable table, phase and category filters)
- `/market/[id]` : deep dive (primary vs secondary spot prices, countdown,
  tape stats, whale watch, trade tape)
- `/portfolio` : paste a wallet, see positions with mark-to-market value
- `/lab` : paper-trade form running quote then build, stopping before any
  signature

## Mock-first approach

Every page reads through `lib/datasource.ts`, which today returns the mock
layer in `lib/mock.ts`. The mock mirrors the verified Panta API types in
`../src/types.ts` (type-only imports, erased at compile time), with 10
realistic markets across categories and phases, a trade tape, positions, and
mock quote/build generators.

Nothing here touches the network. That is deliberate: the terminal is fully
demonstrable offline, and the data layer is structured so the live API takes
over without touching any page.

## Planned `/api` proxy

The live Panta API requires an API key on every call, including read-only
ones, and the docs note that only rate-limit headers are exposed
cross-origin, so the browser cannot call Panta directly. The plan:

- `app/api/[...proxy]/route.ts` receives frontend requests, attaches
  `X-Api-Key` from a server-side environment variable, forwards to
  `https://live-api.panta.market/api/v1`, and returns the result.
- The browser never sees the key. It lives in `.env` on the server only.
- `lib/datasource.ts` gains a `proxySource` that calls `/api/...` instead of
  the mock. Swapping sources is a one-import change in that file.

No wallet connection or signing in this scaffold. The lab renders unsigned
instructions for inspection only.
