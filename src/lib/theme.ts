import { useSyncExternalStore } from 'react';
import { installThemeBridge, type HostTheme } from '../host-theme';

// The Cribl shell owns the theme and pushes it here. Until its first message arrives, the best
// guess is the iframe's color scheme, which the host points at the Cribl theme.
let theme: HostTheme = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
const listeners = new Set<() => void>();

export function startTheme(): void {
  document.body.classList.toggle('dark', theme === 'dark');
  installThemeBridge((next) => {
    theme = next;
    for (const listener of listeners) listener();
  });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The current Cribl theme, for the few things that cannot take it from design tokens (diagrams, illustrations). */
export function useTheme(): HostTheme {
  return useSyncExternalStore(subscribe, () => theme);
}
