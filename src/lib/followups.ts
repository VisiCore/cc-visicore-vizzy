/**
 * Vizzy may end a reply with a fenced block labelled `followups`: one to three questions the person
 * might ask next. The block is never shown as text; the app offers its lines as quiet chips under
 * the latest reply.
 */
const BLOCK = /\n?```followups[^\n]*\n([\s\S]*?)(?:```\s*$|$)/;
const MAX = 3;
const MAX_CHARS = 90;

export function splitFollowups(text: string): { text: string; followups: string[] } {
  const match = BLOCK.exec(text);
  if (!match) return { text, followups: [] };
  const closed = /```\s*$/.test(match[0]);
  const followups = closed
    ? match[1]
        .split('\n')
        .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
        .filter((line) => line.length > 0 && line.length <= MAX_CHARS)
        .slice(0, MAX)
    : []; // still streaming in: hide it, offer nothing yet
  return { text: text.slice(0, match.index).trimEnd(), followups };
}
