import { redirect } from "next/navigation";
import { currentMember } from "@/lib/session";
import { isAiConfigured } from "@/services/ai/client";
import { MemoPanel } from "@/components/MemoPanel";

export const dynamic = "force-dynamic";

export default async function MemoPage() {
  const member = await currentMember();
  if (!member) redirect("/login");
  if (member.role !== "admin") redirect("/");
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold">Leadership memo</h1>
      <p className="mb-4 text-sm text-slate-500">
        What the market believes, in one page: biggest belief moves, markets closing soon,
        recent resolutions. Figures are computed by the app; Claude writes the prose (D19).
      </p>
      <MemoPanel aiConfigured={isAiConfigured()} />
    </div>
  );
}
