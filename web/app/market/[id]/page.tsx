import Link from "next/link";
import { notFound } from "next/navigation";
import Countdown from "../../../components/Countdown";
import { PhaseBadge, SideBadge } from "../../../components/badges";
import { getDataSource, isLiveMode } from "../../../lib/datasource";
import { formatDateTime, formatUsdc, impliedPct, shortWallet } from "../../../lib/format";

export default async function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ds = getDataSource();
  const market = await ds.getMarket(id);
  if (!market) notFound();
  const tape = await ds.getTrades(id);

  const priceRow = (label: string, yes: string | null, no: string | null) => (
    <tr>
      <td>{label}</td>
      <td className="num pos">{impliedPct(yes)}</td>
      <td className="num neg">{impliedPct(no)}</td>
    </tr>
  );

  // Side is inferred from which amount is larger; a trade should never carry both.
  const tradeSide = (t: (typeof tape)[number]): "yes" | "no" =>
    parseFloat(String(t.yesAmount)) >= parseFloat(String(t.noAmount)) ? "yes" : "no";
  const yesBuys = tape.filter((t) => tradeSide(t) === "yes" && parseFloat(String(t.yesAmount)) > 0);
  const noBuys = tape.filter((t) => tradeSide(t) === "no" && parseFloat(String(t.noAmount)) > 0);
  const yesVol = yesBuys.reduce((s, t) => s + parseFloat(String(t.yesAmount)), 0);
  const noVol = noBuys.reduce((s, t) => s + parseFloat(String(t.noAmount)), 0);
  const totalTape = yesVol + noVol;
  const imbalance = totalTape > 0 ? ((yesVol - noVol) / totalTape) * 100 : 0;
  const whales = [...tape]
    .map((t) => ({
      t,
      size: Math.max(parseFloat(String(t.yesAmount)), parseFloat(String(t.noAmount))),
    }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 3);

  return (
    <>
      <p className="muted">
        <Link href="/">screener</Link> / {market.marketId}
      </p>

      <div className="panel">
        <h2>Market detail</h2>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{market.title}</span>
          <PhaseBadge phase={market.phase} />
          <span className="badge badge-neutral">{market.category}</span>
          <span className="badge badge-neutral">{market.marketType}</span>
        </div>
        <p className="muted">{market.description}</p>
        <dl className="kv">
          <dt>Volume</dt>
          <dd>{formatUsdc(market.volumeUsdc)} USDC</dd>
          <dt>Trading ends</dt>
          <dd>{formatDateTime(market.endTime)}</dd>
          <dt>Resolution</dt>
          <dd>{formatDateTime(market.resolutionTime)}</dd>
          <dt>Region</dt>
          <dd>{market.region}</dd>
          <dt>Status</dt>
          <dd>{market.status}</dd>
        </dl>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Spot prices: primary vs secondary</h2>
          <table className="data">
            <thead>
              <tr>
                <th>Venue</th>
                <th className="num">YES implied</th>
                <th className="num">NO implied</th>
              </tr>
            </thead>
            <tbody>
              {priceRow("Primary (bonding curve)", market.primaryYesPrice, market.primaryNoPrice)}
              {priceRow("Secondary (order book)", market.secondaryYesPrice, market.secondaryNoPrice)}
              {priceRow("Spot", market.yesPrice, market.noPrice)}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
            The catalog leaves prices empty until the detail call fills them from on-chain
            state. A gap between primary and secondary is where edge lives.
          </p>
        </div>

        <div className="panel">
          <h2>Time to resolution</h2>
          <Countdown targetUnix={market.resolutionTime} />
          <p className="muted" style={{ fontSize: 11 }}>
            Countdown runs against the market&apos;s resolution timestamp. Prices tend to
            pin toward 0 or 1 as this approaches zero.
          </p>
          <h2 style={{ marginTop: 16 }}>Tape stats</h2>
          <dl className="kv">
            <dt>Trades on tape</dt>
            <dd>{tape.length}</dd>
            <dt>YES volume</dt>
            <dd className="pos">{formatUsdc(yesVol)} USDC</dd>
            <dt>NO volume</dt>
            <dd className="neg">{formatUsdc(noVol)} USDC</dd>
            <dt>Taker imbalance</dt>
            <dd className={imbalance >= 0 ? "pos" : "neg"}>
              {imbalance >= 0 ? "+" : ""}
              {imbalance.toFixed(1)}% {imbalance >= 0 ? "YES" : "NO"} lean
            </dd>
          </dl>
        </div>
      </div>

      <div className="panel">
        <h2>Price history</h2>
        <div className="chart-placeholder">
          Price chart renders here from the {isLiveMode() ? "live" : "public mock"} trade
          tape. The tape above is the exact input the chart will consume: every trade
          carries side, size, and block time.
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Trade tape</h2>
          {tape.length === 0 ? (
            <p className="muted">No trades on the tape for this market yet.</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Wallet</th>
                  <th>Side</th>
                  <th>Venue</th>
                  <th className="num">Size (USDC)</th>
                  <th className="num">Fee</th>
                </tr>
              </thead>
              <tbody>
                {tape.map((t) => {
                  const isYes = tradeSide(t) === "yes";
                  return (
                    <tr key={String(t.id)}>
                      <td className="muted">{shortWallet(t.wallet)}</td>
                      <td>
                        <SideBadge side={isYes ? "yes" : "no"} />
                      </td>
                      <td>{t.isPrimary ? "primary" : "secondary"}</td>
                      <td className="num">
                        {formatUsdc(isYes ? t.yesAmount : t.noAmount)}
                      </td>
                      <td className="num muted">{formatUsdc(t.feePaid)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel">
          <h2>Whale watch</h2>
          {whales.length === 0 ? (
            <p className="muted">Nothing large enough to flag yet.</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Wallet</th>
                  <th>Side</th>
                  <th className="num">Size (USDC)</th>
                </tr>
              </thead>
              <tbody>
                {whales.map(({ t, size }) => (
                  <tr key={String(t.id)}>
                    <td className="muted">{shortWallet(t.wallet)}</td>
                    <td>
                      <SideBadge side={tradeSide(t)} />
                    </td>
                    <td className="num">{formatUsdc(size)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted" style={{ fontSize: 11 }}>
            Largest single prints on the tape. Whales moving early often know something;
            whales moving late are usually chasing.
          </p>
        </div>
      </div>
    </>
  );
}
