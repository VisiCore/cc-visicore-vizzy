import { useEffect, useMemo, useState } from 'react';
import { Button, Skeleton, Text } from '@capra/core';
import {
  ChartColumn, Destinations, FileLines, FileTextOutlined, Gauge, HardDrive, MonitoringOutlined, Packs,
  PartitionOutlined, RocketLaunch, Routes, Search, SecurityScan, Sources, SwapOutlined, Token, WorkersOutlined,
  type SvgIcon,
} from '@capra/icons';
import vizzy from '../assets/vizzy.png';
import { api, type Suggestion } from '../lib/server';

// The server names an icon for each question; these are the Capra icons that stand for them.
const ICONS: Record<string, SvgIcon> = {
  topology: PartitionOutlined, nodes: WorkersOutlined, route: Routes, source: Sources, destination: Destinations,
  pack: Packs, deploy: RocketLaunch, pulse: MonitoringOutlined, disk: HardDrive, cpu: Gauge, logs: FileLines,
  chart: ChartColumn, search: Search, shield: SecurityScan, coins: Token, doc: FileTextOutlined,
};
const SHOWN = 4;

/** A new chat: who Vizzy is, and a few questions worth asking, drawn from VisiCore's own list. */
export function Hero({ firstName, onAsk }: { firstName: string; onAsk: (prompt: string) => void }) {
  const [pool, setPool] = useState<Suggestion[] | null>(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    let current = true;
    api
      .get<Suggestion[]>('/api/suggestions')
      .then((loaded) => current && setPool(loaded))
      .catch(() => current && setPool([]));
    return () => {
      current = false;
    };
  }, []);

  // The pool arrives shuffled; Shuffle moves on to the next four.
  const shown = useMemo(
    () => (pool ? Array.from({ length: Math.min(SHOWN, pool.length) }, (_, i) => pool[(offset + i) % pool.length]) : null),
    [pool, offset],
  );

  return (
    <div className="hero">
      <div className="hero-mascot">
        <img src={vizzy} alt="Vizzy, the VisiCore donkey mascot" />
      </div>
      <h2 className="hero-title">
        Hey {firstName}, I'm <span className="hero-name">Vizzy</span>.
      </h2>
      <Text color="subtle" variant="body-lg-normal">Your Cribl expert, on call.</Text>
      <div className="suggestions">
        {shown === null
          ? [0, 1, 2, 3].map((n) => <div key={n} className="suggestion"><Skeleton active paragraph={{ rows: 1 }} /></div>)
          : shown.map((suggestion) => {
              const Icon = ICONS[suggestion.icon] ?? Search;
              return (
                <button key={suggestion.id} type="button" className="suggestion" onClick={() => onAsk(suggestion.prompt)}>
                  <span className={`suggestion-icon is-${suggestion.category.toLowerCase()}`}><Icon size="md" /></span>
                  <span className="suggestion-text">
                    <Text variant="body-md-semibold">{suggestion.title}</Text>
                    <Text color="subtle">{suggestion.prompt}</Text>
                  </span>
                </button>
              );
            })}
      </div>
      {pool && pool.length > SHOWN && (
        <div className="hero-shuffle">
          <Button variant="tertiary" appearance="neutral" size="sm" leadingIcon={SwapOutlined} onClick={() => setOffset((n) => n + SHOWN)}>
            Shuffle
          </Button>
        </div>
      )}
    </div>
  );
}
