import type { Metadata } from "next";
import Link from "next/link";
import DataBadge from "./data-badge";
import "./globals.css";

export const metadata: Metadata = {
  title: "PantaScope: prediction market intelligence terminal",
  description:
    "A terminal for Panta prediction markets: screener, market deep dives, portfolio tracking, and a paper-trade lab.",
};

const NAV = [
  { href: "/", label: "Screener" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/lab", label: "Lab" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand" style={{ color: "var(--green)", textDecoration: "none" }}>
            PANTASCOPE<span className="cursor" />
          </Link>
          <nav className="nav">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href}>
                {n.label}
              </Link>
            ))}
          </nav>
          <DataBadge />
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
