"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-renders server data on an interval while the tab is visible. Prices move
 * at human speed, so this replaces a WebSocket/Redis stack (D20).
 */
export function AutoRefresh({ intervalMs = 15_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const handle = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => clearInterval(handle);
  }, [router, intervalMs]);
  return null;
}
