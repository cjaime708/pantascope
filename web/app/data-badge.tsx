"use client";

import { isLiveMode } from "../lib/datasource";

/**
 * Data-source badge, evaluated in the browser at runtime from the same
 * isLiveMode() check the data layer uses. This keeps the badge and the
 * actual data source in agreement even if a stale prerendered HTML shell
 * is served from a cache.
 */
export default function DataBadge() {
  const live = isLiveMode();
  return (
    <span className="env-tag">
      {live ? "live data: Panta API via server proxy" : "mock data: live API proxy not yet wired"}
    </span>
  );
}
