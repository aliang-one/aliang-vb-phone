/**
 * Minimal ambient typing for `prismjs`. prismjs ships no bundled types and we
 * intentionally avoid pulling in `@types/prismjs` (its Token type differs
 * across versions). This declares only the surface this app uses:
 * the default-exported Prism with its `languages` map and `tokenize`.
 *
 * The per-language component files under `prismjs/components/*` are imported
 * purely for their registration side effect (they attach grammars to the
 * shared global Prism instance), so they declare as side-effect modules.
 */

declare module 'prismjs' {
  /** A Prism grammar (opaque RegExp/record tree). */
  export type PrismGrammar = unknown;

  /** A single token emitted by Prism.tokenize. */
  export interface PrismToken {
    type: string;
    content: string | PrismToken | Array<string | PrismToken>;
    alias?: string | Array<string>;
    matched?: string;
    length?: number;
  }

  /** Output of Prism.tokenize: a flat list of plain strings and tokens. */
  export type PrismNode = string | PrismToken;

  const Prism: {
    languages: Record<string, PrismGrammar>;
    tokenize(text: string, grammar: PrismGrammar): Array<PrismNode>;
    highlight(text: string, grammar: PrismGrammar, language: string): string;
  };

  export default Prism;
}

declare module 'prismjs/components/*';
