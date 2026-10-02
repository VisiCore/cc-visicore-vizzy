import type { ReactNode } from 'react';
import { Alert, Button, EmptyState, Spinner, Text } from '@capra/core';
import { useNavigate } from 'react-router-dom';
import { useAccount } from '../lib/account';
import { useTheme } from '../lib/theme';

type PageProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Pages that work without a licence (Settings, Documentation) show their content regardless. */
  open?: boolean;
  /** The content lays itself out (the chat); otherwise it sits on the 12-column grid. */
  bare?: boolean;
  children: ReactNode;
};

/** A page: a header that stays put, and content on Capra's 12-column grid below it. */
export function Page({ title, description, actions, open, bare, children }: PageProps) {
  const { account } = useAccount();
  const blocked = !open && account.status !== 'ready';
  return (
    <main className="page">
      <header className="page-header">
        <div className="page-header-text">
          <Text as="h1" variant="heading-md">{title}</Text>
          {description && <Text color="subtle">{description}</Text>}
        </div>
        {actions && <div className="page-header-actions">{actions}</div>}
      </header>
      {blocked ? (
        <div className="page-content">
          <div className="span-12"><NotReady /></div>
        </div>
      ) : bare ? (
        children
      ) : (
        <div className="page-content">{children}</div>
      )}
    </main>
  );
}

/** The same thing on every page that needs the licence, pointing to Settings. */
function NotReady() {
  const { account, reload } = useAccount();
  const theme = useTheme();
  const navigate = useNavigate();
  if (account.status === 'loading') {
    return <div className="centered"><Spinner size="lg" title="Connecting to Vizzy" /></div>;
  }
  if (account.status === 'down') {
    return (
      <Alert
        appearance="danger"
        layout="section"
        title="The Vizzy server could not be reached"
        action={{ label: 'Try again', onClick: () => void reload() }}
      >
        {account.message}
      </Alert>
    );
  }
  return (
    <EmptyState
      illustration="EmptySuitcase"
      theme={theme}
      size="lg"
      title="Vizzy needs a licence key"
      description="Enter the key VisiCore gave your organization. It is stored encrypted in Cribl and used for every request to Vizzy."
    >
      <Button variant="primary" onClick={() => navigate('/settings')}>Open Settings</Button>
    </EmptyState>
  );
}
