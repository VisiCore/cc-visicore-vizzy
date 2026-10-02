import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Button, Checkbox, Modal, Tag, Text, TextArea, Toast } from '@capra/core';
import { SupportOutlined, UsersOutlined } from '@capra/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { Composer, ModelMenu, type ModelChoice } from '../components/Composer';
import { ConversationList } from '../components/ConversationList';
import { Hero } from '../components/Hero';
import { Page } from '../components/Page';
import { ShareDialog } from '../components/ShareDialog';
import { Thread } from '../components/Thread';
import { useAccount } from '../lib/account';
import { api, ServerError, type ConversationSummary, type Escalation } from '../lib/server';
import { Session, type SessionState } from '../lib/session';

const NO_SESSION: SessionState = {
  loaded: false, title: 'New chat', model: null, effort: null, messages: [], live: null, busy: false,
  online: false, participants: [], shared: false, isOwner: true, canManage: true, here: [], escalation: null,
  gone: null,
};
const noSubscription = () => () => {};
const noState = () => NO_SESSION;

const failure = (error: unknown, fallback: string) => (error instanceof ServerError ? error.message : fallback);

export function ChatPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { account } = useAccount();
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  // A new chat has no conversation yet: its model choice and first message wait for one to exist.
  const [newChoice, setNewChoice] = useState<ModelChoice>({ model: null, effort: null });
  const first = useRef<{ id: string; text: string } | null>(null);
  const [listOpen, setListOpen] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [askNote, setAskNote] = useState('');
  const [askUrgent, setAskUrgent] = useState(false);
  const meId = account.status === 'ready' ? account.me.user.id : '';
  const ready = account.status === 'ready';

  const reloadList = useCallback(async () => {
    try {
      setConversations(await api.get<ConversationSummary[]>('/api/conversations'));
    } catch {
      setConversations((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    void reloadList();
    // A colleague can share a conversation at any time: look for new ones now and then.
    const timer = window.setInterval(() => void reloadList(), 60_000);
    return () => window.clearInterval(timer);
  }, [ready, reloadList]);

  useEffect(() => {
    if (!id || !ready) {
      setSession(null);
      return;
    }
    const opened = new Session(id, meId, () => void reloadList());
    setSession(opened);
    opened.start();
    if (first.current?.id === id) {
      const { text } = first.current;
      first.current = null;
      opened.send(text).catch((error) => Toast.error(failure(error, "Couldn't send your message.")));
    }
    return () => opened.close();
  }, [id, ready, meId, reloadList]);

  const state = useSyncExternalStore(session?.subscribe ?? noSubscription, session?.getState ?? noState);

  const send = async (text: string): Promise<boolean> => {
    try {
      if (session) {
        await session.send(text);
      } else {
        const created = await api.post<{ id: string }>('/api/conversations', {
          model: newChoice.model ?? undefined,
          effort: newChoice.effort ?? undefined,
        });
        first.current = { id: created.id, text };
        navigate(`/c/${created.id}`);
      }
      return true;
    } catch (error) {
      Toast.error(failure(error, "Couldn't send your message."));
      return false;
    }
  };

  const choose = (choice: { model?: string; effort?: string }) => {
    if (!session) {
      setNewChoice((current) => ({ ...current, ...choice }));
      return;
    }
    session.choose(choice).catch((error) => Toast.error(failure(error, "Couldn't change the model.")));
  };

  const rename = async (conversationId: string, title: string) => {
    try {
      await api.patch(`/api/conversations/${conversationId}`, { title });
      await reloadList();
    } catch (error) {
      Toast.error(failure(error, "Couldn't rename the conversation."));
    }
  };

  const remove = async (conversationId: string) => {
    try {
      await api.delete(`/api/conversations/${conversationId}`);
      Toast.success('Conversation deleted.');
      if (conversationId === id) navigate('/');
      await reloadList();
    } catch (error) {
      Toast.error(failure(error, "Couldn't delete the conversation."));
    }
  };

  const escalate = async () => {
    setAsking(false);
    try {
      await session?.escalate(askNote.trim(), askUrgent);
      setAskNote('');
      setAskUrgent(false);
      Toast.success('Sent to VisiCore. An engineer will reply in this conversation.');
    } catch (error) {
      Toast.error(failure(error, "Couldn't reach VisiCore. Nothing was sent."));
    }
  };

  const leave = async (conversationId: string) => {
    try {
      await api.delete(`/api/conversations/${conversationId}/participants/${meId}`);
      if (conversationId === id) navigate('/');
      await reloadList();
    } catch (error) {
      Toast.error(failure(error, "Couldn't leave the conversation."));
    }
  };

  if (account.status !== 'ready') {
    return <Page title="Vizzy" description="Your Cribl expert, on call.">{null}</Page>;
  }

  const { me, user } = account;
  const writes = me.connections.some((connection) => connection.writes_enabled);
  const firstName = user.firstName || me.user.name.split(' ')[0] || user.username;

  return (
    <Page
      bare
      title={id ? state.title : 'Vizzy'}
      description={id ? undefined : 'Your Cribl expert, on call.'}
      actions={
        <>
          {id && state.loaded && !state.gone && state.messages.length > 0 && (
            <Button
              leadingIcon={SupportOutlined}
              disabled={state.busy || (state.escalation !== null && state.escalation.status !== 'resolved')}
              onClick={() => setAsking(true)}
            >
              Ask an engineer
            </Button>
          )}
          {id && state.loaded && !state.gone && (
            <Button leadingIcon={UsersOutlined} onClick={() => setSharing(true)}>
              {state.participants.length > 1 ? `${state.participants.length} people` : 'Share'}
            </Button>
          )}
          <ModelMenu llm={me.llm} choice={session ? { model: state.model, effort: state.effort } : newChoice} onChoose={choose} />
          <Tag color={writes ? 'warning' : 'default'}>{writes ? 'Changes allowed, with approval' : 'Read-only'}</Tag>
          {id && state.loaded && !state.online && <Tag color="warning">Reconnecting…</Tag>}
        </>
      }
    >
      <div className={`page-content chat${listOpen ? '' : ' is-list-closed'}`}>
        <ConversationList
          conversations={conversations}
          activeId={id}
          open={listOpen}
          onToggle={() => setListOpen((current) => !current)}
          onRename={rename}
          onDelete={remove}
          onLeave={leave}
        />
        <section className="chat-main">
          {state.gone ? (
            <div className="chat-notice">
              <Alert
                appearance="warning"
                layout="section"
                title={state.gone === 404 ? 'This conversation is no longer available to you' : 'Vizzy stopped accepting the licence key'}
                action={{ label: state.gone === 404 ? 'Start a new chat' : 'Open Settings', onClick: () => navigate(state.gone === 404 ? '/' : '/settings') }}
              >
                {state.gone === 404
                  ? 'It was deleted, or you were removed from it.'
                  : 'The key may have been revoked. Check it in Settings, or contact VisiCore.'}
              </Alert>
            </div>
          ) : id ? (
            <>
            {state.escalation && <EscalationBanner escalation={state.escalation} />}
            <Thread
              messages={state.messages}
              live={state.live}
              busy={state.busy}
              canApprove={me.user.can_approve}
              onDecide={(approval, decision) => void session?.decide(approval, decision)}
              onAsk={(question) => void send(question)}
            />
            </>
          ) : (
            <div className="thread"><div className="thread-column"><Hero firstName={firstName} onAsk={(prompt) => void send(prompt)} /></div></div>
          )}
          <Composer
            busy={state.busy}
            disabled={Boolean(state.gone)}
            connections={me.connections}
            onSend={send}
            onStop={() => session?.stop().catch(() => Toast.error("Couldn't stop Vizzy."))}
          />
        </section>
      </div>
      <Modal
        isOpen={asking}
        size="sm"
        title="Ask a VisiCore engineer"
        confirmButtonText="Send"
        onClose={() => setAsking(false)}
        onConfirm={() => void escalate()}
      >
        <div className="form-fields">
          <Text color="subtle">An engineer will read this conversation and reply here.</Text>
          <TextArea
            label="What do you need help with? (optional)"
            placeholder="What you were trying to do, what you expected, anything Vizzy got wrong…"
            value={askNote}
            onChange={setAskNote}
            maxLength={1000}
            showCount
            autoSize={{ minRows: 3, maxRows: 8 }}
          />
          <Checkbox checked={askUrgent} onChange={(event) => setAskUrgent(event.target.checked)}>
            Urgent: something is down or at risk
          </Checkbox>
        </div>
      </Modal>
      {sharing && session && (
        <ShareDialog
          session={session}
          me={meId}
          participants={state.participants}
          here={state.here}
          canManage={state.canManage}
          onClose={() => setSharing(false)}
          onLeft={() => {
            setSharing(false);
            navigate('/');
            void reloadList();
          }}
        />
      )}
    </Page>
  );
}

/** Where a hand-off to VisiCore stands, pinned above the conversation. */
function EscalationBanner({ escalation }: { escalation: Escalation }) {
  const urgent = escalation.urgency === 'urgent' ? ' (urgent)' : '';
  if (escalation.status === 'resolved') {
    return (
      <div className="chat-banner">
        <Alert appearance="success" layout="compact" title="Resolved by VisiCore">
          {escalation.resolution_note || 'The engineer closed this request. You can ask again if you need more.'}
        </Alert>
      </div>
    );
  }
  return (
    <div className="chat-banner">
      <Alert
        appearance="info"
        layout="compact"
        title={escalation.status === 'claimed' ? `${escalation.claimed_by ?? 'An engineer'} from VisiCore is on it${urgent}` : `Escalated to VisiCore${urgent}`}
      >
        {escalation.status === 'claimed'
          ? 'They can read this conversation and will reply here.'
          : `${escalation.raised_by_vizzy ? 'Vizzy' : escalation.raised_by} asked for an engineer. Waiting for one to pick it up.`}
      </Alert>
    </div>
  );
}
