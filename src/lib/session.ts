/**
 * One open conversation: what is saved, the turn in flight, and the live stream that feeds both.
 *
 * The server is the source of truth. Every (re)connect begins with `hello` followed by a replay of
 * the running turn, so the rule is simple: on `hello`, read the saved conversation; then draw the
 * turn in flight from the events, taking its already-saved part out of what was read.
 */
import { followConversation } from './follow';
import { Relay, type CriblRequest } from './relay';
import {
  api, ServerError, type ChangeRequest, type Conversation, type Escalation, type Guidance, type Person,
  type SavedMessage,
} from './server';

export type ToolState = 'running' | 'ok' | 'error' | 'waiting' | 'applying' | 'skipped' | 'stopped';

export type Approval = {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'interrupted';
  decidedBy: string;
  requests: ChangeRequest[];
  guidance: Guidance;
  /** A click is on its way to the server. */
  deciding?: boolean;
  problem?: string;
};

export type Block =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string; streaming: boolean }
  | {
      type: 'tool';
      id: string;
      name: string;
      kind: string;
      statusLine: string;
      state: ToolState;
      durationMs: number;
      approval?: Approval;
    };

export type Message = {
  id: string;
  role: 'user' | 'assistant' | 'staff';
  blocks: Block[];
  author?: string;
  createdAt?: string;
  /** A person's message written by someone else in a shared conversation. */
  theirs?: boolean;
};

export type Live = { text: string; blocks: Block[]; error?: string; stopped?: boolean; /** Set when a colleague sent it. */ author?: string };

export type SessionState = {
  loaded: boolean;
  title: string;
  model: string | null;
  effort: string | null;
  messages: Message[];
  live: Live | null;
  busy: boolean;
  online: boolean;
  participants: Person[];
  shared: boolean;
  isOwner: boolean;
  canManage: boolean;
  /** Ids of the people who have the conversation open right now. */
  here: string[];
  /** The latest hand-off to a VisiCore engineer, if there has been one. */
  escalation: Escalation | null;
  /** Set when the conversation cannot be shown at all: 404 it is gone (deleted, or this person was removed), 401 the licence stopped working. */
  gone: number | null;
};

const EMPTY: SessionState = {
  loaded: false, title: 'New chat', model: null, effort: null, messages: [], live: null, busy: false,
  online: false, participants: [], shared: false, isOwner: true, canManage: true, here: [], escalation: null,
  gone: null,
};

function fromSaved(message: SavedMessage): Message {
  return {
    id: message.id,
    role: message.role,
    author: message.author,
    createdAt: message.created_at,
    theirs: message.role === 'user' && message.is_me === false,
    blocks: message.blocks.map((block): Block => {
      if (block.type === 'text') return { type: 'text', text: block.text };
      const approval = block.approval;
      let state: ToolState = block.is_error ? 'error' : 'ok';
      if (approval?.status === 'pending') state = 'waiting';
      else if (approval && approval.status !== 'approved') state = 'skipped';
      return {
        type: 'tool',
        id: block.tool_use_id,
        name: block.name,
        kind: block.kind,
        statusLine: block.status_line,
        state,
        durationMs: block.duration_ms,
        approval: approval && {
          id: approval.id,
          status: approval.status as Approval['status'],
          decidedBy: approval.decided_by,
          requests: approval.preview?.requests ?? [],
          guidance: approval.guidance,
        },
      };
    }),
  };
}

const textOf = (message: Message) =>
  message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('\n');

type Payload = Record<string, unknown>;

export class Session {
  readonly id: string;
  private readonly me: string;
  private state: SessionState = EMPTY;
  private readonly listeners = new Set<() => void>();
  private readonly relay: Relay;
  private stream: { close: () => void } | null = null;
  /** Events that arrived while the saved conversation was being read (null: apply as they come). */
  private held: [string, Payload][] | null = [];
  private readonly onListChange: () => void;

  constructor(id: string, me: string, onListChange: () => void) {
    this.id = id;
    this.me = me;
    this.relay = new Relay(id);
    this.onListChange = onListChange;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = () => this.state;

  private set(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private setLive(change: (live: Live) => Live) {
    if (this.state.live) this.set({ live: change(this.state.live) });
  }

  start() {
    this.stream = followConversation(this.id, {
      onEvent: ({ event, data }) => this.receive(event, (data ?? {}) as Payload),
      onDown: () => this.set({ online: false }),
      onGone: (status) => this.set({ gone: status, online: false }),
    });
  }

  close() {
    this.stream?.close();
    this.stream = null;
  }

  private receive(event: string, data: Payload) {
    if (event === 'hello') {
      this.held = [];
      this.set({ online: true, busy: Boolean(data.busy), here: viewerIds(data.viewers) ?? this.state.here });
      void this.read();
      return;
    }
    if (this.held) this.held.push([event, data]);
    else this.apply(event, data);
  }

  /** Read the saved conversation, then let through the events that were held meanwhile. */
  private async read() {
    try {
      const saved = await api.get<Conversation>(`/api/conversations/${this.id}`);
      const live = this.state.busy ? this.state.live : null;
      this.set({
        loaded: true, title: saved.title, model: saved.model, effort: saved.effort,
        messages: saved.messages.map(fromSaved), live,
        participants: saved.participants ?? [], shared: Boolean(saved.shared),
        isOwner: saved.is_owner !== false, canManage: saved.can_manage !== false,
        escalation: saved.escalation ?? null,
      });
    } catch (error) {
      if (error instanceof ServerError && (error.status === 404 || error.status === 401)) {
        this.set({ gone: error.status });
      }
      // Otherwise keep what is on screen: the stream will say hello again when it reconnects.
    }
    const events = this.held ?? [];
    this.held = null;
    for (const [event, data] of events) this.apply(event, data);
  }

  private apply(event: string, data: Payload) {
    switch (event) {
      case 'turn_start': {
        const text = String(data.text ?? '');
        // After a reconnect the replay redraws the whole turn, so its saved part comes out first:
        // the message that started it, and every step saved since.
        const messages = [...this.state.messages];
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'user') {
            if (textOf(messages[i]) === text) messages.length = i;
            break;
          }
        }
        const author = data.author as { id?: string; name?: string } | undefined;
        const theirs = author?.id && author.id !== this.me ? author.name : undefined;
        this.set({ messages, live: { text, blocks: [], author: theirs }, busy: true });
        break;
      }
      case 'text':
      case 'thinking':
        this.setLive((live) => {
          const blocks = [...live.blocks];
          const last = blocks[blocks.length - 1];
          const delta = String(data.delta ?? '');
          if (last && last.type === event) blocks[blocks.length - 1] = { ...last, text: last.text + delta };
          else if (event === 'text') blocks.push({ type: 'text', text: delta });
          else blocks.push({ type: 'thinking', text: delta, streaming: true });
          return { ...live, blocks: settleThinking(blocks, event === 'thinking') };
        });
        break;
      case 'tool_start':
        this.setLive((live) => ({
          ...live,
          blocks: [
            ...settleThinking(live.blocks, false),
            {
              type: 'tool', id: String(data.tool_use_id), name: String(data.name), kind: String(data.kind),
              statusLine: String(data.status_line ?? ''), state: 'running', durationMs: 0,
            },
          ],
        }));
        break;
      case 'approval_required':
        this.changeTool(String(data.tool_use_id), (tool) => ({
          ...tool,
          state: 'waiting',
          statusLine: String(data.status_line ?? '') || tool.statusLine,
          approval: {
            id: String(data.approval_id), status: 'pending', decidedBy: '',
            requests: ((data.preview as { requests?: ChangeRequest[] } | undefined)?.requests ?? []),
            guidance: (data.guidance ?? null) as Guidance,
          },
        }));
        break;
      case 'approval_resolved':
        this.changeTool(String(data.tool_use_id), (tool) => {
          const status = String(data.decision) as Approval['status'];
          return {
            ...tool,
            state: status === 'approved' ? 'applying' : 'skipped',
            approval: tool.approval && { ...tool.approval, status, decidedBy: String(data.decided_by ?? ''), deciding: false },
          };
        });
        break;
      case 'tool_end':
        this.changeTool(String(data.tool_use_id), (tool) => ({
          ...tool,
          state: tool.state === 'skipped' ? 'skipped' : data.is_error ? 'error' : 'ok',
          durationMs: Number(data.duration_ms ?? 0),
        }));
        break;
      case 'cribl_request':
        // Everyone in the conversation sees the request; only the person it names sends it, so a Cribl
        // call is never made with a bystander's sign-in.
        if (!data.user_id || data.user_id === this.me) void this.relay.handle(data as unknown as CriblRequest);
        break;
      case 'people': {
        const participants = (data.participants ?? []) as Person[];
        if (!participants.some((person) => person.id === this.me)) {
          this.close();
          this.set({ gone: 404, online: false });
          break;
        }
        const owner = (data.owner ?? null) as { id: string } | null;
        this.set({ participants, shared: Boolean(data.shared), isOwner: owner?.id === this.me, canManage: owner?.id === this.me });
        this.onListChange();
        break;
      }
      case 'presence':
        this.set({ here: viewerIds(data.viewers) ?? [] });
        break;
      case 'title':
        this.set({ title: String(data.title ?? this.state.title) });
        this.onListChange();
        break;
      case 'error':
        this.setLive((live) => ({ ...live, error: String(data.message ?? 'Something went wrong.') }));
        break;
      case 'staff_message':
        this.set({
          messages: [
            ...this.state.messages,
            {
              id: String(data.id), role: 'staff', author: String(data.author ?? 'VisiCore engineer'),
              createdAt: String(data.created_at ?? ''), blocks: [{ type: 'text', text: String(data.text ?? '') }],
            },
          ],
        });
        void this.refreshEscalation();
        break;
      case 'done':
        void this.finish(Boolean(data.stopped));
        break;
      default:
        break; // typing hints are not shown
    }
  }

  private changeTool(id: string, change: (tool: Extract<Block, { type: 'tool' }>) => Block) {
    this.setLive((live) => ({
      ...live,
      blocks: live.blocks.map((block) => (block.type === 'tool' && block.id === id ? change(block) : block)),
    }));
  }

  /** The turn is over: what it produced is saved now, so read it; keep an error or a Stop on screen. */
  private async finish(stopped: boolean) {
    const ended = this.state.live;
    this.set({ busy: false });
    this.onListChange();
    try {
      const saved = await api.get<Conversation>(`/api/conversations/${this.id}`);
      const messages = saved.messages.map(fromSaved);
      const keep = ended && (ended.error || stopped) ? { ...ended, blocks: [], text: '', author: undefined, stopped } : null;
      // A turn that ended before anything was saved (an error on its first step) keeps its message.
      const lost = ended && !messages.some((m) => m.role === 'user' && textOf(m) === ended.text);
      this.set({
        title: saved.title, messages, live: lost && ended ? { ...ended, stopped } : keep,
        participants: saved.participants ?? this.state.participants, shared: Boolean(saved.shared),
        escalation: saved.escalation ?? null, // Vizzy can hand a conversation over by itself during a turn
      });
    } catch {
      this.setLive((live) => ({ ...live, stopped, blocks: endRunning(live.blocks) }));
    }
  }

  async send(text: string): Promise<void> {
    // Shown at once; the stream's turn_start for this message replaces it with the same thing.
    this.set({ live: { text, blocks: [] }, busy: true });
    try {
      await api.post(`/api/conversations/${this.id}/messages`, { text, detached: true });
    } catch (error) {
      this.set({ live: null, busy: false });
      throw error;
    }
  }

  /** Add a colleague, remove someone (yourself: leave), or hand the conversation over. Everyone's screen follows. */
  async addPerson(userId: string): Promise<void> {
    await api.post(`/api/conversations/${this.id}/participants`, { user_id: userId });
  }

  async removePerson(userId: string): Promise<void> {
    await api.delete(`/api/conversations/${this.id}/participants/${userId}`);
  }

  async handOver(userId: string): Promise<void> {
    await api.post(`/api/conversations/${this.id}/owner`, { user_id: userId });
  }

  private async refreshEscalation(): Promise<void> {
    try {
      const { escalation } = await api.get<{ escalation: Escalation | null }>(`/api/conversations/${this.id}/escalation`);
      this.set({ escalation });
    } catch {
      // the banner keeps what it had; the next read brings it up to date
    }
  }

  /** Hand this conversation to a VisiCore engineer. They read it and reply here. */
  async escalate(note: string, urgent: boolean): Promise<void> {
    await api.post(`/api/conversations/${this.id}/escalate`, { note, urgency: urgent ? 'urgent' : 'normal' });
    await this.refreshEscalation();
    this.onListChange();
  }

  async stop(): Promise<void> {
    await api.post(`/api/conversations/${this.id}/stop`);
  }

  async choose(choice: { model?: string; effort?: string }): Promise<void> {
    await api.patch(`/api/conversations/${this.id}`, choice);
    this.set({ model: choice.model ?? this.state.model, effort: choice.effort ?? this.state.effort });
  }

  /**
   * Approve or reject a pending change. Approving also tells the relay which requests the person
   * saw, before the server is told: by the time the change comes back to be sent, it is known here.
   */
  async decide(approval: Approval, decision: 'approve' | 'reject'): Promise<void> {
    const mark = (patch: Partial<Approval>) =>
      this.setLive((live) => ({
        ...live,
        blocks: live.blocks.map((block) =>
          block.type === 'tool' && block.approval?.id === approval.id
            ? { ...block, approval: { ...block.approval, ...patch } }
            : block,
        ),
      }));
    mark({ deciding: true, problem: undefined });
    if (decision === 'approve') this.relay.approve(approval.id, approval.requests);
    try {
      await api.post(`/api/approvals/${approval.id}`, { decision });
    } catch (error) {
      this.relay.approved.delete(approval.id);
      const why = error instanceof ServerError ? error.message : "Couldn't reach Vizzy, so your decision wasn't recorded.";
      mark({ deciding: false, problem: `${why} Nothing was applied.` });
    }
  }
}

function viewerIds(viewers: unknown): string[] | undefined {
  return Array.isArray(viewers) ? viewers.map((viewer) => String((viewer as { id: unknown }).id)) : undefined;
}

function settleThinking(blocks: Block[], stillThinking: boolean): Block[] {
  return blocks.map((block, index) =>
    block.type === 'thinking' && block.streaming && !(stillThinking && index === blocks.length - 1)
      ? { ...block, streaming: false }
      : block,
  );
}

function endRunning(blocks: Block[]): Block[] {
  return blocks.map((block) => {
    if (block.type === 'thinking') return { ...block, streaming: false };
    if (block.type !== 'tool') return block;
    if (block.state === 'running' || block.state === 'applying') return { ...block, state: 'stopped' };
    if (block.state === 'waiting') {
      return { ...block, state: 'skipped', approval: block.approval && { ...block.approval, status: 'interrupted' } };
    }
    return block;
  });
}
