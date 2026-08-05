"use client";

import { useState } from "react";

export function MemoPanel({ aiConfigured }: { aiConfigured: boolean }) {
  const [memo, setMemo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    setPosted(false);
    try {
      const res = await fetch("/api/ai/memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "memo generation failed");
      else setMemo(json.memo);
    } catch {
      setError("network error");
    } finally {
      setBusy(false);
    }
  }

  async function postToSlack() {
    if (!memo) return;
    setPosting(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memo, post: true }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "posting failed");
      else setPosted(true);
    } catch {
      setError("network error");
    } finally {
      setPosting(false);
    }
  }

  if (!aiConfigured) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        The memo needs AI. Set <code>ANTHROPIC_API_KEY</code> in the server environment to
        enable it.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          className="rounded-lg bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-40"
        >
          {busy ? "Writing… (this can take a minute)" : memo ? "Regenerate" : "Generate memo"}
        </button>
        {memo && (
          <button
            type="button"
            onClick={postToSlack}
            disabled={posting || posted}
            className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700 disabled:opacity-40"
          >
            {posted ? "Posted to Slack" : posting ? "Posting…" : "Post to Slack"}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {memo && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-800">
            {memo}
          </pre>
        </div>
      )}
    </div>
  );
}
