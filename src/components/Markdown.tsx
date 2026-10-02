import { useEffect, useRef } from 'react';
import { drawDiagrams, renderMarkdown } from '../lib/markdown';
import { useTheme } from '../lib/theme';

/** Model text, rendered as sanitized Markdown with diagrams. */
export function Markdown({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useTheme();

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.replaceChildren(renderMarkdown(text));
    void drawDiagrams(root, theme);
  }, [text, theme]);

  return <div ref={ref} className="markdown" />;
}
