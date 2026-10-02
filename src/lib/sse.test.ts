import { describe, expect, it } from 'vitest';
import { createEventParser } from './sse';

describe('event stream parsing', () => {
  it('reads events split across chunks and skips keep-alives', () => {
    const parse = createEventParser();
    expect(parse('event: hello\ndata: {"busy":')).toEqual([]);
    expect(parse('false}\n\n: keep-alive\n\nevent: text\ndata: {"delta":"Hi"}\n\n')).toEqual([
      { event: 'hello', data: { busy: false } },
      { event: 'text', data: { delta: 'Hi' } },
    ]);
  });

  it('handles CRLF and ignores a frame that is not JSON', () => {
    const parse = createEventParser();
    expect(parse('event: x\r\ndata: nope\r\n\r\nevent: done\r\ndata: {"stopped":false}\r\n\r\n')).toEqual([
      { event: 'done', data: { stopped: false } },
    ]);
  });
});
