import { Alert, Button, Card, Checkbox, PasswordField, Radio, RadioGroup, Switch, Tag, Text, TextField } from '@capra/core';
import { KIND_LABELS, acsBaseUrl, acsStack, type ConnectionDraft, type ConnectionKind } from '../lib/connections';
import { exactTime } from '../lib/format';
import type { StoredConnection } from '../lib/server';

export type ConnectionTest = 'running' | { ok: boolean; text: string };

type ConnectionCardProps = {
  kind: ConnectionKind;
  stored: StoredConnection | null;
  draft: ConnectionDraft;
  /** The address and credential fields are showing. */
  editing: boolean;
  problem?: string;
  test?: ConnectionTest;
  onChange: (draft: ConnectionDraft) => void;
  onEdit: () => void;
  onTest: () => void;
  onRemove: () => void;
};

const NOT_CONNECTED: Record<ConnectionKind, string> = {
  splunk:
    "Connect your Splunk so Vizzy can work in it beside Cribl. The Vizzy server calls Splunk's management port with the credentials entered here, the same for everyone who uses this app, not with each person's own Splunk sign-in.",
  splunk_acs:
    "Connect a Splunk Cloud stack's Admin Config Service so Vizzy can manage its indexes, HEC tokens, users and roles, apps and IP allowlists. This is separate from the Splunk connection.",
};

function connected(kind: ConnectionKind, stored: StoredConnection): string {
  const since = `Connected ${exactTime(stored.created_at)}.`;
  if (kind === 'splunk_acs') {
    return `Vizzy administers the Splunk Cloud stack ${acsStack(stored.base_url) ?? stored.base_url} through Splunk's Admin Config Service. ${since}`;
  }
  const unverified = stored.tls_verify ? '' : ' Its TLS certificate is not verified.';
  return `The Vizzy server reaches Splunk at ${stored.base_url} with the stored credentials, the same for everyone who uses this app.${unverified} ${since}`;
}

/**
 * One of the organization's stored connections: where it points, whether Vizzy may ask for changes
 * there, and the form to connect or change it. Stored credentials are never shown; the form only
 * sends new ones.
 */
export function ConnectionCard({ kind, stored, draft, editing, problem, test, onChange, onEdit, onTest, onRemove }: ConnectionCardProps) {
  const label = KIND_LABELS[kind];
  const set = (change: Partial<ConnectionDraft>) => onChange({ ...draft, ...change });
  const keep = stored ? ' Leave it empty to keep the one stored.' : '';
  const stack = draft.target.trim().toLowerCase();
  const result = test && test !== 'running' ? test : null;

  return (
    <Card>
      <Card.Header>
        <Card.Title>{label}</Card.Title>
        <Card.Description>{stored ? connected(kind, stored) : NOT_CONNECTED[kind]}</Card.Description>
        <Card.Action>
          <Tag color={stored ? 'success' : 'default'}>{stored ? 'Connected' : 'Not connected'}</Tag>
        </Card.Action>
      </Card.Header>
      <Card.Content>
        <div className="form-fields">
          {problem && <Alert appearance="danger" layout="section">{problem}</Alert>}

          {editing && (
            <>
              {kind === 'splunk' ? (
                <TextField
                  label="Address"
                  placeholder="https://splunk.example.com:8089"
                  value={draft.target}
                  onChange={(target) => set({ target })}
                  autoComplete="off"
                  helperText="Splunk's management port, usually 8089. The Vizzy server makes the calls, so the address has to be reachable from the internet."
                />
              ) : (
                <TextField
                  label="Stack name"
                  placeholder="acme-prod"
                  value={draft.target}
                  onChange={(target) => set({ target })}
                  autoComplete="off"
                  helperText={
                    /^[a-z0-9][a-z0-9-]{1,62}$/.test(stack)
                      ? `Vizzy will connect to ${acsBaseUrl(stack)}`
                      : "The first part of the stack's address: acme-prod for acme-prod.splunkcloud.com."
                  }
                />
              )}

              {kind === 'splunk' && (
                <div className="form-group">
                  <Text variant="body-sm-normal" color="subtle">Sign in with</Text>
                  <RadioGroup
                    aria-label="Sign in with"
                    name="splunk-auth"
                    value={draft.auth}
                    onChange={(event) => set({ auth: event.target.value === 'basic' ? 'basic' : 'token' })}
                  >
                    <Radio value="token">Token</Radio>
                    <Radio value="basic">Username and password</Radio>
                  </RadioGroup>
                </div>
              )}

              {kind === 'splunk' && draft.auth === 'basic' ? (
                <>
                  <TextField
                    label="Username"
                    value={draft.username}
                    onChange={(username) => set({ username })}
                    autoComplete="off"
                    data-1p-ignore
                    data-lpignore="true"
                  />
                  <PasswordField
                    label="Password"
                    value={draft.password}
                    onChange={(password) => set({ password })}
                    autoComplete="new-password"
                    data-1p-ignore
                    data-lpignore="true"
                    helperText={`Sent to the Vizzy server and stored encrypted there. It is never shown again.${stored ? ' Leave both empty to keep the ones stored.' : ''}`}
                  />
                </>
              ) : (
                <PasswordField
                  label={kind === 'splunk_acs' ? 'Admin token' : 'Token'}
                  value={draft.token}
                  onChange={(token) => set({ token })}
                  autoComplete="new-password"
                  data-1p-ignore
                  data-lpignore="true"
                  helperText={
                    kind === 'splunk_acs'
                      ? `A Splunk Cloud authentication token for a user with the sc_admin role, created in Splunk Web under Settings > Tokens. Stored encrypted on the Vizzy server and never shown again.${keep}`
                      : `A Splunk authentication token, created in Splunk Web under Settings > Tokens. Stored encrypted on the Vizzy server and never shown again.${keep}`
                  }
                />
              )}

              {kind === 'splunk' && (
                <div className="form-group">
                  <Checkbox checked={draft.verify} onChange={(event) => set({ verify: event.target.checked })}>
                    Verify the TLS certificate
                  </Checkbox>
                  <Text variant="body-sm-normal" color="subtle">Turn off only for a self-signed certificate you trust.</Text>
                </div>
              )}
            </>
          )}

          {(stored || editing) && (
            <label className="toolbar-switch">
              <Switch
                aria-label={`Allow changes in ${label}, with approval`}
                checked={draft.writes}
                onChange={(event) => set({ writes: event.target.checked })}
              />
              <Text>Allow changes, with approval</Text>
            </label>
          )}

          {!editing && (
            <div className="form-row">
              {stored ? (
                <>
                  <Button pending={test === 'running'} onClick={onTest}>Test connection</Button>
                  <Button onClick={onEdit}>Edit</Button>
                  <Button appearance="danger" onClick={onRemove}>Remove</Button>
                </>
              ) : (
                <Button onClick={onEdit}>{`Connect ${label}`}</Button>
              )}
            </div>
          )}
          {result && <Text color={result.ok ? 'success' : 'attention'}>{result.text}</Text>}
        </div>
      </Card.Content>
    </Card>
  );
}
