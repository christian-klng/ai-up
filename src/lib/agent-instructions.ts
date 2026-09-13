/**
 * Budget for the instruction entries of an agent thread. Client-safe (no server imports) so the
 * configuration panel can show the same numbers the worker uses when it builds the system prompt.
 */

/** Instructions together are capped at this many characters (see docs/ki-agenten.md, section 2). */
export const MAX_INSTRUCTION_CHARS = 40_000;

/** Size of one instruction as it lands in the prompt – heading plus body, exactly like buildSystemPrompt renders it. */
export function instructionBlockChars(title: string, body: string): number {
  return `### ${title}\n\n${body}`.length;
}

/** Sum of the chosen instructions and whether they still fit. The panel colours the bar with this. */
export function instructionBudget(chars: number[]): { used: number; max: number; percent: number; exceeded: boolean } {
  const used = chars.reduce((a, b) => a + b, 0);
  return { used, max: MAX_INSTRUCTION_CHARS, percent: Math.min(100, Math.round((used / MAX_INSTRUCTION_CHARS) * 100)), exceeded: used > MAX_INSTRUCTION_CHARS };
}
