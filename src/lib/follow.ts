import { readEvents, type ServerEvent } from './sse';
import { request, ServerError } from './server';

// Cribl's proxy ends any request at 120 s (config/proxies.yml). Reopen before that on our own
// terms: every connect starts with `hello` and a replay of the turn in flight, so nothing is lost.
const REOPEN_MS = 100_000;
// The server sends a keep-alive every 20 s. Nothing at all for this long means the connection is dead.
const SILENCE_MS = 50_000;
const RETRY_MS = [1000, 2000, 4000, 8000, 15000];

type Handlers = {
  onEvent: (event: ServerEvent) => void;
  /** The connection dropped; another attempt is on its way. */
  onDown: () => void;
  /** The conversation no longer exists for this person, or the licence no longer opens it. */
  onGone: (status: number) => void;
};

/** Follow one conversation's live events until `close()` is called. */
export function followConversation(id: string, { onEvent, onDown, onGone }: Handlers): { close: () => void } {
  let closed = false;
  let controller: AbortController | null = null;
  let attempt = 0;
  let retryTimer = 0;

  async function connect() {
    retryTimer = 0;
    controller = new AbortController();
    const current = controller;
    let planned = false;
    let silence = 0;
    const armSilence = () => {
      clearTimeout(silence);
      silence = window.setTimeout(() => current.abort(), SILENCE_MS);
    };
    const reopen = window.setTimeout(() => {
      planned = true;
      current.abort();
    }, REOPEN_MS);
    try {
      armSilence();
      const response = await request('GET', `/api/conversations/${id}/events`, undefined, current.signal);
      await readEvents(
        response,
        (event) => {
          if (closed) return;
          if (event.event === 'hello') attempt = 0;
          onEvent(event);
        },
        armSilence,
      );
    } catch (error) {
      if (closed) return;
      if (error instanceof ServerError && (error.status === 404 || error.status === 401)) {
        close();
        onGone(error.status);
        return;
      }
      // Anything else (network, 5xx, our own aborts): try again below.
    } finally {
      clearTimeout(silence);
      clearTimeout(reopen);
      controller = null;
    }
    if (closed) return;
    if (planned) {
      void connect();
      return;
    }
    onDown();
    const wait = RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)];
    retryTimer = window.setTimeout(connect, wait + Math.random() * 400);
  }

  function retryNow() {
    if (closed || !retryTimer || document.hidden) return;
    clearTimeout(retryTimer);
    void connect();
  }

  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(retryTimer);
    window.removeEventListener('online', retryNow);
    document.removeEventListener('visibilitychange', retryNow);
    controller?.abort();
  }

  window.addEventListener('online', retryNow);
  document.addEventListener('visibilitychange', retryNow);
  void connect();
  return { close };
}
