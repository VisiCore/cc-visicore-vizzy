import { useState } from 'react';
import { IconButton, Menu, Modal, Skeleton, Spinner, Text, TextField, Tooltip } from '@capra/core';
import { ChevronDown, ChevronLeft, ChevronRight, Ellipsis, Plus, UsersOutlined } from '@capra/icons';
import { useNavigate } from 'react-router-dom';
import type { ConversationSummary } from '../lib/server';

type Props = {
  conversations: ConversationSummary[] | null;
  activeId?: string;
  /** Closed, the list is a narrow rail: just the way back and a new chat. */
  open: boolean;
  onToggle: () => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onLeave: (id: string) => Promise<void>;
};

/** This person's conversations, newest first: the ones shared with colleagues, then the rest. */
export function ConversationList({ conversations, activeId, open, onToggle, onRename, onDelete, onLeave }: Props) {
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState<ConversationSummary | null>(null);
  const [title, setTitle] = useState('');
  const [removing, setRemoving] = useState<ConversationSummary | null>(null);
  const [folded, setFolded] = useState<Record<string, boolean>>({});

  if (!open) {
    return (
      <aside className="chat-list is-closed" aria-label="Conversations">
        <Tooltip title="Show chats" placement="right">
          <IconButton icon={ChevronRight} aria-label="Show chats" variant="tertiary" appearance="neutral" size="sm" onClick={onToggle} />
        </Tooltip>
        <Tooltip title="New chat" placement="right">
          <IconButton icon={Plus} aria-label="New chat" variant="tertiary" appearance="neutral" size="sm" onClick={() => navigate('/')} />
        </Tooltip>
      </aside>
    );
  }

  const shared = conversations?.filter((conversation) => conversation.shared) ?? [];
  const recent = conversations?.filter((conversation) => !conversation.shared) ?? [];

  const row = (conversation: ConversationSummary) => (
    <div key={conversation.id} className={`chat-row${conversation.id === activeId ? ' is-active' : ''}`}>
      <button type="button" className="chat-row-open" onClick={() => navigate(`/c/${conversation.id}`)}>
        {conversation.has_unread && <span className="chat-row-unread" role="img" aria-label="New messages" />}
        {conversation.title || 'New chat'}
      </button>
      {conversation.busy && <span role="status" aria-label="Vizzy is working"><Spinner size="sm" /></span>}
      <span className="chat-row-menu">
        <Menu trigger={<IconButton icon={Ellipsis} aria-label={`Actions for ${conversation.title}`} variant="tertiary" appearance="neutral" size="xs" />}>
          <Menu.Item
            label="Rename"
            onPress={() => {
              setTitle(conversation.title);
              setRenaming(conversation);
            }}
          />
          <Menu.Item
            label={conversation.is_owner ? 'Delete' : 'Leave'}
            variant="danger"
            onPress={() => setRemoving(conversation)}
          />
        </Menu>
      </span>
    </div>
  );

  const section = (key: string, label: string, items: ConversationSummary[], icon?: React.ReactNode) => (
    <div className="chat-section">
      <button
        type="button"
        className="chat-section-head"
        aria-expanded={!folded[key]}
        onClick={() => setFolded((current) => ({ ...current, [key]: !current[key] }))}
      >
        {icon}
        <span>{label}</span>
        <span className="chat-section-count">{items.length}</span>
        <span className="chat-section-chevron">{folded[key] ? <ChevronRight size="xs" /> : <ChevronDown size="xs" />}</span>
      </button>
      {!folded[key] && items.map(row)}
    </div>
  );

  return (
    <aside className="chat-list" aria-label="Conversations">
      <div className="chat-list-head">
        <Text variant="body-md-semibold">Chats</Text>
        <span className="chat-list-tools">
          <Tooltip title="New chat">
            <IconButton icon={Plus} aria-label="New chat" variant="tertiary" appearance="neutral" size="sm" onClick={() => navigate('/')} />
          </Tooltip>
          <Tooltip title="Hide chats">
            <IconButton icon={ChevronLeft} aria-label="Hide chats" variant="tertiary" appearance="neutral" size="sm" onClick={onToggle} />
          </Tooltip>
        </span>
      </div>
      <div className="chat-list-items">
        {conversations === null && <Skeleton active paragraph={{ rows: 4 }} title={false} />}
        {conversations?.length === 0 && <Text color="subtle" variant="body-sm-normal">No conversations yet</Text>}
        {shared.length > 0 && section('shared', 'Shared', shared, <UsersOutlined size="xs" />)}
        {recent.length > 0 && section('recent', 'Recent', recent)}
      </div>

      <Modal
        isOpen={renaming !== null}
        size="sm"
        title="Rename conversation"
        confirmButtonText="Save"
        onClose={() => setRenaming(null)}
        onConfirm={() => {
          if (renaming && title.trim()) void onRename(renaming.id, title.trim());
          setRenaming(null);
        }}
      >
        <TextField label="Title" value={title} onChange={setTitle} maxLength={80} autoFocus />
      </Modal>

      <Modal
        isOpen={removing !== null}
        size="sm"
        title={removing?.is_owner ? 'Delete this conversation?' : 'Leave this conversation?'}
        confirmButtonText={removing?.is_owner ? 'Delete' : 'Leave'}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) void (removing.is_owner ? onDelete(removing.id) : onLeave(removing.id));
          setRemoving(null);
        }}
      >
        <Text>
          {removing?.is_owner
            ? `“${removing.title}” will be deleted from Vizzy for everyone in it. This cannot be undone. The audit log keeps the record of every tool call made in it.`
            : `You will no longer see “${removing?.title}”. ${removing?.owner_name || 'Its owner'} can add you back.`}
        </Text>
      </Modal>
    </aside>
  );
}
