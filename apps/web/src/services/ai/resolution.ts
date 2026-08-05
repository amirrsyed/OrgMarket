import { z } from "zod/v4";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AI_MODEL, getAnthropic } from "./client";

const ResolutionCheckSchema = z.object({
  verdict: z.enum(["criteria_met", "criteria_not_met", "insufficient_evidence"]),
  recommendedOutcome: z
    .string()
    .nullable()
    .describe("Exactly one of the provided outcome labels, or null if evidence is insufficient"),
  suggestedNote: z
    .string()
    .describe("A 1–2 sentence evidence note suitable for the public resolution record"),
  reasoning: z.string().describe("How the evidence maps (or fails to map) onto the criteria"),
});

export type ResolutionCheck = z.infer<typeof ResolutionCheckSchema>;

/**
 * Checks admin-supplied evidence against the market's stated resolution
 * criteria. Advisory only — the admin resolves, never the model (D19).
 */
export async function checkResolutionEvidence(params: {
  question: string;
  resolutionCriteria: string;
  resolutionSource: string;
  outcomes: string[];
  evidence: string;
}): Promise<ResolutionCheck> {
  const client = getAnthropic();
  const response = await client.messages.parse({
    model: AI_MODEL,
    max_tokens: 16000,
    system:
      "You are the resolution assistant for an internal prediction market. Judge ONLY whether the supplied evidence satisfies the market's stated resolution criteria. Do not use outside knowledge of the company; if the evidence does not clearly settle the question against the criteria, say the evidence is insufficient. Trust in resolutions is the product — being conservative is correct.",
    messages: [
      {
        role: "user",
        content: [
          `Market question: ${params.question}`,
          `Resolution criteria: ${params.resolutionCriteria}`,
          `Stated resolution source: ${params.resolutionSource}`,
          `Possible outcomes: ${params.outcomes.join(", ")}`,
          "",
          "Evidence provided by the admin:",
          params.evidence,
        ].join("\n"),
      },
    ],
    output_config: { format: zodOutputFormat(ResolutionCheckSchema) },
  });
  // The SDK's inference collapses on nullable fields; the runtime value is
  // schema-validated by parse(), so the assertion is safe.
  const parsed = response.parsed_output as ResolutionCheck | null;
  if (!parsed) throw new Error("Claude returned no parseable resolution check");
  return parsed;
}
