import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Modal, PasswordField, SelectField, Switch, Tag, Text, Toast } from '@capra/core';
import { ConnectionCard, type ConnectionTest } from '../components/ConnectionCard';
import { Page } from '../components/Page';
import { useAccount } from '../lib/account';
import {
  CONNECTION_KINDS,
  KIND_LABELS,
  bodyFor,
  draftFor,
  isDirty,
  type ConnectionBody,
  type ConnectionDraft,
  type ConnectionKind,
} from '../lib/connections';
import { exactTime, usd } from '../lib/format';
import { api, request, saveLicenceKey, ServerError, type AppSettings, type StoredConnection } from '../lib/server';
import { readEvents } from '../lib/sse';

type TestResult = { ok: boolean; text: string };

type ByKind<T> = Partial<Record<ConnectionKind, T>>;

const failure = (error: unknown, fallback: string) => (error instanceof ServerError ? error.message : fallback);

const draftsFor = (stored: StoredConnection[]) =>
  Object.fromEntries(CONNECTION_KINDS.map((kind) => [kind, draftFor(kind, of(stored, kind))])) as Record<ConnectionKind, ConnectionDraft>;

const of = (stored: StoredConnection[], kind: ConnectionKind) => stored.find((connection) => connection.kind === kind) ?? null;

/**
 * Setup and configuration in one form: the licence key (the only thing the app needs to work),
 * what Vizzy can reach (Cribl through each person's own sign-in, Splunk through a stored
 * connection) and whether it may ask for changes there, and the organization's own Anthropic key.
 */
export function SettingsPage() {
  const { account, reload } = useAccount();
  const ready = account.status === 'ready';
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [licenceKey, setLicenceKey] = useState('');
  const [allowChanges, setAllowChanges] = useState(false);
  const [anthropicKey, setAnthropicKey] = useState('');
  const [model, setModel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [connection, setConnection] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [keyTest, setKeyTest] = useState<TestResult | null>(null);
  // null: this Vizzy server does not keep connections for the app, so the cards are left out.
  const [connections, setConnections] = useState<StoredConnection[] | null>(null);
  const [drafts, setDrafts] = useState(() => draftsFor([]));
  const [editing, setEditing] = useState<ConnectionKind[]>([]);
  const [connectionProblems, setConnectionProblems] = useState<ByKind<string>>({});
  const [connectionTests, setConnectionTests] = useState<ByKind<ConnectionTest>>({});
  const [removing, setRemoving] = useState<ConnectionKind | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const loaded = await api.get<AppSettings>('/api/app/settings');
      setSettings(loaded);
      setAllowChanges(loaded.licence.writes_enabled);
      setModel(loaded.llm_key?.model ?? null);
    } catch {
      setSettings(null);
    }
  }, []);

  const load = useCallback(async () => {
    const [stored] = await Promise.all([api.get<StoredConnection[]>('/api/app/connections').catch(() => null), loadSettings()]);
    setConnections(stored);
    setDrafts(draftsFor(stored ?? []));
    setEditing([]);
  }, [loadSettings]);

  useEffect(() => {
    if (ready) void load();
    else {
      setSettings(null);
      setConnections(null);
    }
  }, [ready, load]);

  const reset = () => {
    setLicenceKey('');
    setAnthropicKey('');
    setProblem('');
    setAllowChanges(settings?.licence.writes_enabled ?? false);
    setModel(settings?.llm_key?.model ?? null);
    setDrafts(draftsFor(connections ?? []));
    setEditing([]);
    setConnectionProblems({});
  };

  const changed = CONNECTION_KINDS.filter((kind) => connections !== null && isDirty(kind, drafts[kind], of(connections, kind)));

  const dirty =
    licenceKey.trim() !== '' ||
    anthropicKey.trim() !== '' ||
    changed.length > 0 ||
    (settings !== null && (allowChanges !== settings.licence.writes_enabled || model !== (settings.llm_key?.model ?? null)));

  const testStored = async (kind: ConnectionKind) => {
    setConnectionTests((tests) => ({ ...tests, [kind]: 'running' }));
    let result: ConnectionTest;
    try {
      const tested = await api.post<{ ok: boolean; detail: string }>(`/api/app/connections/${kind}/test`);
      result = { ok: tested.ok, text: `${tested.ok ? 'Connected' : 'Not working'}. ${tested.detail}` };
    } catch (error) {
      result = { ok: false, text: failure(error, "Couldn't run the test.") };
    }
    setConnectionTests((tests) => ({ ...tests, [kind]: result }));
  };

  /** Send each changed connection. One the server refuses says why on its own card; the others still save. */
  const saveConnections = async (bodies: Map<ConnectionKind, ConnectionBody>): Promise<boolean> => {
    let allSaved = true;
    for (const [kind, body] of bodies) {
      try {
        const saved = await api.put<StoredConnection>(`/api/app/connections/${kind}`, body);
        setConnections((stored) => [...(stored ?? []).filter((connection) => connection.kind !== kind), saved]);
        setDrafts((current) => ({ ...current, [kind]: draftFor(kind, saved) }));
        setEditing((open) => open.filter((other) => other !== kind));
        // Straight away: a typo in the address or the token shows now, not in the middle of a conversation.
        void testStored(kind);
      } catch (error) {
        allSaved = false;
        setConnectionProblems((problems) => ({ ...problems, [kind]: failure(error, "Couldn't save the connection.") }));
      }
    }
    return allSaved;
  };

  const save = async () => {
    // Nothing is sent until every connection being changed is complete.
    const bodies = new Map<ConnectionKind, ConnectionBody>();
    const incomplete: ByKind<string> = {};
    if (!licenceKey.trim()) {
      for (const kind of changed) {
        const built = bodyFor(kind, drafts[kind], of(connections ?? [], kind));
        if ('problem' in built) incomplete[kind] = built.problem;
        else bodies.set(kind, built.body);
      }
    }
    setConnectionProblems(incomplete);
    if (Object.keys(incomplete).length > 0) return;

    setSaving(true);
    setProblem('');
    try {
      if (licenceKey.trim()) {
        await saveLicenceKey(licenceKey.trim());
        setLicenceKey('');
        await reload();
        // The new key decides which organization this is: the rest of the form no longer applies.
        Toast.success('Licence key saved.');
        return;
      }
      if (settings && allowChanges !== settings.licence.writes_enabled) {
        await api.put('/api/app/settings', { writes_enabled: allowChanges });
      }
      const newKey = anthropicKey.trim();
      if (newKey || (settings?.llm_key && model !== settings.llm_key.model)) {
        await api.put('/api/app/llm-key', { key: newKey || undefined, model: model ?? undefined });
        setAnthropicKey('');
        if (newKey) await testKey();
      }
      if (await saveConnections(bodies)) {
        await Promise.all([load(), reload()]);
        Toast.success('Settings saved.');
      } else {
        // What did save is shown as saved; the connection that didn't keeps what was typed, beside the reason.
        await Promise.all([loadSettings(), reload()]);
      }
    } catch (error) {
      setProblem(failure(error, "Couldn't save the settings."));
    } finally {
      setSaving(false);
    }
  };

  const onSave = () => {
    if (licenceKey.trim() && ready) setConfirmReplace(true); // replacing a key that works: say so first
    else void save();
  };

  /** Ask the server for a few events a second apart, and see whether they arrive that way. */
  const testConnection = async () => {
    setTesting(true);
    setConnection(null);
    const arrivals: number[] = [];
    let org = '';
    try {
      const response = await request('GET', '/api/app/ping');
      await readEvents(response, ({ data }) => {
        arrivals.push(performance.now());
        org = String((data as { org?: string }).org ?? org);
      });
      const spread = arrivals.length > 1 ? arrivals[arrivals.length - 1] - arrivals[0] : 0;
      setConnection(
        spread > 2000
          ? { ok: true, text: `Connected as ${org}. Replies will appear as Vizzy writes them.` }
          : { ok: false, text: `Connected as ${org}, but Cribl delivered the whole stream at once. Live replies will not work until that is resolved.` },
      );
    } catch (error) {
      setConnection({ ok: false, text: failure(error, 'The Vizzy server could not be reached.') });
    } finally {
      setTesting(false);
    }
  };

  const testKey = async () => {
    try {
      const result = await api.post<{ ok: boolean; detail: string }>('/api/app/llm-key/test');
      setKeyTest({ ok: result.ok, text: result.ok ? 'Anthropic accepted the key.' : result.detail || 'Anthropic did not accept the key.' });
    } catch (error) {
      setKeyTest({ ok: false, text: failure(error, "Couldn't test the key.") });
    }
  };

  const removeKey = async () => {
    setConfirmRemove(false);
    try {
      await api.delete('/api/app/llm-key');
      setKeyTest(null);
      await Promise.all([load(), reload()]);
      Toast.success('Anthropic key removed.');
    } catch (error) {
      setProblem(failure(error, "Couldn't remove the key."));
    }
  };

  const removeConnection = async () => {
    const kind = removing;
    setRemoving(null);
    if (!kind) return;
    try {
      await api.delete(`/api/app/connections/${kind}`);
      setConnectionTests((tests) => ({ ...tests, [kind]: undefined }));
      setConnectionProblems((problems) => ({ ...problems, [kind]: undefined }));
      await Promise.all([load(), reload()]);
      Toast.success(`${KIND_LABELS[kind]} connection removed.`);
    } catch (error) {
      setConnectionProblems((problems) => ({ ...problems, [kind]: failure(error, "Couldn't remove the connection.") }));
    }
  };

  const removingFrom = removing && connections ? of(connections, removing) : null;
  const llmKey = settings?.llm_key ?? null;
  const models = account.status === 'ready' ? account.me.llm.models : [];
  const usage = settings?.llm_usage_30d;
  const credit = settings?.credit && settings.credit.limit_usd !== null ? { limit: settings.credit.limit_usd, spent: settings.credit.spent_usd } : null;
  const creditSpent = credit !== null && credit.spent >= credit.limit;

  return (
    <Page open title="Settings" description="How this Cribl organization uses Vizzy.">
      {problem && <div className="span-12"><Alert appearance="danger" layout="section">{problem}</Alert></div>}

      <div className="span-8 form">
        <Card>
          <Card.Header>
            <Card.Title>Licence</Card.Title>
            <Card.Description>The key VisiCore issued to your organization. It is all the app needs to work.</Card.Description>
          </Card.Header>
          <Card.Content>
            <div className="form-fields">
              <PasswordField
                label="Licence key"
                placeholder="vzl_…"
                value={licenceKey}
                onChange={setLicenceKey}
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
                helperText={
                  settings
                    ? `A key ending in ${settings.licence.hint} is in use for ${settings.org.name}. Enter another to replace it.`
                    : 'Stored encrypted in Cribl. It is never shown again after it is saved.'
                }
              />
              {ready && (
                <div className="form-row">
                  <Button pending={testing} onClick={() => void testConnection()}>Test connection</Button>
                  {connection && <Text color={connection.ok ? 'success' : 'attention'}>{connection.text}</Text>}
                </div>
              )}
            </div>
          </Card.Content>
        </Card>

        {settings && (
          <>
            <Card>
              <Card.Header>
                <Card.Title>Cribl</Card.Title>
                <Card.Description>
                  Vizzy reaches Cribl through each person's own sign-in, from their browser, so there is nothing to connect and no
                  Cribl credentials are stored. It never changes anything without a person approving the exact request. This
                  decides whether it may ask at all.
                </Card.Description>
                <Card.Action>
                  <Tag color="success">Connected</Tag>
                </Card.Action>
              </Card.Header>
              <Card.Content>
                <label className="toolbar-switch">
                  <Switch aria-label="Allow changes in Cribl, with approval" checked={allowChanges} onChange={(event) => setAllowChanges(event.target.checked)} />
                  <Text>Allow changes, with approval</Text>
                </label>
              </Card.Content>
            </Card>

            {connections !== null &&
              CONNECTION_KINDS.map((kind) => (
                <ConnectionCard
                  key={kind}
                  kind={kind}
                  stored={of(connections, kind)}
                  draft={drafts[kind]}
                  editing={editing.includes(kind)}
                  problem={connectionProblems[kind]}
                  test={connectionTests[kind]}
                  onChange={(draft) => setDrafts((current) => ({ ...current, [kind]: draft }))}
                  onEdit={() => setEditing((open) => [...open, kind])}
                  onTest={() => void testStored(kind)}
                  onRemove={() => setRemoving(kind)}
                />
              ))}

            <Card>
              <Card.Header>
                <Card.Title>Anthropic key</Card.Title>
                <Card.Description>
                  {llmKey
                    ? `Conversations run on your organization's own key ending in ${llmKey.hint}, added by ${llmKey.set_by} on ${exactTime(llmKey.set_at)}. Anthropic bills your account.`
                    : "Conversations run on VisiCore's managed credits. Add your organization's own Anthropic API key to be billed by Anthropic directly and to choose the model."}
                </Card.Description>
              </Card.Header>
              <Card.Content>
                <div className="form-fields">
                  <PasswordField
                    label={llmKey ? 'Replace the key' : 'API key'}
                    placeholder="sk-ant-…"
                    value={anthropicKey}
                    onChange={setAnthropicKey}
                    autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
                    helperText="Sent to the Vizzy server and stored encrypted there. It is never shown again."
                  />
                  {llmKey && models.length > 0 && (
                    <SelectField
                      label="Model"
                      helperText="The default for new conversations. Each conversation can choose its own."
                      items={models.map((option) => ({ id: option.id, label: option.name }))}
                      value={model}
                      onChange={(value) => setModel(value === null ? null : String(value))}
                    />
                  )}
                  {llmKey && (
                    <div className="form-row">
                      <Button onClick={() => void testKey()}>Test key</Button>
                      <Button appearance="danger" onClick={() => setConfirmRemove(true)}>Remove key</Button>
                      {keyTest && <Text color={keyTest.ok ? 'success' : 'attention'}>{keyTest.text}</Text>}
                    </div>
                  )}
                  {credit && (
                    <Text color={creditSpent ? 'attention' : 'subtle'}>
                      {creditSpent
                        ? `Your organization has used its ${usd(credit.limit)} of managed credit. Add your own Anthropic API key above to keep going, or ask VisiCore for more.`
                        : `Managed credit: ${usd(Math.min(credit.spent, credit.limit))} used of ${usd(credit.limit)}.`}
                    </Text>
                  )}
                  {usage && (
                    <Text color="subtle">
                      Tokens in the last 30 days: {usage.org.toLocaleString()} on your own key, {usage.visicore.toLocaleString()} on
                      VisiCore's managed credits.
                    </Text>
                  )}
                </div>
              </Card.Content>
            </Card>
          </>
        )}

        <div className="form-actions">
          <Button disabled={(!dirty && editing.length === 0) || saving} onClick={reset}>Cancel</Button>
          <Button variant="primary" disabled={!dirty} pending={saving} onClick={onSave}>Save</Button>
        </div>
      </div>

      <Modal
        isOpen={confirmReplace}
        size="sm"
        title="Replace the licence key?"
        confirmButtonText="Replace key"
        onClose={() => setConfirmReplace(false)}
        onConfirm={() => {
          setConfirmReplace(false);
          void save();
        }}
      >
        <Text>
          The key in use{settings ? ` (ending in ${settings.licence.hint})` : ''} will be overwritten for everyone who uses this app.
          The old key cannot be read back from Cribl. If the new key belongs to another organization, its conversations and audit
          log are the ones this app will show.
        </Text>
      </Modal>

      <Modal
        isOpen={removing !== null}
        size="sm"
        title={removing ? `Remove the ${KIND_LABELS[removing]} connection?` : ''}
        confirmButtonText="Remove connection"
        onClose={() => setRemoving(null)}
        onConfirm={() => void removeConnection()}
      >
        <Text>
          Vizzy loses access to {removingFrom?.base_url ?? 'this environment'} for everyone who uses this app, and the stored
          credentials are deleted from the Vizzy server. This cannot be undone: to connect again, the credentials have to be
          entered again.
        </Text>
      </Modal>

      <Modal
        isOpen={confirmRemove}
        size="sm"
        title="Remove the Anthropic key?"
        confirmButtonText="Remove key"
        onClose={() => setConfirmRemove(false)}
        onConfirm={() => void removeKey()}
      >
        <Text>
          The key{llmKey ? ` ending in ${llmKey.hint}` : ''} will be deleted from the Vizzy server and cannot be recovered. Conversations
          go back to VisiCore's managed credits and the default model.
        </Text>
      </Modal>
    </Page>
  );
}
