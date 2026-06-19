import React, { useMemo } from 'react';
import { StyleProp, Text, TextStyle } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import {
  resolveGrammar,
  tokenize,
  tokenStyle,
  SYNTAX_HIGHLIGHT_MAX_CHARS,
} from '../../utils/syntax/highlight';
import type { PrismNode, PrismToken } from '../../utils/syntax/highlight';

interface CodeHighlightProps {
  code: string;
  /** Agent-reported language label, e.g. "typescript". */
  language?: string;
  /** Filename; its extension disambiguates (e.g. .tsx vs "typescript"). */
  filename?: string;
  /** Base typography (font family/size). Color is theme-driven per token. */
  style?: StyleProp<TextStyle>;
}

/** Normalize a token's content (string | token | array) into a flat node list. */
const asNodeArray = (content: PrismToken['content']): PrismNode[] =>
  Array.isArray(content) ? content : [content];

/**
 * Recursively render Prism's token tree as nested <Text> spans. Plain string
 * leaves inherit the color of their enclosing span, so only colored tokens
 * contribute a style. Keys are scoped per sibling array.
 */
const renderNodes = (
  nodes: PrismNode[],
  isDark: boolean,
  keyPrefix: string,
): React.ReactNode =>
  nodes.map((node, index) => {
    const key = `${keyPrefix}.${index}`;
    if (typeof node === 'string') {
      return <Text key={key}>{node}</Text>;
    }
    const style = tokenStyle(node.type, isDark);
    // Leaf token (content is a plain string): render directly rather than
    // wrapping the string in another <Text>. Most tokens are leaves, so this
    // roughly halves the node count — the dominant cost of native highlighting.
    if (typeof node.content === 'string') {
      return (
        <Text key={key} style={style ?? undefined}>
          {node.content}
        </Text>
      );
    }
    return (
      <Text key={key} style={style ?? undefined}>
        {renderNodes(asNodeArray(node.content), isDark, key)}
      </Text>
    );
  });

/**
 * Renders source code with lightweight, per-filetype syntax highlighting.
 *
 * The expensive part of highlighting on React Native is not tokenizing — it is
 * the fan-out of one <Text> node per token at render time. So we colorize only
 * when a grammar is available AND the content is under a size gate; anything
 * larger degrades to a single plain <Text>, which stays smooth up to the 128 KB
 * content cap. The tokenize pass is memoized so an open sheet pays for it once.
 */
export const CodeHighlight: React.FC<CodeHighlightProps> = React.memo(
  ({ code, language, filename, style }) => {
    const { theme, isDark } = useTheme();
    const nodes = useMemo(() => {
      const grammar = resolveGrammar(language, filename);
      if (!grammar || code.length > SYNTAX_HIGHLIGHT_MAX_CHARS) {
        return null;
      }
      return tokenize(code, grammar);
    }, [code, language, filename]);

    const baseStyle = useMemo(
      () => [style, { color: theme.colors.onSurface }] as StyleProp<TextStyle>,
      [style, theme.colors.onSurface],
    );

    if (!nodes) {
      return <Text style={baseStyle}>{code}</Text>;
    }
    return <Text style={baseStyle}>{renderNodes(nodes, isDark, 'r')}</Text>;
  },
);
