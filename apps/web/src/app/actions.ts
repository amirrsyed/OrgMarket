"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { memberships } from "@/db/schema";
import { SESSION_COOKIE, currentMember, isDevLoginEnabled } from "@/lib/session";
import { isSsoConfigured, signIn, signOut } from "@/auth";
import {
  createMarketTx,
  disputeResolutionTx,
  finalizeResolutionTx,
  proposeResolutionTx,
} from "@/services/trading";
import { getOrgSettings } from "@/services/org";
import { announceMarket, announceResolution } from "@/services/slack/notify";

export async function loginAs(formData: FormData): Promise<void> {
  if (!isDevLoginEnabled()) throw new Error("dev login is disabled");
  const membershipId = String(formData.get("membershipId") ?? "");
  const db = await getDb();
  const [row] = await db.select().from(memberships).where(eq(memberships.id, membershipId));
  if (!row) throw new Error("unknown membership");
  const store = await cookies();
  store.set(SESSION_COOKIE, membershipId, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/");
}

export async function ssoSignIn(formData: FormData): Promise<void> {
  await signIn(String(formData.get("providerId") ?? ""), { redirectTo: "/" });
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  if (isSsoConfigured()) await signOut({ redirectTo: "/login" });
  redirect("/login");
}

function backToMarket(marketId: string, error?: string): never {
  revalidatePath(`/m/${marketId}`);
  revalidatePath("/");
  redirect(error ? `/m/${marketId}?error=${encodeURIComponent(error)}` : `/m/${marketId}`);
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
  await announceMarket(db, member.orgId, marketId);
  revalidatePath("/");
  redirect(`/m/${marketId}`);
}

const proposeSchema = z.object({
  marketId: z.string().min(1),
  winningOutcomeIdx: z.coerce.number().int().min(0),
  evidence: z.string().min(5, "evidence note required"),
});

/** Admin proposes a resolution; it settles after the challenge window (D20). */
export async function proposeResolutionAction(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member || member.role !== "admin") throw new Error("admin only");
  const parsed = proposeSchema.parse(Object.fromEntries(formData.entries()));
  const db = await getDb();
  const settings = await getOrgSettings(db, member.orgId);
  let error: string | undefined;
  try {
    const result = await proposeResolutionTx(db, {
      orgId: member.orgId,
      marketId: parsed.marketId,
      winningOutcomeIdx: parsed.winningOutcomeIdx,
      proposedBy: member.membershipId,
      evidence: parsed.evidence,
      challengeWindowHours: settings.challengeWindowHours,
    });
    if (result.finalized) {
      await announceResolution(db, member.orgId, parsed.marketId, result.totalPayoutMicro, result.winnerCount);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "could not propose resolution";
  }
  backToMarket(parsed.marketId, error);
}

export async function disputeResolutionAction(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/login");
  const marketId = String(formData.get("marketId") ?? "");
  const db = await getDb();
  let error: string | undefined;
  try {
    await disputeResolutionTx(db, {
      orgId: member.orgId,
      marketId,
      membershipId: member.membershipId,
      reason: String(formData.get("reason") ?? ""),
    });
  } catch (err) {
    error = err instanceof Error ? err.message : "could not file dispute";
  }
  backToMarket(marketId, error);
}

export async function finalizeResolutionAction(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member || member.role !== "admin") throw new Error("admin only");
  const marketId = String(formData.get("marketId") ?? "");
  const override = formData.get("override") === "on";
  const db = await getDb();
  let error: string | undefined;
  try {
    const { totalPayoutMicro, winnerCount } = await finalizeResolutionTx(db, {
      orgId: member.orgId,
      marketId,
      finalizedBy: member.membershipId,
      overrideDisputes: override,
    });
    await announceResolution(db, member.orgId, marketId, totalPayoutMicro, winnerCount);
  } catch (err) {
    error = err instanceof Error ? err.message : "could not finalize";
  }
  backToMarket(marketId, error);
}
