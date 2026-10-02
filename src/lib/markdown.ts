/**
 * Vizzy's replies are model output: untrusted text. It is parsed as Markdown, then reduced to a
 * short list of plain elements before it touches the page. Images are dropped on purpose (a
 * picture URL is a way to send data out), links open in a new tab, and nothing brings a style or
 * a script of its own.
 */
import DOMPurify from 'dompurify';
import { marked } from 'marked';

const SANITIZE = {
  ALLOWED_TAGS: [
    'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'del', 's', 'sub', 'sup',
    'code', 'pre', 'kbd', 'blockquote',
    'ul', 'ol', 'li', 'input',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  ALLOWED_ATTR: ['href', 'title', 'align', 'start', 'type', 'checked', 'disabled', 'class'],
  ADD_URI_SAFE_ATTR: ['align', 'start', 'type', 'checked', 'disabled'],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  RETURN_DOM_FRAGMENT: true as const,
};

const SVG = 'http://www.w3.org/2000/svg';

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  // Hooks are global: a diagram's SVG passes through here too and keeps its classes.
  if (node.namespaceURI === SVG) return;
  if (node.nodeName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer nofollow');
  }
  if (node.nodeName === 'INPUT') {
    if (node.getAttribute('type') !== 'checkbox') node.remove();
    else node.setAttribute('disabled', '');
  }
  const classes = node.getAttribute?.('class');
  if (classes !== null && classes !== undefined) {
    const kept = node.nodeName === 'CODE' ? classes.split(/\s+/).filter((c) => /^language-[\w-]+$/.test(c)) : [];
    if (kept.length) node.setAttribute('class', kept.join(' '));
    else node.removeAttribute('class');
  }
});

// A table cell that holds nothing but one of these words is a state, and is shown in its color.
const STATES: Record<string, string[]> = {
  ok: ['ok', 'healthy', 'enabled', 'active', 'running', 'connected', 'deployed', 'success', 'passing', 'up', 'online', 'in sync', 'committed'],
  warn: ['warning', 'degraded', 'disabled', 'pending', 'stale', 'unknown', 'undeployed', 'partial', 'paused', 'not checked', 'uncommitted', 'out of sync'],
  bad: ['error', 'errors', 'failed', 'failing', 'down', 'unhealthy', 'critical', 'blocked', 'missing', 'offline', 'unreachable'],
};
const STATE_OF = new Map(Object.entries(STATES).flatMap(([state, words]) => words.map((word) => [word, state] as const)));

function colorStates(fragment: DocumentFragment): void {
  for (const cell of Array.from(fragment.querySelectorAll('td'))) {
    if (cell.children.length > 1) continue;
    const state = STATE_OF.get((cell.textContent ?? '').trim().toLowerCase());
    if (!state) continue;
    const pill = document.createElement('span');
    pill.className = `state state-${state}`;
    pill.textContent = (cell.textContent ?? '').trim();
    cell.replaceChildren(pill);
  }
}

/** Markdown as a sanitized fragment, or plain text if it cannot be parsed. */
export function renderMarkdown(text: string): DocumentFragment {
  try {
    const html = marked.parse(text, { gfm: true, breaks: false, async: false });
    const fragment = DOMPurify.sanitize(html, SANITIZE);
    colorStates(fragment); // after sanitizing: these classes are ours, not the model's
    return fragment;
  } catch {
    const fragment = document.createDocumentFragment();
    const plain = document.createElement('p');
    plain.textContent = text;
    fragment.append(plain);
    return fragment;
  }
}

// ---- diagrams: a fenced ```mermaid block becomes a picture -----------------------------------

const SVG_SANITIZE = {
  USE_PROFILES: { svg: true, svgFilters: true },
  ADD_TAGS: ['style'], // Mermaid styles its picture with one <style> inside the SVG
  FORBID_TAGS: ['a', 'image', 'use', 'foreignObject', 'script'],
  FORBID_ATTR: ['href', 'xlink:href'],
  RETURN_DOM_FRAGMENT: true as const,
};

type Mermaid = typeof import('mermaid').default;
let loading: Promise<Mermaid> | null = null;
let themed: string | null = null;
let seq = 0;
// The same block is redrawn on every streamed delta, so a finished picture is kept by source and theme.
const drawn = new Map<string, Element>();

async function load(theme: string): Promise<Mermaid> {
  loading ??= import('mermaid').then(({ default: mermaid }) => {
    // Cribl's own stencils, so a diagram of a deployment looks like one: nodes named cribl:worker-group.
    mermaid.registerIconPacks([
      { name: 'cribl', loader: () => import('../assets/cribl-icons.json').then((pack) => pack.default as never) },
    ]);
    return mermaid;
  });
  const mermaid = await loading;
  if (themed !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: theme === 'dark' ? 'dark' : 'default',
      fontFamily: 'inherit',
      themeVariables: { fontSize: '13px' },
      htmlLabels: false, // plain SVG text labels, so the sanitizer keeps them
      flowchart: { htmlLabels: false },
    });
    themed = theme;
  }
  return mermaid;
}

function swap(pre: Element, picture: Element) {
  const figure = document.createElement('figure');
  figure.className = 'diagram';
  figure.append(picture);
  pre.replaceWith(figure);
}

/** Draw every mermaid block under `root`. A block that does not parse (still streaming, or wrong) stays as code. */
export async function drawDiagrams(root: HTMLElement, theme: string): Promise<void> {
  for (const code of Array.from(root.querySelectorAll('pre > code.language-mermaid'))) {
    const pre = code.parentElement;
    const source = code.textContent ?? '';
    if (!pre || !source.trim()) continue;
    const key = `${theme}\n${source}`;
    const cached = drawn.get(key);
    if (cached) {
      swap(pre, cached.cloneNode(true) as Element);
      continue;
    }
    try {
      const mermaid = await load(theme);
      await mermaid.parse(source);
      if (!pre.isConnected) continue; // redrawn meanwhile
      const { svg } = await mermaid.render(`vizzy-diagram-${++seq}`, source);
      const picture = DOMPurify.sanitize(svg, SVG_SANITIZE).firstElementChild;
      if (!picture || picture.tagName.toLowerCase() !== 'svg') continue;
      picture.removeAttribute('height'); // scale with the column; the viewBox keeps the proportions
      drawn.set(key, picture.cloneNode(true) as Element);
      if (pre.isConnected) swap(pre, picture);
    } catch {
      // shown as code
    }
  }
}
