import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, EmptyState, Modal, Skeleton, Text, TextArea, Toast } from '@capra/core';
import { Markdown } from '../components/Markdown';
import { Page } from '../components/Page';
import { useAccount } from '../lib/account';
import { when } from '../lib/format';
import { api, ServerError, type Note, type Notes } from '../lib/server';
import { useTheme } from '../lib/theme';

const failure = (error: unknown, fallback: string) => (error instanceof ServerError ? error.message : fallback);

/** What Vizzy carries from one conversation to the next. Notes are written by Vizzy; people correct or remove them here. */
export function MemoryPage() {
  const { account } = useAccount();
  const theme = useTheme();
  const ready = account.status === 'ready';
  const [notes, setNotes] = useState<Notes | null>(null);
  const [problem, setProblem] = useState('');
  const [editing, setEditing] = useState<Note | null>(null);
  const [text, setText] = useState('');
  const [deleting, setDeleting] = useState<Note | null>(null);

  const load = useCallback(async () => {
    try {
      setNotes(await api.get<Notes>('/api/notes'));
      setProblem('');
    } catch (error) {
      setProblem(failure(error, "Couldn't load the notes."));
    }
  }, []);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  const save = async () => {
    const note = editing;
    setEditing(null);
    if (!note || !text.trim()) return;
    try {
      await api.put(`/api/notes/${note.id}`, { text: text.trim() });
      Toast.success('Note saved.');
      await load();
    } catch (error) {
      Toast.error(failure(error, "Couldn't save the note."));
    }
  };

  const remove = async () => {
    const note = deleting;
    setDeleting(null);
    if (!note) return;
    try {
      await api.delete(`/api/notes/${note.id}`);
      Toast.success('Note deleted.');
      await load();
    } catch (error) {
      Toast.error(failure(error, "Couldn't delete the note."));
    }
  };

  const section = (title: string, description: string, items: Note[], editable: boolean, empty: string) => (
    <>
      <div className="span-12 note">
        <Text as="h2" variant="heading-sm">{title} ({items.length} of {notes?.limits.per_tier ?? 20})</Text>
        <Text color="subtle">{description}</Text>
      </div>
      {items.length === 0 && <div className="span-12"><Text color="subtle">{empty}</Text></div>}
      {items.map((note) => (
        <div key={note.id} className="span-6">
          <Card>
            <Card.Content>
              <div className="note">
                <Markdown text={note.text} />
                <div className="note-foot">
                  <Text color="subtle" variant="body-sm-normal">
                    Saved {when(note.created_at)}
                    {note.conversation_title ? ` · from “${note.conversation_title}”` : ''}
                    {note.tier === 'memory' && note.created_by ? ` · with ${note.created_by}` : ''}
                  </Text>
                  {editable && (
                    <span className="note-actions">
                      <Button
                        size="sm"
                        variant="tertiary"
                        onClick={() => {
                          setText(note.text);
                          setEditing(note);
                        }}
                      >
                        Edit
                      </Button>
                      <Button size="sm" variant="tertiary" appearance="danger" onClick={() => setDeleting(note)}>Delete</Button>
                    </span>
                  )}
                </div>
              </div>
            </Card.Content>
          </Card>
        </div>
      ))}
    </>
  );

  const nothing = notes !== null && notes.preferences.length === 0 && notes.memories.length === 0;

  return (
    <Page
      title="Memory"
      description="What Vizzy carries from one conversation to the next. It reads these at the start of every session, so fix anything that's wrong."
    >
      {problem && <div className="span-12"><Alert appearance="danger" layout="section">{problem}</Alert></div>}
      {notes === null && !problem && <div className="span-12"><Skeleton active paragraph={{ rows: 4 }} /></div>}
      {nothing && (
        <div className="span-12">
          <EmptyState
            illustration="PottedPlant"
            theme={theme}
            title="Nothing yet"
            description="Tell Vizzy how you like things done and it will offer to remember. It also adds a note when a task teaches it something worth keeping about your environment."
          />
        </div>
      )}
      {notes !== null && !nothing && (
        <>
          {section(
            'Your preferences',
            'How you like Vizzy to work for you. Only you see these, and Vizzy saves one only after asking you.',
            notes.preferences,
            true,
            'Nothing yet. Tell Vizzy how you like things done and it will offer to remember.',
          )}
          {section(
            `What Vizzy has learned about ${notes.org.name}`,
            'Lessons about your environment, shared by everyone here who uses Vizzy.',
            notes.memories,
            notes.can_edit_memories,
            'Nothing yet. Vizzy adds a note here when a task teaches it something worth keeping.',
          )}
        </>
      )}

      <Modal isOpen={editing !== null} size="md" title="Edit note" confirmButtonText="Save" onClose={() => setEditing(null)} onConfirm={() => void save()}>
        <TextArea
          label="Note"
          helperText="Markdown. Vizzy reads this exactly as written at the start of every session."
          value={text}
          onChange={setText}
          maxLength={notes?.limits.max_chars ?? 1000}
          showCount
          autoSize={{ minRows: 6, maxRows: 16 }}
        />
      </Modal>

      <Modal
        isOpen={deleting !== null}
        size="sm"
        title="Delete this note?"
        confirmButtonText="Delete"
        onClose={() => setDeleting(null)}
        onConfirm={() => void remove()}
      >
        <Text>
          {deleting?.tier === 'memory'
            ? 'Vizzy forgets it for everyone in your organization. This cannot be undone.'
            : 'Vizzy forgets this preference. This cannot be undone.'}
        </Text>
      </Modal>
    </Page>
  );
}
