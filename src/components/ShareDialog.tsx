import { useEffect, useState } from 'react';
import { Alert, Button, Divider, Modal, SelectField, Tag, Text } from '@capra/core';
import { api, ServerError, type Colleague, type Person } from '../lib/server';
import type { Session } from '../lib/session';

type Candidate = { key: string; label: string; vizzyId?: string; cribl?: { id: string; username: string; name: string } };

const USER_LISTS = ['/products/stream/users', '/products/edge/users', '/products/search/users', '/system/users'];

type CriblUser = { id: string; username?: string; first?: string; last?: string; disabled?: boolean };

/** Colleagues who could be added: people who already use the app, and everyone else in Cribl's own user list. */
async function candidates(taken: Set<string>): Promise<Candidate[]> {
  const known = await api.get<Colleague[]>('/api/app/people');
  const out: Candidate[] = known
    .filter((person) => !taken.has(person.id))
    .map((person) => ({ key: `v:${person.id}`, label: person.name, vizzyId: person.id }));
  const knownCribl = new Set(known.map((person) => person.cribl_id));
  // Where Cribl keeps its people depends on the deployment: on Cribl.Cloud the members of the
  // organization are listed per product, and the workspace's own user list is empty. The person's
  // own Cribl permissions decide whether they may read either; if not, the people who already use
  // the app are still offered.
  for (const path of USER_LISTS) {
    try {
      const response = await fetch(window.CRIBL_API_URL + path);
      if (!response.ok) continue;
      const { items = [] } = (await response.json()) as { items?: CriblUser[] };
      for (const user of items) {
        if (!user.id || user.disabled || knownCribl.has(user.id)) continue;
        knownCribl.add(user.id);
        const name = [user.first, user.last].filter(Boolean).join(' ') || user.username || user.id;
        out.push({ key: `c:${user.id}`, label: name, cribl: { id: user.id, username: user.username ?? '', name } });
      }
    } catch {
      // this list is not readable here: try the next
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

type Props = {
  session: Session;
  me: string;
  participants: Person[];
  here: string[];
  canManage: boolean;
  onClose: () => void;
  onLeft: () => void;
};

/** Who is in this conversation, and adding or removing people. */
export function ShareDialog({ session, me, participants, here, canManage, onClose, onLeft }: Props) {
  const [options, setOptions] = useState<Candidate[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null); // `remove:<id>` or `owner:<id>`
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const taken = participants.map((person) => person.id).join(',');

  useEffect(() => {
    let current = true;
    candidates(new Set(taken.split(',')))
      .then((found) => current && setOptions(found))
      .catch(() => current && setOptions([]));
    return () => {
      current = false;
    };
  }, [taken]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setProblem('');
    setConfirming(null);
    try {
      await work();
    } catch (error) {
      setProblem(error instanceof ServerError ? error.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    run(async () => {
      const candidate = options?.find((option) => option.key === chosen);
      if (!candidate) return;
      const id = candidate.vizzyId ?? (await api.post<Colleague>('/api/app/people', candidate.cribl)).id;
      await session.addPerson(id);
      setChosen(null);
    });

  return (
    <Modal isOpen size="sm" title="People in this conversation" cancelButtonText={null} confirmButtonText="Done" onClose={onClose} onConfirm={onClose}>
      <div className="people">
        <Text color="subtle">
          Everyone here sees the whole conversation and can ask Vizzy in it. Vizzy acts with the Cribl permissions of whoever asked;
          an approved change is sent with the permissions of whoever approved it.
        </Text>
        {problem && <Alert appearance="danger" layout="inline">{problem}</Alert>}

        {participants.map((person) => {
          const self = person.id === me;
          const removing = confirming === `remove:${person.id}`;
          const handing = confirming === `owner:${person.id}`;
          return (
            <div key={person.id} className="person">
              <div className="person-name">
                <Text variant="body-md-semibold">{person.name}{self ? ' (you)' : ''}</Text>
                {person.is_owner && <Tag size="sm">Owner</Tag>}
                {person.is_staff && <Tag size="sm" color="highlight">VisiCore</Tag>}
                {here.includes(person.id) && !self && <Tag size="sm" color="success">Here now</Tag>}
              </div>
              {removing || handing ? (
                <>
                  <Button
                    size="sm"
                    appearance={removing ? 'danger' : 'default'}
                    variant="primary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        if (handing) await session.handOver(person.id);
                        else await session.removePerson(person.id);
                        if (removing && self) onLeft();
                      })
                    }
                  >
                    {handing ? `Hand over to ${person.name}` : self ? 'Leave conversation' : `Remove ${person.name}`}
                  </Button>
                  <Button size="sm" variant="tertiary" onClick={() => setConfirming(null)}>Cancel</Button>
                </>
              ) : (
                <>
                  {canManage && !person.is_owner && !person.is_staff && (
                    <Button size="sm" variant="tertiary" disabled={busy} onClick={() => setConfirming(`owner:${person.id}`)}>Make owner</Button>
                  )}
                  {((canManage && !self) || (self && !person.is_owner)) && !person.is_owner && (
                    <Button size="sm" variant="tertiary" appearance="danger" disabled={busy} onClick={() => setConfirming(`remove:${person.id}`)}>
                      {self ? 'Leave' : 'Remove'}
                    </Button>
                  )}
                </>
              )}
            </div>
          );
        })}

        <Divider />
        {canManage ? (
          <div className="people-add">
            <div className="people-add-field">
              <SelectField
                label="Add a colleague"
                placeholder={options === null ? 'Looking for colleagues…' : options.length ? 'Choose someone' : 'Nobody else to add'}
                helperText={
                  options?.length === 0
                    ? "Cribl didn't list anyone else you can add. Colleagues appear here once they are members of this Cribl organization, or after they open Vizzy."
                    : 'They can read everything here, including what came before, and ask Vizzy in it.'
                }
                items={(options ?? []).map((option) => ({ id: option.key, label: option.label }))}
                value={chosen}
                onChange={(value) => setChosen(value === null ? null : String(value))}
                canSearch
                disabled={!options?.length}
              />
            </div>
            <Button variant="primary" disabled={!chosen || busy} onClick={() => void add()}>Add</Button>
          </div>
        ) : (
          <Text color="subtle">Only the conversation's owner can add or remove people.</Text>
        )}
      </div>
    </Modal>
  );
}
