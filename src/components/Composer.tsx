import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button, IconButton, Menu, Tag, Text } from '@capra/core';
import { ArrowUp, Check, ChevronDown, CircleStopSolid } from '@capra/icons';
import { KIND_LABELS } from '../lib/connections';
import { modelName } from '../lib/format';
import type { Me } from '../lib/server';

export type ModelChoice = { model: string | null; effort: string | null };

type ComposerProps = {
  busy: boolean;
  disabled?: boolean;
  /** What Vizzy can reach here: its own Cribl always, Splunk when it is connected in Settings. */
  connections: Me['connections'];
  onSend: (text: string) => Promise<boolean>;
  onStop: () => void;
};

/** Where a message is written. Enter sends; Shift+Enter starts a new line. */
export function Composer({ busy, disabled, connections, onSend, onStop }: ComposerProps) {
  const kinds = [...new Set(connections.map((connection) => KIND_LABELS[connection.kind] ?? connection.kind))];
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);

  // The box grows with what is typed, up to a few lines, then scrolls.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
  }, [text]);

  const submit = async () => {
    const message = text.trim();
    if (!message || busy || disabled) return;
    setText('');
    if (!(await onSend(message))) setText(message); // not accepted: give the words back
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div className="composer">
      {/* A plain textarea, styled with Capra tokens: the bar is one rounded surface, which Capra's field cannot be. */}
      <div className="composer-bar">
        <textarea
          ref={box}
          className="composer-box"
          aria-label="Message Vizzy"
          placeholder="Ask Vizzy anything…"
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
        />
        {busy ? (
          <IconButton icon={CircleStopSolid} aria-label="Stop" size="lg" FORCE__className="composer-send" onClick={onStop} />
        ) : (
          <IconButton icon={ArrowUp} aria-label="Send" variant="primary" size="lg" FORCE__className="composer-send" disabled={!text.trim() || disabled} onClick={() => void submit()} />
        )}
      </div>
      <div className="composer-hint">
        <Text color="subtle" variant="body-sm-normal">
          Vizzy acts on your live {kinds.slice(0, 2).join(' and ')} {kinds.length > 1 ? 'environments' : 'environment'} · tool calls are logged
        </Text>
        <div className="composer-meta">
          {kinds.map((kind) => <Tag key={kind} size="sm" color="success" icon={Check}>{kind}</Tag>)}
        </div>
      </div>
    </div>
  );
}

type ModelMenuProps = {
  llm: Me['llm'];
  choice: ModelChoice;
  onChoose: (choice: { model?: string; effort?: string }) => void;
};

/**
 * Which model and how much effort, for this conversation. A menu only where the person may choose.
 * It lives in the page header: Capra's menu opens downward, and under the composer there is no room.
 */
export function ModelMenu({ llm, choice, onChoose }: ModelMenuProps) {
  const model = choice.model ?? llm.model;
  const effort = choice.effort ?? llm.effort;
  const label = `${llm.models.find((m) => m.id === model)?.name ?? modelName(model)} · ${
    llm.efforts.find((e) => e.id === effort)?.name ?? effort.charAt(0).toUpperCase() + effort.slice(1)
  }`;
  if (!llm.can_choose) return <Text color="subtle">{label}</Text>;
  return (
    <Menu trigger={<Button trailingIcon={ChevronDown}>{label}</Button>}>
      <Menu.Section>
        <Menu.Header label="Model" />
        {llm.models.map((option) => (
          <Menu.Item
            key={option.id}
            label={option.name}
            description={option.note}
            allowItemLineWrap
            active={option.id === model}
            onPress={() => onChoose({ model: option.id })}
          />
        ))}
      </Menu.Section>
      <Menu.Divider />
      <Menu.Section>
        <Menu.Header label="Effort" />
        {llm.efforts.map((option) => (
          <Menu.Item
            key={option.id}
            label={option.name}
            description={option.note}
            allowItemLineWrap
            active={option.id === effort}
            onPress={() => onChoose({ effort: option.id })}
          />
        ))}
      </Menu.Section>
    </Menu>
  );
}
