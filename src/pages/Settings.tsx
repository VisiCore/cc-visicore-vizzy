import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Modal, PasswordField, SelectField, Switch, Text, Toast } from '@capra/core';
import { Page } from '../components/Page';
import { useAccount } from '../lib/account';
import { exactTime } from '../lib/format';
import { api, request, saveLicenceKey, ServerError, type AppSettings } from '../lib/server';
import { readEvents } from '../lib/sse';

type TestResult = { ok: boolean; text: string };

const failure = (error: unknown, fallback: string) => (error instanceof ServerError ? error.message : fallback);

/**
 * Setup and configuration in one form: the licence key (the only thing the app needs to work),
 * whether Vizzy may ask for changes, and the organization's own Anthropic key if it has one.
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

  const load = useCallback(async () => {
    try {
      const loaded = await api.get<AppSettings>('/api/app/settings');
      setSettings(loaded);
      setAllowChanges(loaded.licence.writes_enabled);
      setModel(loaded.llm_key?.model ?? null);
    } catch {
      setSettings(null);
    }
  }, []);

  useEffect(() => {
    if (ready) void load();
    else setSettings(null);
  }, [ready, load]);

  const reset = () => {
    setLicenceKey('');
    setAnthropicKey('');
    setProblem('');
    setAllowChanges(settings?.licence.writes_enabled ?? false);
    setModel(settings?.llm_key?.model ?? null);
  };

  const dirty =
    licenceKey.trim() !== '' ||
    anthropicKey.trim() !== '' ||
    (settings !== null && (allowChanges !== settings.licence.writes_enabled || model !== (settings.llm_key?.model ?? null)));

  const save = async () => {
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
      await Promise.all([load(), reload()]);
      Toast.success('Settings saved.');
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

  const llmKey = settings?.llm_key ?? null;
  const models = account.status === 'ready' ? account.me.llm.models : [];
  const usage = settings?.llm_usage_30d;

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
                <Card.Title>Changes</Card.Title>
                <Card.Description>
                  Vizzy never changes anything without a person approving the exact request. This decides whether it may ask at all.
                </Card.Description>
              </Card.Header>
              <Card.Content>
                <label className="toolbar-switch">
                  <Switch aria-label="Allow changes, with approval" checked={allowChanges} onChange={(event) => setAllowChanges(event.target.checked)} />
                  <Text>Allow changes, with approval</Text>
                </label>
              </Card.Content>
            </Card>

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
          <Button disabled={!dirty || saving} onClick={reset}>Cancel</Button>
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
