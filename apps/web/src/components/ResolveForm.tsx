"use client";

import { useState } from "react";
import { resolveMarketAction } from "@/app/actions";

interface Check {
  verdict: "criteria_met" | "criteria_not_met" | "insufficient_evidence";
  recommendedOutcomeIdx: number | null;
  suggestedNote: string;
  reasoning: string;
}

const VERDICT_LABEL: Record<Check["verdict"], string> = {
  criteria_met: "Criteria met",
  criteria_not_met: "Criteria not met",
  insufficient_evidence: "Evidence insufficient — resolve only if you know more than this note",
};

/**
 * Admin resolution form. The AI check is advisory: it reads the evidence
 * against the stated criteria and suggests — the admin always decides (D19).
 */
export function ResolveForm({
  marketId,
  outcomes,
  aiConfigured,
}: {
  marketId: string;
  outcomes: { idx: number; label: string }[];
  aiConfigured: boolean;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [evidence, setEvidence] = useState("");
  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runCheck() {
    setChecking(true);
    setError(null);
    setCheck(null);
    try {
      const res = await fetch(`/api/markets/${marketId}/resolution-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evidence }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "check failed");
      else setCheck(json);
    } catch {
      setError("network error");
    } finally {
      setChecking(false);
    }
  }

  return (
    <form action={resolveMarketAction} className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
      <p className="mb-2 font-medium text-amber-800">Resolve (admin)</p>
      <input type="hidden" name="marketId" value={marketId} />
      <div className="mb-2 space-y-1">
        {outcomes.map((o) => (
          <label key={o.idx} className="flex items-center gap-2">
            <input
              type="radio"
              name="winningOutcomeIdx"
              value={o.idx}
              required
              checked={selected === o.idx}
              onChange={() => setSelected(o.idx)}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      <textarea
        name="evidence"
        required
        value={evidence}
        onChange={(e) => setEvidence(e.target.value)}
        placeholder="Evidence note (required)"
        className="mb-2 w-full rounded border border-amber-200 bg-white p-2"
        rows={3}
      />
      {aiConfigured && (
        <div className="mb-2">
          <button
            type="button"
            onClick={runCheck}
            disabled={checking || evidence.trim().length < 10}
            className="rounded border border-amber-300 px-2 py-1 text-xs font-medium text-amber-800 disabled:opacity-40"
          >
            {checking ? "Checking…" : "Check evidence with AI"}
          </button>
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
          {check && (
            <div className="mt-2 rounded border border-amber-200 bg-white p-2 text-xs text-slate-700">
              <p className="font-medium">
                {VERDICT_LABEL[check.verdict]}
                {check.recommendedOutcomeIdx !== null && (
                  <> — suggests “{outcomes[check.recommendedOutcomeIdx]?.label}”</>
                )}
              </p>
              <p className="mt-1">{check.reasoning}</p>
              {(check.recommendedOutcomeIdx !== null || check.suggestedNote) && (
                <button
                  type="button"
                  className="mt-2 rounded bg-slate-900 px-2 py-1 font-medium text-white"
                  onClick={() => {
                    if (check.recommendedOutcomeIdx !== null) setSelected(check.recommendedOutcomeIdx);
                    if (check.suggestedNote) setEvidence(check.suggestedNote);
                  }}
                >
                  Use suggestion
                </button>
              )}
            </div>
          )}
        </div>
      )}
      <button type="submit" className="rounded bg-amber-700 px-3 py-1.5 font-medium text-white">
        Resolve market
      </button>
    </form>
  );
}
