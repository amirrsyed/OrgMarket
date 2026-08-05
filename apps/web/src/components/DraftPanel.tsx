"use client";

import { useState } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/format";

interface Draft {
  question: string;
  description: string;
  resolutionCriteria: string;
  resolutionSource: string;
  closeAtIso: string;
  outcomes: string[];
  liquidityB: number;
  rationale: string;
  blocked: string[];
}

type PublishState = { status: "idle" } | { status: "publishing" } | { status: "done"; marketId: string } | { status: "error"; message: string };

function DraftCard({ draft }: { draft: Draft }) {
  const [publish, setPublish] = useState<PublishState>({ status: "idle" });
  const isBlocked = draft.blocked.length > 0;

  async function publishDraft() {
    setPublish({ status: "publishing" });
    try {
      const res = await fetch("/api/ai/publish-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const json = await res.json();
      if (!res.ok) setPublish({ status: "error", message: json.error ?? "publish failed" });
      else setPublish({ status: "done", marketId: json.marketId });
    } catch {
      setPublish({ status: "error", message: "network error" });
    }
  }

  return (
    <div
      className={`rounded-xl border bg-white p-4 ${isBlocked ? "border-red-200" : "border-slate-200"}`}
    >
      <p className="font-medium leading-snug">{draft.question}</p>
      {draft.description && <p className="mt-1 text-sm text-slate-600">{draft.description}</p>}
      <div className="mt-2 flex flex-wrap gap-1">
        {draft.outcomes.map((o) => (
          <span key={o} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            {o}
          </span>
        ))}
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
          b={draft.liquidityB}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
          closes {formatDate(draft.closeAtIso)}
        </span>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        <span className="font-medium">Resolves:</span> {draft.resolutionCriteria}{" "}
        <span className="font-medium">Source:</span> {draft.resolutionSource}
      </p>
      <p className="mt-1 text-xs italic text-slate-400">{draft.rationale}</p>
      {isBlocked ? (
        <div className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">
          <p className="font-medium">Blocked by guardrails:</p>
          <ul className="list-inside list-disc">
            {draft.blocked.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      ) : publish.status === "done" ? (
        <p className="mt-3 text-sm font-medium text-emerald-700">
          Published —{" "}
          <Link href={`/m/${publish.marketId}`} className="underline">
            open market
          </Link>
        </p>
      ) : (
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={publishDraft}
            disabled={publish.status === "publishing"}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {publish.status === "publishing" ? "Publishing…" : "Publish market"}
          </button>
          {publish.status === "error" && <p className="text-xs text-red-600">{publish.message}</p>}
        </div>
      )}
    </div>
  );
}

export function DraftPanel({ aiConfigured }: { aiConfigured: boolean }) {
  const [document, setDocument] = useState("");
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    setDrafts(null);
    try {
      const res = await fetch("/api/ai/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "drafting failed");
      else setDrafts(json.drafts);
    } catch {
      setError("network error");
    } finally {
      setBusy(false);
    }
  }

  if (!aiConfigured) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        AI drafting is not configured. Set <code>ANTHROPIC_API_KEY</code> in the server
        environment to enable it — everything else works without it.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <textarea
        value={document}
        onChange={(e) => setDocument(e.target.value)}
        rows={10}
        placeholder="Paste a roadmap, OKR doc, or planning notes. Claude drafts the markets whose answers would most change a decision — you review and publish."
        className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm focus:border-slate-500 focus:outline-none"
      />
      <button
        type="button"
        onClick={generate}
        disabled={busy || document.trim().length < 40}
        className="rounded-lg bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-40"
      >
        {busy ? "Drafting… (this can take a minute)" : "Draft markets"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {drafts && drafts.length === 0 && (
        <p className="text-sm text-slate-500">No draftable markets found in that document.</p>
      )}
      {drafts && drafts.length > 0 && (
        <div className="space-y-3">
          {drafts.map((d, i) => (
            <DraftCard key={i} draft={d} />
          ))}
        </div>
      )}
    </div>
  );
}
