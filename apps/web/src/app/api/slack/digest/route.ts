import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { orgs } from "@/db/schema";
import { postDigest } from "@/services/slack/notify";

/**
 * Weekly digest trigger, gated by a shared secret — point a scheduler (Vercel
 * cron, GitHub Actions schedule) at this with the DIGEST_SECRET header.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.DIGEST_SECRET;
  if (!secret || req.headers.get("x-digest-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = await getDb();
  const allOrgs = await db.select({ id: orgs.id }).from(orgs);
  const posted: string[] = [];
  for (const org of allOrgs) {
    if (await postDigest(db, org.id)) posted.push(org.id);
  }
  return NextResponse.json({ posted });
}
