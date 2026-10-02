import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, defineColumns, Drawer, EmptyState, Table, Tag, Text } from '@capra/core';
import { Reload } from '@capra/icons';
import { useNavigate } from 'react-router-dom';
import { Markdown } from '../components/Markdown';
import { Page } from '../components/Page';
import { useAccount } from '../lib/account';
import { exactTime, when } from '../lib/format';
import { api, ServerError, type Escalation } from '../lib/server';
import { useTheme } from '../lib/theme';

type Row = Escalation & { conversation_id: string; conversation_title: string };

const STATUS: Record<Escalation['status'], { label: string; color: 'warning' | 'info' | 'success' }> = {
  open: { label: 'Waiting', color: 'warning' },
  claimed: { label: 'With an engineer', color: 'info' },
  resolved: { label: 'Resolved', color: 'success' },
};

const columnsFor = (onOpen: (row: Row) => void) => defineColumns<Row>([
  {
    id: 'conversation_title',
    label: 'Conversation',
    render: (value, row) => <Button variant="tertiary" size="sm" onClick={() => onOpen(row)}>{value || 'New chat'}</Button>,
  },
  { id: 'status', label: 'Status', render: (value) => <Tag size="sm" color={STATUS[value].color}>{STATUS[value].label}</Tag> },
  {
    id: 'urgency',
    label: 'Urgency',
    render: (value) => <Tag size="sm" color={value === 'urgent' ? 'danger' : 'default'}>{value === 'urgent' ? 'Urgent' : 'Normal'}</Tag>,
  },
  { id: 'raised_by', label: 'Raised by', render: (value, row) => <Text>{row.raised_by_vizzy ? 'Vizzy' : value}</Text> },
  { id: 'claimed_by', label: 'Engineer', render: (value) => <Text>{value ?? '--'}</Text> },
  { id: 'created_at', label: 'Raised', render: (value) => <Text>{when(value)}</Text> },
]);

/** Conversations this person is in that were handed to a VisiCore engineer, the open ones first. */
export function EscalationsPage() {
  const { account } = useAccount();
  const theme = useTheme();
  const navigate = useNavigate();
  const ready = account.status === 'ready';
  const [rows, setRows] = useState<Row[] | null>(null);
  const [problem, setProblem] = useState('');
  const [open, setOpen] = useState<Row | null>(null);
  const columns = useMemo(() => columnsFor(setOpen), []);
  const visible = useMemo(() => columns.map((column) => column.id), [columns]);

  const load = useCallback(async () => {
    setProblem('');
    try {
      setRows(await api.get<Row[]>('/api/escalations'));
    } catch (error) {
      setRows((current) => current ?? []);
      setProblem(error instanceof ServerError ? error.message : "Couldn't load your escalations.");
    }
  }, []);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  return (
    <Page
      title="Escalations"
      description="Conversations you handed to a VisiCore engineer, or that Vizzy handed over for you."
      actions={<Button leadingIcon={Reload} onClick={() => void load()}>Refresh</Button>}
    >
      {problem && <div className="span-12"><Alert appearance="danger" layout="section">{problem}</Alert></div>}
      <div className="span-12">
        {rows !== null && rows.length === 0 && !problem ? (
          <EmptyState
            illustration="Hibernating"
            theme={theme}
            title="Nothing has been escalated"
            description='Use "Ask an engineer" in a conversation when you want a person from VisiCore to look at it.'
          />
        ) : (
          <Table aria-label="Escalations" items={rows ?? []} columns={columns} visibleColumns={visible} isLoading={rows === null} />
        )}
      </div>

      <Drawer
        isOpen={open !== null}
        onClose={() => setOpen(null)}
        title="Escalation"
        width={560}
        footer={open && <Button variant="primary" onClick={() => navigate(`/c/${open.conversation_id}`)}>Open the conversation</Button>}
      >
        {open && (
          <div className="detail">
            <div className="fact"><Text color="subtle">Conversation</Text><Text>{open.conversation_title || 'New chat'}</Text></div>
            <div className="fact"><Text color="subtle">Status</Text><Text>{STATUS[open.status].label}</Text></div>
            <div className="fact"><Text color="subtle">Raised</Text><Text>{exactTime(open.created_at)} by {open.raised_by_vizzy ? 'Vizzy' : open.raised_by}</Text></div>
            <div className="fact"><Text color="subtle">Engineer</Text><Text>{open.claimed_by ?? 'Not picked up yet'}</Text></div>
            <Text variant="heading-xs">{open.raised_by_vizzy ? 'Handoff from Vizzy' : 'What was asked'}</Text>
            <Markdown text={open.summary} />
            {open.resolution_note && (
              <>
                <Text variant="heading-xs">Resolution</Text>
                <Markdown text={open.resolution_note} />
              </>
            )}
          </div>
        )}
      </Drawer>
    </Page>
  );
}
