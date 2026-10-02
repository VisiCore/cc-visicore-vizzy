import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, defineColumns, Drawer, EmptyState, Switch, Table, Tag, Text, TextField } from '@capra/core';
import { Reload } from '@capra/icons';
import { Page } from '../components/Page';
import { useAccount } from '../lib/account';
import { compact, duration, exactTime, modelName, when } from '../lib/format';
import { api, ServerError, type AuditRow, type UsageSummary } from '../lib/server';
import { useTheme } from '../lib/theme';

// Everything the model read for a step: new input, plus what was read from or written to the prompt cache.
const tokensIn = (tokens: NonNullable<AuditRow['tokens']>) => tokens.input + tokens.cache_read + tokens.cache_write;

const outcome = (row: AuditRow) =>
  row.approval === 'rejected' || row.approval === 'expired' ? 'not applied' : row.is_error ? 'error' : 'ok';

// The tool's name opens the call's details, as the first link in a row does on any Capra list page.
const columnsFor = (onOpen: (row: AuditRow) => void) => defineColumns<AuditRow>([
  {
    id: 'tool_name',
    label: 'Tool',
    render: (value, row) => <Button variant="tertiary" size="sm" onClick={() => onOpen(row)}>{value}</Button>,
  },
  {
    id: 'kind',
    label: 'Type',
    render: (value) => <Tag size="sm" color={value === 'write' ? 'warning' : 'default'}>{value === 'write' ? 'change' : value}</Tag>,
  },
  { id: 'status_line', label: 'Activity' },
  { id: 'duration_ms', label: 'Duration', render: (value) => <Text>{duration(value) || '--'}</Text> },
  {
    id: 'tokens',
    label: 'Step tokens',
    render: (value) => <Text>{value ? `${compact(tokensIn(value))} in · ${compact(value.output)} out` : '--'}</Text>,
  },
  {
    id: 'is_error',
    label: 'Result',
    render: (_value, row) => {
      const result = outcome(row);
      return <Tag size="sm" color={result === 'ok' ? 'success' : result === 'error' ? 'danger' : 'default'}>{result}</Tag>;
    },
  },
  { id: 'created_at', label: 'Time', render: (value) => <Text>{when(value)}</Text> },
  { id: 'user_name', label: 'User' },
]);

/** Every tool call Vizzy made here, newest first. The record is kept by the Vizzy server and cannot be edited. */
export function AuditPage() {
  const { account } = useAccount();
  const theme = useTheme();
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [problem, setProblem] = useState('');
  const [filter, setFilter] = useState('');
  const [changesOnly, setChangesOnly] = useState(false);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [open, setOpen] = useState<AuditRow | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const ready = account.status === 'ready';
  const columns = useMemo(() => columnsFor(setOpen), []);
  const visible = useMemo(() => columns.map((column) => column.id), [columns]);

  const load = useCallback(async () => {
    setProblem('');
    try {
      const [calls, spent] = await Promise.all([
        api.get<AuditRow[]>('/api/audit?limit=200'),
        api.get<UsageSummary>('/api/usage').catch(() => null),
      ]);
      setRows(calls);
      setUsage(spent);
    } catch (error) {
      setRows((current) => current ?? []);
      setProblem(error instanceof ServerError ? error.message : "Couldn't load the audit log.");
    }
  }, []);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  const shown = useMemo(() => {
    const words = filter.trim().toLowerCase();
    return (rows ?? []).filter(
      (row) =>
        (!changesOnly || row.kind === 'write') &&
        (!errorsOnly || row.is_error) &&
        (!words || `${row.tool_name} ${row.status_line} ${row.user_name} ${row.conversation_title}`.toLowerCase().includes(words)),
    );
  }, [rows, filter, changesOnly, errorsOnly]);

  const total = rows?.length ?? 0;
  const changes = rows?.filter((row) => row.kind === 'write').length ?? 0;
  const errors = rows?.filter((row) => row.is_error).length ?? 0;

  return (
    <Page
      title="Audit log"
      description="Every tool call Vizzy has made for you here, newest first."
      actions={<Button leadingIcon={Reload} onClick={() => void load()}>Refresh</Button>}
    >
      <Metric label="Tool calls" value={total.toLocaleString()} />
      <Metric label="Changes requested" value={changes.toLocaleString()} />
      <Metric label="Errors" value={errors.toLocaleString()} />
      <Metric
        label="Tokens, last 30 days"
        value={usage ? compact(usage.input + usage.cache_read + usage.cache_write + usage.output) : '--'}
        note={usage ? `${compact(usage.input + usage.cache_read + usage.cache_write)} in · ${compact(usage.output)} out · ${usage.requests.toLocaleString()} model requests` : undefined}
      />

      {problem && <div className="span-12"><Alert appearance="danger" layout="section">{problem}</Alert></div>}

      <div className="span-12 toolbar">
        <div className="toolbar-filter">
          <TextField aria-label="Filter" placeholder="Filter by tool, activity or conversation" value={filter} onChange={setFilter} />
        </div>
        <label className="toolbar-switch">
          <Switch aria-label="Changes only" checked={changesOnly} onChange={(event) => setChangesOnly(event.target.checked)} />
          <Text>Changes only</Text>
        </label>
        <label className="toolbar-switch">
          <Switch aria-label="Errors only" checked={errorsOnly} onChange={(event) => setErrorsOnly(event.target.checked)} />
          <Text>Errors only</Text>
        </label>
      </div>

      <div className="span-12">
        {rows !== null && total === 0 && !problem ? (
          <EmptyState
            illustration="EmptyFolder"
            theme={theme}
            title="No tool calls yet"
            description="They'll show up here as Vizzy works."
          />
        ) : (
          <Table
            aria-label="Tool calls"
            items={shown}
            columns={columns}
            visibleColumns={visible}
            isLoading={rows === null}
          />
        )}
      </div>

      <Drawer isOpen={open !== null} onClose={() => setOpen(null)} title="Tool call" width={560}>
        {open && (
          <div className="detail">
            <Fact label="Time" value={exactTime(open.created_at)} />
            <Fact label="User" value={open.user_name} />
            <Fact label="Tool" value={open.tool_name} code />
            <Fact label="Activity" value={open.status_line || '--'} />
            <Fact label="Conversation" value={open.conversation_title || '--'} />
            <Fact label="Result" value={outcome(open)} />
            {open.approval && (
              <Fact label="Approval" value={open.approved_by ? `${open.approval} by ${open.approved_by}` : open.approval} />
            )}
            {open.tokens && (
              <>
                <Fact label="Model" value={modelName(open.tokens.model)} />
                <Fact
                  label="Step tokens"
                  value={`${tokensIn(open.tokens).toLocaleString()} in (${open.tokens.cache_read.toLocaleString()} from cache) · ${open.tokens.output.toLocaleString()} out`}
                />
                <Text color="subtle" variant="body-sm-normal">
                  Tokens are counted per model request. Calls Vizzy asked for in the same step show the same figures.
                </Text>
              </>
            )}
            <Text variant="heading-xs">Input</Text>
            <pre className="request-body"><Text variant="code">{JSON.stringify(open.input, null, 2)}</Text></pre>
            <Text variant="heading-xs">{open.is_error ? 'Error' : 'Result preview'}</Text>
            <pre className="request-body"><Text variant="code">{open.result_preview || '--'}</Text></pre>
          </div>
        )}
      </Drawer>
    </Page>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="span-3">
      <Card>
        <Card.Content>
          <div className="metric">
            <Text color="subtle">{label}</Text>
            <Text variant="metric-md">{value}</Text>
            {note && <Text color="subtle" variant="body-sm-normal">{note}</Text>}
          </div>
        </Card.Content>
      </Card>
    </div>
  );
}

function Fact({ label, value, code }: { label: string; value: string; code?: boolean }) {
  return (
    <div className="fact">
      <Text color="subtle">{label}</Text>
      <Text variant={code ? 'code' : 'body'}>{value}</Text>
    </div>
  );
}
