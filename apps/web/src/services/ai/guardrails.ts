/**
 * SPEC §7 guardrails, enforced in code after generation (D19): a prompt is
 * advice, this filter is the guarantee. Deliberately conservative — a false
 * positive costs an admin an override-by-editing; a false negative costs
 * trust (or, for MNPI categories, a call from legal).
 */

const BLOCKED_CATEGORIES: { reason: string; pattern: RegExp }[] = [
  {
    reason: "Earnings/financial-guidance markets are blocked (MNPI hazard for public companies)",
    pattern: /\b(earnings|eps|stock price|share price|market cap|ipo|quarterly results|revenue guidance)\b/i,
  },
  {
    reason: "Markets on layoffs or individual employment outcomes are blocked",
    pattern: /\b(lay[- ]?offs?|reduction in force|\brif\b|headcount reduction|be (fired|terminated|promoted|demoted)|resigns?|steps? down|\bpip\b)\b/i,
  },
  {
    reason: "M&A markets are blocked",
    pattern: /\b(acquisitions?|acquires?|acquired|merger|buyout|takeover)\b/i,
  },
];

export interface DraftShape {
  question: string;
  description: string;
  resolutionCriteria: string;
  resolutionSource: string;
  closeAtIso: string;
  outcomes: string[];
}

/** Returns the list of violations; empty = publishable. */
export function checkGuardrails(draft: DraftShape, now: Date): string[] {
  const reasons: string[] = [];
  const text = `${draft.question}\n${draft.description}\n${draft.resolutionCriteria}`;
  for (const category of BLOCKED_CATEGORIES) {
    if (category.pattern.test(text)) reasons.push(category.reason);
  }
  const labels = draft.outcomes.map((o) => o.trim()).filter(Boolean);
  if (labels.length < 2 || labels.length > 10) {
    reasons.push(`Markets need 2–10 outcomes (got ${labels.length})`);
  }
  if (new Set(labels.map((l) => l.toLowerCase())).size !== labels.length) {
    reasons.push("Outcome labels must be distinct");
  }
  const closeAt = new Date(draft.closeAtIso);
  if (Number.isNaN(closeAt.getTime())) {
    reasons.push("Close date is not a valid date");
  } else if (closeAt.getTime() <= now.getTime()) {
    reasons.push("Close date must be in the future");
  }
  if (draft.question.trim().length < 10) reasons.push("Question is too short");
  if (draft.resolutionCriteria.trim().length < 10) reasons.push("Resolution criteria are too short");
  if (draft.resolutionSource.trim().length < 3) reasons.push("A resolution source is required");
  return reasons;
}
