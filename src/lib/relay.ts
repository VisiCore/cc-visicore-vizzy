/**
 * The hands. Vizzy's tools run on the Vizzy server, but every Cribl API call they make is sent
 * from here, in the signed-in person's browser, with that person's own Cribl sign-in.
 *
 * The server says what to send. This file decides whether to send it, and its rule does not depend
 * on trusting the server: a request that could change anything goes out only when the person
 * clicked Approve on a card in this browser showing that same request.
 */
import { api, type ChangeRequest } from './server';

export type CriblRequest = {
  request_id: string;
  method: string;
  path: string;
  content_type: string;
  body: string | null;
  approval_id: string | null;
};

export type Verdict = { send: true } | { send: false; reason: string };

/** Requests the person approved here and that have not been sent yet, by approval id. */
export type Approved = Map<string, ChangeRequest[]>;

const MAX_ANSWER_CHARS = 10_000_000;
const API_PREFIX = '/api/v1';

// POSTs that only read: they start a search, run a metrics query, preview a pipeline against sample
// events, or search a file on an Edge node. Nothing is saved by any of them.
const READ_ONLY_POSTS = [
  /^\/api\/v1\/m\/[^/]+\/search\/jobs$/,
  /^\/api\/v1\/system\/metrics\/query$/,
  /^\/api\/v1\/m\/[^/]+\/(p\/[^/]+\/)?preview$/,
  /^\/api\/v1\/w\/[^/]+\/edge\/search\/file$/,
];
const SEARCH_JOBS = READ_ONLY_POSTS[0];

// A Cribl Search query writes when one of its operators is `export` or `send`. An operator is the
// first word of the query, or the first word after a pipe or an opening bracket.
const OPERATOR = /(?:^|\||\[)\s*([A-Za-z_][A-Za-z0-9_]*)/g;
const WRITING_OPERATORS = new Set(['export', 'send']);

export function searchWrites(query: string): string[] {
  const found: string[] = [];
  for (const match of query.matchAll(OPERATOR)) {
    const operator = match[1].toLowerCase();
    if (WRITING_OPERATORS.has(operator) && !found.includes(operator)) found.push(operator);
  }
  return found;
}

// What a secret looks like on an approval card: the server shows these in place of the value.
const isMasked = (shown: unknown) =>
  typeof shown === 'string' && (shown === '<redacted>' || shown.startsWith('[secret: '));

/** Is `actual` the request body the card showed? A masked field on the card matches any value. */
export function covers(shown: unknown, actual: unknown): boolean {
  if (isMasked(shown)) return actual === null || typeof actual !== 'object';
  if (Array.isArray(shown)) {
    return Array.isArray(actual) && shown.length === actual.length && shown.every((item, i) => covers(item, actual[i]));
  }
  if (shown !== null && typeof shown === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false;
    const shownKeys = Object.keys(shown);
    const there = actual as Record<string, unknown>;
    if (shownKeys.length !== Object.keys(there).length) return false;
    return shownKeys.every((key) => key in there && covers((shown as Record<string, unknown>)[key], there[key]));
  }
  return shown === actual;
}

function parsedBody(request: CriblRequest): unknown {
  if (request.body === null) return null;
  if (!request.content_type.includes('json')) return request.body;
  try {
    return JSON.parse(request.body);
  } catch {
    return request.body;
  }
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url, 'https://cribl');
    return parsed.pathname + parsed.search;
  } catch {
    return '';
  }
}

function isSafePath(path: string): boolean {
  if (!path.startsWith(`${API_PREFIX}/`) || path.includes('\\') || path.includes('#')) return false;
  const pathname = path.split('?')[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  return !decoded.split('/').includes('..') && !pathname.includes('//');
}

/**
 * Whether to send a request, and if a change is being sent, which approved request it uses up.
 * Pure: `approved` is only read here; `consume` removes what a sent change used.
 */
export function decide(request: CriblRequest, approved: Approved): Verdict & { uses?: number } {
  const method = request.method.toUpperCase();
  if (!isSafePath(request.path)) return { send: false, reason: 'The app only sends requests to the Cribl API.' };
  if (method === 'GET' || method === 'HEAD') return { send: true };

  const pathname = request.path.split('?')[0];
  const body = parsedBody(request);

  if (request.approval_id) {
    const waiting = approved.get(request.approval_id) ?? [];
    const index = waiting.findIndex(
      (shown) => shown.method.toUpperCase() === method && pathOf(shown.url) === request.path && covers(shown.body, body),
    );
    if (index !== -1) return { send: true, uses: index };
    return {
      send: false,
      reason: 'This is not the request that was approved in this browser, so the app did not send it.',
    };
  }

  if (method === 'POST' && READ_ONLY_POSTS.some((pattern) => pattern.test(pathname))) {
    if (SEARCH_JOBS.test(pathname)) {
      const query = body !== null && typeof body === 'object' ? String((body as { query?: unknown }).query ?? '') : '';
      const writes = searchWrites(query);
      if (writes.length) {
        return { send: false, reason: `This search writes (${writes.join(', ')}), so it needs an approval.` };
      }
    }
    return { send: true };
  }

  return { send: false, reason: 'This request would change something and was not approved in this browser.' };
}

export function consume(request: CriblRequest, approved: Approved, uses: number | undefined): void {
  if (uses === undefined || !request.approval_id) return;
  const waiting = approved.get(request.approval_id);
  if (!waiting) return;
  waiting.splice(uses, 1);
  if (!waiting.length) approved.delete(request.approval_id);
}

type Answer = { status: number; content_type: string; body: string };

async function send(request: CriblRequest): Promise<Answer> {
  try {
    const response = await fetch(window.CRIBL_API_URL + request.path.slice(API_PREFIX.length), {
      method: request.method,
      headers: request.content_type ? { 'content-type': request.content_type } : {},
      body: request.body ?? undefined,
    });
    const body = await response.text();
    if (body.length > MAX_ANSWER_CHARS) {
      return { status: 0, content_type: 'text/plain', body: 'Cribl answered with more than a tool result can hold.' };
    }
    return { status: response.status, content_type: response.headers.get('content-type') ?? '', body };
  } catch (error) {
    return { status: 0, content_type: 'text/plain', body: `The browser could not reach Cribl: ${String(error)}` };
  }
}

/**
 * Handles the server's requests for one conversation. Each request is answered once, however many
 * times the stream replays it after a reconnect.
 */
export class Relay {
  readonly approved: Approved = new Map();
  private readonly seen = new Set<string>();
  private readonly conversationId: string;

  constructor(conversationId: string) {
    this.conversationId = conversationId;
  }

  /** The person clicked Approve on a card showing these requests. */
  approve(approvalId: string, requests: ChangeRequest[]): void {
    this.approved.set(approvalId, [...requests]);
  }

  async handle(request: CriblRequest): Promise<void> {
    if (this.seen.has(request.request_id)) return;
    this.seen.add(request.request_id);
    const verdict = decide(request, this.approved);
    let answer: Answer;
    if (verdict.send) {
      consume(request, this.approved, verdict.uses);
      answer = await send(request);
    } else {
      answer = { status: 0, content_type: 'text/plain', body: verdict.reason };
    }
    try {
      await api.post(`/api/conversations/${this.conversationId}/relay/${request.request_id}`, answer);
    } catch {
      // Already answered, or the tool gave up waiting: either way there is nobody to tell.
    }
  }
}
