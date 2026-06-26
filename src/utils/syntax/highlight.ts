/**
 * Syntax highlighting core — kept RN-free so it is usable both from a React
 * Native component and from a plain jest test. This module owns three things:
 *
 *  1. Prism language registration. prismjs core (markup/css/clike/javascript)
 *     loads via the default import; the rest are side-effect imports that
 *     attach their grammars to the shared global Prism instance. prismjs sets
 *     `global.Prism` in non-browser runtimes, so the same registration works
 *     under Metro/Hermes and under node/jest.
 *  2. Grammar resolution: map the file's `language` string + its filename
 *     extension to a registered Prism grammar (or null → caller falls back to
 *     plain text). Registering only the languages we actually use keeps the
 *     bundle small.
 *  3. A dual-theme token palette. The app's dark theme (darkTheme) already
 *     uses VSCode Dark+ hues, so the dark palette mirrors VSCode; the light
 *     palette mirrors VSCode Light+ for legibility on the white sheet.
 */
import Prism from 'prismjs';
import type { PrismGrammar, PrismNode } from 'prismjs';

// Side-effect registrations (order matters: deps before dependents).
// prism-tsx needs prism-typescript + prism-jsx; both load first.
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-sql';

export type { PrismGrammar, PrismNode, PrismToken } from 'prismjs';

/**
 * Hard cap on how much source we colorize. Past this, a single render fans
 * out into tens of thousands of nested <Text> nodes and the sheet janks / OOMs.
 * Files up to 128 KB can still be opened; only the coloring is skipped, so the
 * viewer degrades to the existing plain monospace text. ~24 KB covers the
 * source files people actually tap; minified/large files stay smooth.
 */
export const SYNTAX_HIGHLIGHT_MAX_CHARS = 24000;

const EXTENSION_TO_PRISM: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  json5: 'json',
  jsonc: 'json',
  go: 'go',
  py: 'python',
  pyw: 'python',
  pyi: 'python',
  md: 'markdown',
  markdown: 'markdown',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ksh: 'bash',
  yaml: 'yaml',
  yml: 'yaml',
  css: 'css',
  scss: 'css',
  sass: 'css',
  html: 'markup',
  htm: 'markup',
  xml: 'markup',
  svg: 'markup',
  vue: 'markup',
  sql: 'sql',
  rs: 'rust',
};

const LANGUAGE_TO_PRISM: Record<string, string> = {
  typescript: 'typescript',
  ts: 'typescript',
  tsx: 'tsx',
  javascript: 'javascript',
  js: 'javascript',
  ecmascript: 'javascript',
  jsx: 'jsx',
  json: 'json',
  go: 'go',
  golang: 'go',
  python: 'python',
  py: 'python',
  python3: 'python',
  markdown: 'markdown',
  md: 'markdown',
  shell: 'bash',
  bash: 'bash',
  sh: 'bash',
  zsh: 'bash',
  shellscript: 'bash',
  yaml: 'yaml',
  yml: 'yaml',
  css: 'css',
  sass: 'css',
  scss: 'css',
  html: 'markup',
  xml: 'markup',
  sql: 'sql',
  rust: 'rust',
  rs: 'rust',
};

const extensionOf = (filename?: string): string => {
  if (!filename) return '';
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).toLowerCase();
};

/**
 * Resolve a Prism grammar for the file. The extension is consulted first
 * (it disambiguates .tsx vs a generic "typescript" language string), then the
 * language string. We only return a grammar that is actually registered, so an
 * unmapped/unknown value yields null and the caller renders plain text.
 */
export const resolveGrammar = (
  language?: string,
  filename?: string,
): PrismGrammar | null => {
  const candidates: string[] = [];
  const ext = extensionOf(filename);
  if (ext && EXTENSION_TO_PRISM[ext]) {
    candidates.push(EXTENSION_TO_PRISM[ext]);
  }
  const lang = (language ?? '').trim().toLowerCase();
  if (lang && LANGUAGE_TO_PRISM[lang]) {
    candidates.push(LANGUAGE_TO_PRISM[lang]);
  }
  for (const key of candidates) {
    const grammar = Prism.languages[key];
    if (grammar) {
      return grammar;
    }
  }
  return null;
};

export const tokenize = (code: string, grammar: PrismGrammar): PrismNode[] =>
  Prism.tokenize(code, grammar);

export interface TokenStyle {
  /** Omitted → inherit the base text color from the surrounding span. */
  color?: string;
  /** Optional emphasis; keywords read better with a heavier weight. */
  fontWeight?: '400' | '600' | '700';
}

/**
 * Dark palette — VSCode Dark+ (matches the darkTheme theme's existing hues).
 * Tuned for contrast on a #333 surfaceContainerHigh sheet background.
 */
const DARK_PALETTE: Record<string, TokenStyle> = {
  comment: { color: '#6A9955' },
  prolog: { color: '#6A9955' },
  doctype: { color: '#6A9955' },
  cdata: { color: '#6A9955' },
  keyword: { color: '#569CD6', fontWeight: '600' },
  'selector': { color: '#569CD6' },
  'atrule': { color: '#C586C0' },
  'attr-name': { color: '#9CDCFE' },
  'attr-value': { color: '#CE9178' },
  'class-name': { color: '#4EC9B0' },
  'maybe-class-name': { color: '#4EC9B0' },
  'builtin': { color: '#4EC9B0' },
  'type': { color: '#4EC9B0' },
  'function': { color: '#DCDCAA' },
  'function-variable': { color: '#DCDCAA' },
  'title': { color: '#DCDCAA' },
  'title.function': { color: '#DCDCAA' },
  'title.class': { color: '#4EC9B0' },
  'method': { color: '#DCDCAA' },
  'property': { color: '#9CDCFE' },
  'variable': { color: '#9CDCFE' },
  'parameter': { color: '#9CDCFE' },
  'namespace': { color: '#9CDCFE' },
  'boolean': { color: '#569CD6' },
  'constant': { color: '#4FC1FF' },
  'literal': { color: '#569CD6' },
  'symbol': { color: '#569CD6' },
  'number': { color: '#B5CEA8' },
  'string': { color: '#CE9178' },
  'char': { color: '#CE9178' },
  'string-template': { color: '#CE9178' },
  'triple-quoted-string': { color: '#CE9178' },
  'regex': { color: '#D16969' },
  'important': { color: '#569CD6', fontWeight: '700' },
  'bold': { fontWeight: '700' },
  'italic': {},
  'tag': { color: '#569CD6' },
  'punctuation': { color: '#A9A9A9' },
  'operator': { color: '#D4D4D4' },
  'decorator': { color: '#DCDCAA' },
  'annotation': { color: '#DCDCAA' },
  'macro': { color: '#DCDCAA' },
  'directive-hash': { color: '#C586C0' },
  'deleted': { color: '#F14C4C' },
  'inserted': { color: '#4EC9B0' },
  'entity': { color: '#569CD6' },
  'url': { color: '#9CDCFE' },
};

/**
 * Light palette — VSCode Light+ for legibility on the #ffffff sheet surface.
 */
const LIGHT_PALETTE: Record<string, TokenStyle> = {
  comment: { color: '#008000' },
  prolog: { color: '#008000' },
  doctype: { color: '#008000' },
  cdata: { color: '#008000' },
  keyword: { color: '#0000FF', fontWeight: '600' },
  'selector': { color: '#0000FF' },
  'atrule': { color: '#AF00DB' },
  'attr-name': { color: '#FF0000' },
  'attr-value': { color: '#A31515' },
  'class-name': { color: '#267F99' },
  'maybe-class-name': { color: '#267F99' },
  'builtin': { color: '#267F99' },
  'type': { color: '#267F99' },
  'function': { color: '#795E26' },
  'function-variable': { color: '#795E26' },
  'title': { color: '#795E26' },
  'title.function': { color: '#795E26' },
  'title.class': { color: '#267F99' },
  'method': { color: '#795E26' },
  'property': { color: '#001080' },
  'variable': { color: '#001080' },
  'parameter': { color: '#001080' },
  'namespace': { color: '#001080' },
  'boolean': { color: '#0000FF' },
  'constant': { color: '#0070C1' },
  'literal': { color: '#0000FF' },
  'symbol': { color: '#0000FF' },
  'number': { color: '#098658' },
  'string': { color: '#A31515' },
  'char': { color: '#A31515' },
  'string-template': { color: '#A31515' },
  'triple-quoted-string': { color: '#A31515' },
  'regex': { color: '#811F3F' },
  'important': { color: '#0000FF', fontWeight: '700' },
  'bold': { fontWeight: '700' },
  'italic': {},
  'tag': { color: '#800000' },
  'punctuation': { color: '#6A737D' },
  'operator': { color: '#383A42' },
  'decorator': { color: '#795E26' },
  'annotation': { color: '#795E26' },
  'macro': { color: '#795E26' },
  'directive-hash': { color: '#AF00DB' },
  'deleted': { color: '#A31515' },
  'inserted': { color: '#098658' },
  'entity': { color: '#0000FF' },
  'url': { color: '#001080' },
};

/**
 * Look up the style for a Prism token type. Returns null when the token should
 * inherit the base text color (keeps the renderer's default branch clean).
 * Prism token types are compound (e.g. "class-name"); we match the full string
 * and also a leading-segment fallback ("attr-name" → "attr").
 */
export const tokenStyle = (type: string, isDark: boolean): TokenStyle | null => {
  const palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;
  if (palette[type]) {
    return palette[type];
  }
  const head = type.split(/[-.]/)[0];
  return palette[head] ?? null;
};
