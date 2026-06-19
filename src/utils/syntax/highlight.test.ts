import {
  resolveGrammar,
  tokenize,
  tokenStyle,
  SYNTAX_HIGHLIGHT_MAX_CHARS,
} from './highlight';

describe('syntax/highlight', () => {
  describe('resolveGrammar', () => {
    it('resolves tsx via extension even with a generic language string', () => {
      expect(resolveGrammar('typescript', 'App.tsx')).not.toBeNull();
    });

    it('resolves common languages', () => {
      expect(resolveGrammar('go', 'main.go')).not.toBeNull();
      expect(resolveGrammar(undefined, 'config.json')).not.toBeNull();
      expect(resolveGrammar('python', 'run.py')).not.toBeNull();
      expect(resolveGrammar('rust', 'lib.rs')).not.toBeNull();
      expect(resolveGrammar(undefined, 'deploy.yml')).not.toBeNull();
    });

    it('returns null for unknown language and extension', () => {
      expect(resolveGrammar('cobol', 'main.cbl')).toBeNull();
      expect(resolveGrammar(undefined, 'notes.txt')).toBeNull();
      expect(resolveGrammar(undefined, undefined)).toBeNull();
    });
  });

  describe('tokenize', () => {
    it('produces keyword and number tokens for TypeScript', () => {
      const grammar = resolveGrammar('typescript', 'app.ts');
      expect(grammar).not.toBeNull();
      const nodes = tokenize('const answer = 42;', grammar!);
      const types = new Set<string>();
      const walk = (list: unknown[]) =>
        list.forEach(node => {
          if (typeof node === 'string') return;
          const token = node as { type: string; content: unknown };
          types.add(token.type);
          if (Array.isArray(token.content)) {
            walk(token.content);
          }
        });
      walk(nodes);
      expect(types.has('keyword')).toBe(true);
      expect(types.has('number')).toBe(true);
      expect(types.has('operator')).toBe(true);
    });
  });

  describe('tokenStyle', () => {
    it('colors keywords with weight in dark, blue in light', () => {
      const dark = tokenStyle('keyword', true)!;
      expect(dark.color).toBe('#569CD6');
      expect(dark.fontWeight).toBe('600');
      const light = tokenStyle('keyword', false)!;
      expect(light.color).toBe('#0000FF');
    });

    it('matches compound types and falls back to the leading segment', () => {
      expect(tokenStyle('class-name', true)?.color).toBe('#4EC9B0');
      expect(tokenStyle('attr-value', true)?.color).toBe('#CE9178');
    });

    it('returns null for unmapped tokens so they inherit the base color', () => {
      expect(tokenStyle('totally-unknown-token', true)).toBeNull();
    });
  });

  it('exposes a size gate', () => {
    expect(SYNTAX_HIGHLIGHT_MAX_CHARS).toBeGreaterThan(0);
  });
});
