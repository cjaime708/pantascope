"use client";

import { useEffect, useState } from "react";

/** Live countdown to a unix-seconds timestamp. */
export default function Countdown({ targetUnix }: { targetUnix: number }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const diff = targetUnix - now;
  if (diff <= 0) return <span className="countdown">closed</span>;

  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <span className="countdown">
      {d}d {pad(h)}:{pad(m)}:{pad(s)}
    </span>
  );
}
