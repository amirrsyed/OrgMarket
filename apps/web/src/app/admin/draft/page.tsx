import { redirect } from "next/navigation";
import { currentMember } from "@/lib/session";
import { isAiConfigured } from "@/services/ai/client";
import { DraftPanel } from "@/components/DraftPanel";

export const dynamic = "force-dynamic";

export default async function DraftPage() {
  const member = await currentMember();
  if (!member) redirect("/login");
  if (member.role !== "admin") redirect("/");
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold">Draft markets with AI</h1>
      <p className="mb-4 text-sm text-slate-500">
        Paste a planning document; Claude drafts well-formed markets (criteria, source, close
        date). Nothing publishes without your click, and compliance guardrails run in code
        (SPEC §7 / D19).
      </p>
      <DraftPanel aiConfigured={isAiConfigured()} />
    </div>
  );
}
