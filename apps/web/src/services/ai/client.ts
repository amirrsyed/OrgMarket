import Anthropic from "@anthropic-ai/sdk";

/**
 * AI layer configuration (D19). Absent credentials degrade gracefully: AI
 * surfaces show a "not configured" notice and everything else works.
 */
export const AI_MODEL = process.env.AI_MODEL ?? "claude-opus-5";

export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let singleton: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!isAiConfigured()) {
    throw new Error("AI is not configured — set ANTHROPIC_API_KEY");
  }
  singleton ??= new Anthropic();
  return singleton;
}
