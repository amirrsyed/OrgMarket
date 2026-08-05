import { z } from "zod/v4";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AI_MODEL, getAnthropic } from "./client";
import { checkGuardrails } from "./guardrails";

const DraftSchema = z.object({
  question: z.string().describe("The market question, ending in a question mark"),
  description: z.string().describe("One or two sentences of context for traders"),
  resolutionCriteria: z
    .string()
    .describe("Unambiguous rule starting with 'Resolves YES if…' or 'Resolves to…'"),
  resolutionSource: z.string().describe("The named system of record used to resolve"),
  closeAtIso: z.string().describe("ISO 8601 close datetime, before the resolution date"),
  outcomes: z.array(z.string()).describe("2–10 outcome labels; ['Yes','No'] for binary"),
  liquidityPreset: z.enum(["shallow", "standard", "deep"]),
  rationale: z.string().describe("Why this question is worth asking the crowd"),
});

const DraftBatchSchema = z.object({ drafts: z.array(DraftSchema) });

const PRESET_TO_B: Record<string, number> = { shallow: 50, standard: 100, deep: 250 };

export interface MarketDraft {
  question: string;
  description: string;
  resolutionCriteria: string;
  resolutionSource: string;
  closeAtIso: string;
  outcomes: string[];
  liquidityB: number;
  rationale: string;
  /** SPEC §7 violations; empty = publishable. */
  blocked: string[];
}

const DRAFTING_SYSTEM = `You draft internal prediction-market questions for OrgMarket, a forecasting layer companies use to surface what employees actually believe about the plan.

Given a planning document (roadmap, OKRs, status notes), draft the 3–8 markets whose answers would most change a leader's decisions. Craft rules:
- Every question must be objectively resolvable by a named source. "Resolves YES if the console build is purchasable on two of three storefronts by Oct 31" — not "resolves if the launch goes well".
- Prefer binary Yes/No questions on dates, milestones, and measurable outcomes. Use categorical outcomes only when the document presents genuine alternatives.
- Close dates come BEFORE the resolution moment (typically a few days to two weeks), and within the next six months — near-term questions keep forecasters engaged.
- Target the claims insiders might quietly doubt: dates that have slipped before, metrics with stretch targets, dependencies nobody owns.
- NEVER draft markets about: earnings, guidance, stock price, or anything financial-disclosure adjacent; layoffs or any individual's employment, promotion, or performance; mergers and acquisitions. These are compliance-blocked.
- The rationale is one sentence to the admin explaining what decision the market informs.`;

export async function draftMarketsFromDocument(
  document: string,
  now: Date = new Date(),
): Promise<MarketDraft[]> {
  const client = getAnthropic();
  const response = await client.messages.parse({
    model: AI_MODEL,
    max_tokens: 16000,
    system: DRAFTING_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Today is ${now.toISOString().slice(0, 10)}.\n\nDraft markets from this planning document:\n\n${document}`,
      },
    ],
    output_config: { format: zodOutputFormat(DraftBatchSchema) },
  });
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("Claude returned no parseable drafts");
  return parsed.drafts.map((d) => ({
    question: d.question,
    description: d.description,
    resolutionCriteria: d.resolutionCriteria,
    resolutionSource: d.resolutionSource,
    closeAtIso: d.closeAtIso,
    outcomes: d.outcomes,
    liquidityB: PRESET_TO_B[d.liquidityPreset] ?? 100,
    rationale: d.rationale,
    blocked: checkGuardrails(d, now),
  }));
}
