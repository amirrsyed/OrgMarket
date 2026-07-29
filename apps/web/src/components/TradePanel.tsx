"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney, formatPct, formatShares } from "@/lib/format";

interface Outcome {
  idx: number;
  label: string;
  prob: number;
}

interface Preview {
  /** Outcome the trade actually executes on (binary down-moves buy the complement). */
  outcomeIdx: number;
  deltaMicroShares: number;
  costMicro: number;
  newProb: number;
  cappedBy: "budget" | "holdings" | null;
}

/**
 * The forecast slider (D2): the member states a belief; the engine computes
 * the trade that moves the market there, clamped by balance or holdings.
 */
export function TradePanel({
  marketId,
  outcomes,
  holdings,
  tradable,
}: {
  marketId: string;
  outcomes: Outcome[];
  holdings: number[];
  tradable: boolean;
}) {
  const router = useRouter();
  const [sel, setSel] = useState(0);
  const [target, setTarget] = useState(() => Math.round((outcomes[0]?.prob ?? 0.5) * 100));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const current = outcomes[sel]?.prob ?? 0.5;
  const currentPct = Math.round(current * 100);

  useEffect(() => {
    if (!tradable) return;
    const seq = ++requestSeq.current;
    setError(null);
    if (target === currentPct) {
      setPreview(null);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/markets/${marketId}/preview?outcome=${sel}&target=${target / 100}`,
        );
        const json = await res.json();
        if (requestSeq.current !== seq) return;
        if (!res.ok) setError(json.error ?? "preview failed");
        else setPreview(json);
      } catch {
        if (requestSeq.current === seq) setError("network error");
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [marketId, sel, target, currentPct, tradable]);

  async function submit() {
    if (!preview || preview.deltaMicroShares === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/markets/${marketId}/trade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcomeIdx: preview.outcomeIdx,
          deltaMicroShares: preview.deltaMicroShares,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "trade failed");
      } else {
        const bought = preview.deltaMicroShares > 0;
        setConfirmation(
          bought
            ? `Bought ${formatShares(preview.deltaMicroShares)} shares for ${formatMoney(json.costMicro)}.`
            : `Sold ${formatShares(-preview.deltaMicroShares)} shares for ${formatMoney(-json.costMicro)}.`,
        );
        setPreview(null);
        router.refresh();
      }
    } catch {
      setError("network error");
    } finally {
      setBusy(false);
    }
  }

  if (!tradable) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
        Trading is closed for this market.
      </div>
    );
  }

  const isBuy = (preview?.deltaMicroShares ?? 0) > 0;
  const selLabel = outcomes[sel]?.label ?? "";
  const tradeLabel = preview ? (outcomes[preview.outcomeIdx]?.label ?? selLabel) : selLabel;
  const heldHere = holdings[sel] ?? 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-3 text-sm font-medium text-slate-600">Where do you put it?</p>
      {outcomes.length > 2 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {outcomes.map((o) => (
            <button
              key={o.idx}
              type="button"
              onClick={() => {
                setSel(o.idx);
                setTarget(Math.round(o.prob * 100));
                setConfirmation(null);
              }}
              className={`rounded-full px-3 py-1 text-sm ${
                sel === o.idx
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="text-slate-500">
          Crowd: <span className="font-medium text-slate-800">{formatPct(current)}</span>
        </span>
        <span className="text-slate-500">
          You: <span className="font-semibold text-slate-900 tabular-nums">{target}%</span>
        </span>
      </div>
      <input
        type="range"
        min={1}
        max={99}
        value={target}
        onChange={(e) => {
          setTarget(Number(e.target.value));
          setConfirmation(null);
        }}
        className="w-full accent-slate-900"
        aria-label={`Your probability for ${selLabel}`}
      />
      <div className="mt-3 min-h-[3.5rem] text-sm">
        {error && <p className="text-red-600">{error}</p>}
        {confirmation && !error && <p className="text-emerald-700">{confirmation}</p>}
        {preview && !error && preview.deltaMicroShares !== 0 && (
          <div className="text-slate-600">
            <p>
              {isBuy ? "Buy" : "Sell"}{" "}
              <span className="font-medium">
                {formatShares(Math.abs(preview.deltaMicroShares))} {tradeLabel}
              </span>{" "}
              shares {isBuy ? "for" : "returning"}{" "}
              <span className="font-medium">{formatMoney(Math.abs(preview.costMicro))}</span>
            </p>
            <p className="text-xs text-slate-500">
              Moves the market to {formatPct(preview.newProb)}
              {preview.cappedBy === "budget" && " — capped by your balance"}
              {preview.cappedBy === "holdings" && " — capped by your holdings (no shorting)"}
            </p>
          </div>
        )}
        {preview && !error && preview.deltaMicroShares === 0 && (
          <p className="text-slate-500">
            {target < currentPct && heldHere === 0 && outcomes.length > 2
              ? "You hold no shares of this outcome to sell — back a different outcome instead."
              : "No trade needed."}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={busy || !preview || preview.deltaMicroShares === 0}
        className="mt-2 w-full rounded-lg bg-slate-900 py-2 font-medium text-white disabled:opacity-40"
      >
        {busy ? "Trading…" : "Confirm forecast"}
      </button>
      {heldHere > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          You hold {formatShares(heldHere)} {selLabel} shares here.
        </p>
      )}
    </div>
  );
}
