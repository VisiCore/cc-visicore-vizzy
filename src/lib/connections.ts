import type { StoredConnection } from './server';

/** The connections an organization stores on the Vizzy server. Cribl is not one: it is each person's own sign-in. */
export type ConnectionKind = 'splunk' | 'splunk_acs';

export const CONNECTION_KINDS: ConnectionKind[] = ['splunk', 'splunk_acs'];
export const KIND_LABELS: Record<string, string> = { cribl: 'Cribl', splunk: 'Splunk', splunk_acs: 'Splunk Cloud' };

// A Splunk Cloud admin connection is addressed by its stack name: https://admin.splunk.com/<stack>/adminconfig/v2
const ACS_STACK = /^[a-z0-9][a-z0-9-]{1,62}$/;
const ACS_URL = /^https:\/\/admin\.splunk\.com\/([^/?#]+)\/adminconfig\/v2\/?$/i;

export const acsBaseUrl = (stack: string) => `https://admin.splunk.com/${stack}/adminconfig/v2`;

/** The stack name inside a Splunk Cloud admin address, or null when the address isn't of the usual shape. */
export function acsStack(baseUrl: string): string | null {
  const stack = ACS_URL.exec(baseUrl.trim())?.[1].toLowerCase() ?? '';
  return ACS_STACK.test(stack) ? stack : null;
}

/** People paste the stack's web address as often as its name: acme-prod.splunkcloud.com is acme-prod. */
const stackFrom = (typed: string) =>
  typed.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\.splunkcloud\.com\b.*$/, '');

/** What the form holds for one connection. Credentials start empty: stored ones never come back. */
export type ConnectionDraft = {
  /** Splunk: the management address. Splunk Cloud: the stack name. */
  target: string;
  auth: 'token' | 'basic';
  token: string;
  username: string;
  password: string;
  verify: boolean;
  writes: boolean;
};

export function draftFor(kind: ConnectionKind, stored: StoredConnection | null): ConnectionDraft {
  const address = stored?.base_url ?? '';
  return {
    target: kind === 'splunk_acs' ? (acsStack(address) ?? address) : address,
    auth: 'token',
    token: '',
    username: '',
    password: '',
    verify: stored?.tls_verify ?? true,
    writes: stored?.writes_enabled ?? false,
  };
}

export function isDirty(kind: ConnectionKind, draft: ConnectionDraft, stored: StoredConnection | null): boolean {
  const clean = draftFor(kind, stored);
  return (
    draft.target.trim() !== clean.target ||
    draft.token !== '' ||
    draft.username.trim() !== '' ||
    draft.password !== '' ||
    draft.verify !== clean.verify ||
    draft.writes !== clean.writes
  );
}

export type ConnectionBody = {
  base_url: string;
  writes_enabled: boolean;
  /** Left out to keep the stored credentials. */
  secret?: Record<string, string | boolean>;
};

function address(kind: ConnectionKind, draft: ConnectionDraft, stored: StoredConnection | null): string | null {
  const typed = draft.target.trim();
  if (kind === 'splunk') return /^https:\/\/[^/\s]+/i.test(typed) ? typed : null;
  // An address VisiCore stored in another shape (a GovCloud stack, say) is kept as it is until it is retyped.
  if (stored && typed === stored.base_url) return stored.base_url;
  const stack = stackFrom(typed);
  return ACS_STACK.test(stack) ? acsBaseUrl(stack) : null;
}

/** What to send for a draft, or why it can't be sent yet. */
export function bodyFor(
  kind: ConnectionKind,
  draft: ConnectionDraft,
  stored: StoredConnection | null,
): { body: ConnectionBody } | { problem: string } {
  const base_url = address(kind, draft, stored);
  if (!base_url) {
    return {
      problem:
        kind === 'splunk'
          ? 'Enter the full address, starting with https://, for example https://splunk.example.com:8089.'
          : 'Enter just the stack name: lowercase letters, digits and hyphens, like acme-prod.',
    };
  }
  const body: ConnectionBody = { base_url, writes_enabled: draft.writes };
  const basic = kind === 'splunk' && draft.auth === 'basic';
  const fields: [string, string, string][] = basic
    ? [['username', 'username', draft.username.trim()], ['password', 'password', draft.password]]
    : [['token', 'token', draft.token.trim()]];
  const missing = fields.filter(([, , value]) => value === '');
  if (missing.length === fields.length) {
    if (!stored) return { problem: basic ? 'Enter the username and password.' : 'Enter the token.' };
    // Stored credentials are kept. The certificate setting is saved with them, so it travels alone.
    if (kind === 'splunk' && draft.verify !== stored.tls_verify) body.secret = { verify: draft.verify };
    return { body };
  }
  if (missing.length > 0) return { problem: `Enter the ${missing[0][1]} as well.` };
  body.secret = Object.fromEntries(fields.map(([name, , value]) => [name, value]));
  if (kind === 'splunk') body.secret.verify = draft.verify;
  return { body };
}
