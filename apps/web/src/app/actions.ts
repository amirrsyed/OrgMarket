"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { memberships } from "@/db/schema";
import { SESSION_COOKIE, currentMember } from "@/lib/session";
import { createMarketTx, resolveMarketTx } from "@/services/trading";

export async function loginAs(formData: FormData): Promise<void> {
  const membershipId = String(formData.get("membershipId") ?? "");
  const db = await getDb();
  const [row] = await db.select().from(memberships).where(eq(memberships.id, membershipId));
  if (!row) throw new Error("unknown membership");
  const store = await cookies();
  store.set(SESSION_COOKIE, membershipId, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/");
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}

const createMarketSchema = z.object({
  question: z.string().min(10, "question too short"),
  description: z.string().default(""),
  resolutionCriteria: z.string().min(10, "resolution criteria required"),
  resolutionSource: z.string().min(3, "resolution source required"),
  liquidityB: z.coerce.number().refine((b) => [50, 100, 250].includes(b), "pick a liquidity preset"),
  closeAt: z.coerce.date().refine((d) => d.getTime() > Date.now(), "close date must be in the future"),
  outcomes: z.string(),
});

export async function createMarketAction(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member || member.role !== "admin") throw new Error("admin only");
  const parsed = createMarketSchema.parse(Object.fromEntries(formData.entries()));
  const db = await getDb();
  const marketId = await createMarketTx(db, {
    orgId: member.orgId,
    question: parsed.question,
    description: parsed.description,
    resolutionCriteria: parsed.resolutionCriteria,
    resolutionSource: parsed.resolutionSource,
    liquidityB: parsed.liquidityB,
    closeAt: parsed.closeAt,
    createdBy: member.membershipId,
    outcomeLabels: parsed.outcomes.split("\n"),
  });
  revalidatePath("/");
  redirect(`/m/${marketId}`);
}

const resolveSchema = z.object({
  marketId: z.string().min(1),
  winningOutcomeIdx: z.coerce.number().int().min(0),
  evidence: z.string().min(5, "evidence note required"),
});

export async function resolveMarketAction(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member || member.role !== "admin") throw new Error("admin only");
  const parsed = resolveSchema.parse(Object.fromEntries(formData.entries()));
  const db = await getDb();
  await resolveMarketTx(db, {
    orgId: member.orgId,
    marketId: parsed.marketId,
    winningOutcomeIdx: parsed.winningOutcomeIdx,
    resolvedBy: member.membershipId,
    evidence: parsed.evidence,
  });
  revalidatePath(`/m/${parsed.marketId}`);
  revalidatePath("/");
  redirect(`/m/${parsed.marketId}`);
}
