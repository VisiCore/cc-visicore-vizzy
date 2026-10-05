import { LICENCE_KV_KEY, VIZZY_SERVER } from '../config';

declare global {
  interface Window {
    CRIBL_API_URL: string;
    CRIBL_BASE_PATH: string;
    getCriblUser(): Promise<CriblUser>;
  }
}

export type CriblUser = {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  initials?: string;
};

/** The server answered, and the answer was a refusal or a failure. */
export class ServerError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let who: Promise<string> | null = null;

export function criblUser(): Promise<CriblUser> {
  return window.getCriblUser();
}

/** Who is at the keyboard, as Cribl reports it. The server trusts this only inside the licence's org. */
function userHeader(): Promise<string> {
  who ??= criblUser().then((user) => {
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username;
    const claimed = JSON.stringify({ id: user.id, username: user.username, name, email: user.email ?? '' });
    const bytes = new TextEncoder().encode(claimed);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  });
  return who;
}

/**
 * One request to the Vizzy server. Cribl's proxy adds the licence key on the way out
 * (config/proxies.yml). Method, headers and body go in `init`, which is all the platform's
 * fetch forwards.
 */
export async function request(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
  const headers: Record<string, string> = { 'x-vizzy-user': await userHeader() };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(VIZZY_SERVER + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    let detail = '';
    try {
      const failure = (await response.json()) as { detail?: unknown };
      if (typeof failure.detail === 'string') detail = failure.detail;
    } catch {
      // not JSON: the status says enough
    }
    throw new ServerError(response.status, detail || `The Vizzy server answered ${response.status}.`);
  }
  return response;
}

async function json<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await request(method, path, body);
  return response.status === 204 || response.status === 202 ? (undefined as T) : ((await response.json()) as T);
}

export const api = {
  get: <T>(path: string) => json<T>('GET', path),
  post: <T>(path: string, body?: unknown) => json<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => json<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => json<T>('PATCH', path, body ?? {}),
  delete: <T>(path: string) => json<T>('DELETE', path),
};

/** Store the licence key, encrypted. It replaces any key already there. */
export async function saveLicenceKey(key: string): Promise<void> {
  const response = await fetch(`${window.CRIBL_API_URL}/kvstore/${LICENCE_KV_KEY}?encrypted=true`, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain' },
    body: key,
  });
  if (!response.ok) throw new ServerError(response.status, `Cribl could not store the key (${response.status}).`);
}

// ---- what the server sends ---------------------------------------------------------------

export type Choice = { id: string; name: string; note?: string };

export type Me = {
  user: { id: string; name: string; email: string; role: string; can_approve: boolean };
  org: { id: string; name: string };
  connections: { id: string; kind: string; name: string; writes_enabled: boolean }[];
  llm: { can_choose: boolean; model: string; models: Choice[]; effort: string; efforts: Choice[] };
};

export type ChangeRequest = { method: string; url: string; body: unknown };
export type Guidance = { cited: boolean; title: string | null } | null;

export type SavedBlock =
  | { type: 'text'; text: string }
  | {
      type: 'tool';
      tool_use_id: string;
      name: string;
      kind: string;
      status_line: string;
      is_error: boolean;
      duration_ms: number;
      approval?: {
        id: string;
        status: string;
        decided_by: string;
        preview: { requests: ChangeRequest[] };
        guidance: Guidance;
      };
    };

export type SavedMessage = {
  id: string;
  role: 'user' | 'assistant' | 'staff';
  created_at: string;
  blocks: SavedBlock[];
  author?: string;
  /** On a person's message: whether this person wrote it. */
  is_me?: boolean;
};

export type ConversationSummary = {
  id: string;
  title: string;
  updated_at: string;
  busy: boolean;
  shared: boolean;
  is_owner: boolean;
  owner_name: string;
  has_unread: boolean;
};

/** Someone in a conversation. */
export type Person = { id: string; name: string; is_owner: boolean; is_staff: boolean };

/** Someone under this licence the conversation could be shared with. */
export type Colleague = { id: string; name: string; cribl_id: string };

export type Conversation = {
  id: string;
  title: string;
  model: string | null;
  effort: string | null;
  messages: SavedMessage[];
  busy: boolean;
  participants: Person[];
  shared: boolean;
  is_owner: boolean;
  can_manage: boolean;
  escalation: Escalation | null;
};

/** A conversation handed to a VisiCore engineer, by a person here or by Vizzy itself. */
export type Escalation = {
  id: number;
  status: 'open' | 'claimed' | 'resolved';
  urgency: 'normal' | 'urgent';
  summary: string;
  raised_by: string;
  raised_by_vizzy: boolean;
  claimed_by: string | null;
  resolution_note: string | null;
  created_at: string;
};

/** Something Vizzy carries from one conversation to the next. */
export type Note = {
  id: number;
  tier: 'preference' | 'memory';
  text: string;
  created_by: string;
  created_at: string;
  verified_at: string | null;
  conversation_id: string | null;
  conversation_title: string | null;
};

export type Notes = {
  org: { id: string; name: string };
  preferences: Note[];
  memories: Note[];
  limits: { per_tier: number; max_chars: number };
  can_edit_memories: boolean;
};

export type AuditRow = {
  id: string;
  created_at: string;
  user_name: string;
  conversation_id: string;
  conversation_title: string;
  tool_name: string;
  kind: string;
  status_line: string;
  input: unknown;
  is_error: boolean;
  approval: string | null;
  approved_by: string;
  duration_ms: number;
  result_preview: string;
  /** The model request that asked for this call. Calls asked for together show the same figures. */
  tokens: { model: string; input: number; output: number; cache_read: number; cache_write: number } | null;
};

export type UsageSummary = {
  days: number;
  requests: number;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
};

export type AppSettings = {
  org: { id: string; name: string };
  licence: { hint: string; writes_enabled: boolean };
  llm_key: { hint: string; set_by: string; model: string; set_at: string; tested_at: string | null; test_ok: boolean | null } | null;
  default_model: string;
  llm_usage_30d: { visicore: number; org: number };
  /** The organization's managed credit in dollars. No limit when `limit_usd` is null; absent on an older server. */
  credit?: { limit_usd: number | null; spent_usd: number };
};

/** A Splunk or Splunk Cloud connection stored for the organization. Its credentials never come back. */
export type StoredConnection = {
  id: string;
  kind: 'splunk' | 'splunk_acs';
  name: string;
  base_url: string;
  tls_verify: boolean;
  writes_enabled: boolean;
  created_at: string;
};

export type Suggestion = { id: number; category: string; icon: string; title: string; prompt: string };
