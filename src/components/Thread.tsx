import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Spinner, Tag, Text } from '@capra/core';
import {
  Ban, CircleCheck, CircleXmark, ClockOutlined, SecurityScan, type SvgIcon,
} from '@capra/icons';
import vizzy from '../assets/vizzy.png';
import { splitFollowups } from '../lib/followups';
import { duration, when } from '../lib/format';
import type { Approval, Block, Live, Message, ToolState } from '../lib/session';
import { Markdown } from './Markdown';

type Decide = (approval: Approval, decision: 'approve' | 'reject') => void;

type ThreadProps = {
  messages: Message[];
  live: Live | null;
  busy: boolean;
  canApprove: boolean;
  onDecide: Decide;
  /** Send a question Vizzy suggested as a next step. */
  onAsk: (question: string) => void;
};

/** The conversation: saved messages, then the turn in flight. Follows new content unless scrolled up. */
export function Thread({ messages, live, busy, canApprove, onDecide, onAsk }: ThreadProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  useEffect(() => {
    const element = scroller.current;
    if (element && following.current) element.scrollTop = element.scrollHeight;
  });

  const onScroll = () => {
    const element = scroller.current;
    if (element) following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  };

  return (
    <div className="thread" ref={scroller} onScroll={onScroll}>
      <div className="thread-column">
        {messages.map((message) =>
          message.role === 'user' ? (
            <UserBubble
              key={message.id}
              text={message.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('\n')}
              author={message.theirs ? message.author : undefined}
            />
          ) : (
            <Turn key={message.id} message={message} canApprove={canApprove} onDecide={onDecide} />
          ),
        )}
        {!live && !busy && <Followups message={messages[messages.length - 1]} onAsk={onAsk} />}
        {live && (
          <>
            <UserBubble text={live.text} author={live.author} />
            {(live.blocks.length > 0 || busy || live.error || live.stopped) && (
              <Turn
                message={{ id: 'live', role: 'assistant', blocks: live.blocks }}
                working={busy && !isWaiting(live.blocks)}
                canApprove={canApprove}
                onDecide={onDecide}
              >
                {live.error && <Alert appearance="danger" layout="inline">{live.error}</Alert>}
                {live.stopped && !live.error && <Text color="subtle" variant="body-sm-normal">Stopped</Text>}
              </Turn>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Next questions Vizzy suggested at the end of its latest reply: a few quiet chips, only under the
 * last message, gone as soon as the conversation moves on.
 */
function Followups({ message, onAsk }: { message: Message | undefined; onAsk: (question: string) => void }) {
  if (!message || message.role !== 'assistant') return null;
  const last = message.blocks[message.blocks.length - 1];
  if (!last || last.type !== 'text') return null;
  const { followups } = splitFollowups(last.text);
  if (!followups.length) return null;
  return (
    <div className="followups" aria-label="Suggested next questions">
      {followups.map((question) => (
        <button key={question} type="button" className="followup" onClick={() => onAsk(question)}>{question}</button>
      ))}
    </div>
  );
}

const isWaiting = (blocks: Block[]) => blocks.some((block) => block.type === 'tool' && block.state === 'waiting');

/** What a person wrote. Your own sits on the right; a colleague's on the left, under their name. */
function UserBubble({ text, author }: { text: string; author?: string }) {
  if (!text) return null;
  return (
    <div className={`bubble-row${author ? ' is-theirs' : ''}`}>
      {author && <Text color="subtle" variant="body-sm-semibold">{author}</Text>}
      <div className="bubble"><Text>{text}</Text></div>
    </div>
  );
}

type TurnProps = {
  message: Message;
  working?: boolean;
  canApprove: boolean;
  onDecide: Decide;
  children?: React.ReactNode;
};

function Turn({ message, working, canApprove, onDecide, children }: TurnProps) {
  const staff = message.role === 'staff';
  return (
    <div className="turn">
      <img className="turn-avatar" src={vizzy} alt="" />
      <div className="turn-body">
        <div className="turn-head">
          <Text variant="body-md-semibold">{staff ? message.author ?? 'VisiCore engineer' : 'Vizzy'}</Text>
          {staff && <Tag size="sm" color="highlight">VisiCore engineer</Tag>}
          {message.createdAt && <Text color="subtle" variant="body-sm-normal">{when(message.createdAt)}</Text>}
        </div>
        {grouped(message.blocks).map((item, index) => {
          if (Array.isArray(item)) return <Steps key={index} tools={item} live={Boolean(working)} />;
          if (item.type === 'text') return <Markdown key={index} text={splitFollowups(item.text).text} />;
          if (item.type === 'thinking') return <Thinking key={index} text={item.text} streaming={item.streaming} />;
          return (
            <div key={item.id} className="tool">
              <ToolRow block={item} />
              {item.approval && (
                <ApprovalCard approval={item.approval} statusLine={item.statusLine} canApprove={canApprove} onDecide={onDecide} />
              )}
            </div>
          );
        })}
        {working && <div className="turn-working" role="status" aria-label="Vizzy is working"><Spinner size="sm" /></div>}
        {children}
      </div>
    </div>
  );
}

type Tool = Extract<Block, { type: 'tool' }>;
const FOLD_FROM = 4;

/** Runs of plain tool calls become one group; a call with an approval card always stands alone. */
function grouped(blocks: Block[]): (Block | Tool[])[] {
  const out: (Block | Tool[])[] = [];
  for (const block of blocks) {
    const last = out[out.length - 1];
    if (block.type === 'tool' && !block.approval) {
      if (Array.isArray(last)) last.push(block);
      else out.push([block]);
    } else {
      out.push(block);
    }
  }
  return out;
}

/** A run of tool calls. Short runs are listed; a long one folds to a count once nothing in it is running. */
function Steps({ tools, live }: { tools: Tool[]; live: boolean }) {
  const running = tools.some((tool) => tool.state === 'running' || tool.state === 'applying');
  const failed = tools.filter((tool) => tool.state === 'error').length;
  const rows = tools.map((tool) => <ToolRow key={tool.id} block={tool} />);
  if (tools.length < FOLD_FROM || running || live) return <div className="steps">{rows}</div>;
  return (
    <details className="steps-folded">
      <summary>
        <Text variant="body-md-semibold">{tools.length} steps</Text>
        <Tag size="sm" color="success">{`${tools.length - failed} ok`}</Tag>
        {failed > 0 && <Tag size="sm" color="danger">{`${failed} failed`}</Tag>}
        <Text color="subtle" variant="body-sm-normal">Show</Text>
      </summary>
      <div className="steps">{rows}</div>
    </details>
  );
}

/** The model's own summary of its reasoning: closed unless the person opens it. */
function Thinking({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <details className="thinking">
      <summary><Text color="subtle" variant="body-sm-normal">{streaming ? 'Thinking…' : 'Thought process'}</Text></summary>
      <Text as="p" color="subtle" variant="body-sm-normal">{text}</Text>
    </details>
  );
}

const STATE_ICON: Record<Exclude<ToolState, 'running' | 'applying'>, SvgIcon> = {
  ok: CircleCheck, error: CircleXmark, waiting: ClockOutlined, skipped: Ban, stopped: Ban,
};
const STATE_LABEL: Partial<Record<ToolState, string>> = {
  waiting: 'Waiting for approval', applying: 'Applying…', skipped: 'Not applied', stopped: 'Stopped',
};

/** One tool call on one line: what it was for, in the model's words, and how it went. */
function ToolRow({ block }: { block: Extract<Block, { type: 'tool' }> }) {
  const running = block.state === 'running' || block.state === 'applying';
  const Icon = running ? null : STATE_ICON[block.state as keyof typeof STATE_ICON];
  return (
    <div className={`tool-row tool-${block.state}`}>
      <span className="tool-icon">{Icon ? <Icon size="sm" /> : <Spinner size="sm" />}</span>
      <Text>{block.statusLine || 'Running a tool'}</Text>
      {STATE_LABEL[block.state] && <Text color="subtle" variant="body-sm-normal">{STATE_LABEL[block.state]}</Text>}
      {block.kind === 'write' && <Tag size="sm" color="warning">change</Tag>}
      <Text variant="code" color="subtle">{block.name}</Text>
      {block.durationMs > 0 && <Text color="subtle" variant="body-sm-normal">{duration(block.durationMs)}</Text>}
    </div>
  );
}

const OUTCOME: Record<Exclude<Approval['status'], 'pending'>, { label: string; color: 'success' | 'default' }> = {
  approved: { label: 'Approved', color: 'success' },
  rejected: { label: 'Rejected', color: 'default' },
  expired: { label: 'Expired (no decision)', color: 'default' },
  interrupted: { label: 'No decision was made; nothing was applied', color: 'default' },
};

type ApprovalCardProps = { approval: Approval; statusLine: string; canApprove: boolean; onDecide: Decide };

/** The exact request Vizzy wants to send. Nothing is sent to Cribl until Approve is pressed here. */
function ApprovalCard({ approval, statusLine, canApprove, onDecide }: ApprovalCardProps) {
  const pending = approval.status === 'pending';
  const outcome = approval.status === 'pending' ? null : OUTCOME[approval.status];
  return (
    <Card>
      <Card.Header>
        <Card.Title>{pending ? 'Vizzy wants to make this change' : 'Requested change'}</Card.Title>
        {outcome && (
          <Card.Action>
            <Tag color={outcome.color}>
              {approval.decidedBy && approval.status !== 'expired' ? `${outcome.label} by ${approval.decidedBy}` : outcome.label}
            </Tag>
          </Card.Action>
        )}
      </Card.Header>
      <Card.Content>
        <div className="approval">
          <Text>{statusLine}</Text>
          {approval.guidance && (
            <div className="approval-guidance">
              <SecurityScan size="sm" />
              <Text color="subtle">
                {approval.guidance.cited
                  ? `Follows VisiCore guidance: ${approval.guidance.title ?? ''}`
                  : 'No VisiCore guidance applies to this change'}
              </Text>
            </div>
          )}
          {approval.requests.length === 0 && <Text color="subtle">No request preview is available.</Text>}
          {approval.requests.map((request, index) => <RequestPreview key={index} request={request} startOpen={pending} />)}
          {approval.problem && <Alert appearance="danger" layout="inline">{approval.problem}</Alert>}
        </div>
      </Card.Content>
      {pending && (
        <Card.Footer>
          {canApprove ? (
            <div className="approval-actions">
              <Button variant="primary" pending={approval.deciding} onClick={() => onDecide(approval, 'approve')}>Approve</Button>
              <Button disabled={approval.deciding} onClick={() => onDecide(approval, 'reject')}>Reject</Button>
            </div>
          ) : (
            <Text color="subtle">Waiting for someone who can approve changes.</Text>
          )}
        </Card.Footer>
      )}
    </Card>
  );
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url, 'https://cribl');
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

function RequestPreview({ request, startOpen }: { request: Approval['requests'][number]; startOpen: boolean }) {
  const body = request.body === null || request.body === undefined ? '' : JSON.stringify(request.body, null, 2);
  const long = body.split('\n').length > 12;
  const [open, setOpen] = useState(startOpen && !long);
  return (
    <div className="request">
      <div className="request-line">
        <Tag size="sm" color={request.method === 'DELETE' ? 'danger' : 'info'}>{request.method}</Tag>
        <Text variant="code">{pathOf(request.url)}</Text>
      </div>
      {body && (open ? (
        <pre className="request-body"><Text variant="code">{body}</Text></pre>
      ) : (
        <div><Button variant="tertiary" size="sm" onClick={() => setOpen(true)}>Show request body</Button></div>
      ))}
    </div>
  );
}
