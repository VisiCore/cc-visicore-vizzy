import { describe, expect, it } from 'vitest';
import { splitFollowups } from './followups';

describe('follow-up questions', () => {
  it('takes the block off the end of a reply and returns its lines', () => {
    const reply = 'You have 3 groups.\n\n```followups\n- Which group is busiest?\n2. Show undeployed changes\nAre any nodes unhealthy?\n```';
    expect(splitFollowups(reply)).toEqual({
      text: 'You have 3 groups.',
      followups: ['Which group is busiest?', 'Show undeployed changes', 'Are any nodes unhealthy?'],
    });
  });

  it('leaves a reply without one alone, and other code blocks too', () => {
    const reply = 'Here:\n```json\n{"a":1}\n```';
    expect(splitFollowups(reply)).toEqual({ text: reply, followups: [] });
  });

  it('hides a block that is still streaming in, and offers nothing until it closes', () => {
    expect(splitFollowups('Done.\n\n```followups\n- Which gro')).toEqual({ text: 'Done.', followups: [] });
  });

  it('keeps at most three, and drops anything too long to be a chip', () => {
    const lines = ['a?', 'b?', 'c?', 'd?', 'x'.repeat(200)].join('\n');
    expect(splitFollowups(`ok\n\`\`\`followups\n${lines}\n\`\`\``).followups).toEqual(['a?', 'b?', 'c?']);
  });
});
