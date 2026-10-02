/** One server-sent event. `data` is the parsed JSON payload. */
export type ServerEvent = { event: string; data: unknown };

/**
 * Feed text as it arrives; get back the events that are complete so far. Comment lines (the
 * server's keep-alives) produce no event. Kept apart from the network so it can be tested.
 */
export function createEventParser(): (chunk: string) => ServerEvent[] {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.replace(/\r\n/g, '\n');
    const events: ServerEvent[] = [];
    let end = buffer.indexOf('\n\n');
    while (end !== -1) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length) {
        try {
          events.push({ event, data: JSON.parse(data.join('\n')) });
        } catch {
          // A frame that is not JSON is not one of ours; skip it rather than stop the stream.
        }
      }
      end = buffer.indexOf('\n\n');
    }
    return events;
  };
}

/**
 * Read an event stream to its end. EventSource is not available to apps (the platform only
 * proxies fetch), so this reads the response body directly.
 */
export async function readEvents(
  response: Response,
  onEvent: (event: ServerEvent) => void,
  onActivity?: () => void,
): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parse = createEventParser();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    onActivity?.();
    for (const event of parse(decoder.decode(value, { stream: true }))) onEvent(event);
  }
}
