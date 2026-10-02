import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, criblUser, ServerError, type CriblUser, type Me } from './server';

/**
 * Whether the app can talk to the Vizzy server as this person.
 *   ready  the licence key is accepted
 *   setup  there is no key yet, or the server refuses the one stored
 *   down   the server could not be reached at all
 */
export type Account =
  | { status: 'loading' }
  | { status: 'ready'; me: Me; user: CriblUser }
  | { status: 'setup' }
  | { status: 'down'; message: string };

const AccountContext = createContext<{ account: Account; reload: () => Promise<void> }>({
  account: { status: 'loading' },
  reload: async () => {},
});

export function AccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account>({ status: 'loading' });

  const reload = useCallback(async () => {
    try {
      const [me, user] = await Promise.all([api.get<Me>('/api/me'), criblUser()]);
      setAccount({ status: 'ready', me, user });
    } catch (error) {
      if (error instanceof ServerError && (error.status === 401 || error.status === 403)) {
        setAccount({ status: 'setup' });
      } else {
        setAccount({ status: 'down', message: error instanceof Error ? error.message : String(error) });
      }
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return <AccountContext.Provider value={{ account, reload }}>{children}</AccountContext.Provider>;
}

// eslint-disable-next-line react/only-export-components
export const useAccount = () => useContext(AccountContext);
