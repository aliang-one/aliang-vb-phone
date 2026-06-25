import { fuzzyScore, scoreCommand, searchCommands } from '../commandSearch';
import type { AgentCommandInfo } from '../../data/platformModels';

const cmd = (name: string, description?: string): AgentCommandInfo => ({ name, description });

describe('fuzzyScore', () => {
  it('returns null when the query is not a subsequence', () => {
    expect(fuzzyScore('brainstorming', 'xyz')).toBeNull();
    expect(fuzzyScore('compact', 'cmx')).toBeNull(); // no 'x'
  });

  it('returns 0 for an empty query (matches everything neutrally)', () => {
    expect(fuzzyScore('anything', '')).toBe(0);
  });

  it('matches a sparse subsequence — the whole point (high recall)', () => {
    // "brnst" → b r a i n s t o r i n g (subsequence, not contiguous)
    expect(fuzzyScore('brainstorming', 'brnst')).not.toBeNull();
    // "cr" → c … r across the '-' segment boundary
    expect(fuzzyScore('code-review', 'cr')).not.toBeNull();
  });

  it('ranks prefix > internal substring > scattered subsequence', () => {
    const prefix = fuzzyScore('compact', 'co')!; // "co" at index 0
    const internal = fuzzyScore('decode-now', 'co')!; // "co" at index 2
    const scattered = fuzzyScore('code-review', 'cr')!; // c…r scattered
    expect(prefix).toBeGreaterThan(internal);
    expect(internal).toBeGreaterThan(scattered);
  });

  it('rewards word-boundary (segment-start) matches', () => {
    // Both are internal substrings, but "rev" starts at a '-' boundary in
    // code-review, whereas "ode" is mid-segment.
    const atBoundary = fuzzyScore('code-review', 'rev')!;
    const midSegment = fuzzyScore('code-review', 'ode')!;
    expect(atBoundary).toBeGreaterThan(midSegment);
  });
});

describe('scoreCommand', () => {
  it('a name match outranks a description-only match', () => {
    const byName = scoreCommand(cmd('compact', '压缩历史'), 'compact')!;
    const byDesc = scoreCommand(cmd('clear', 'compact the context'), 'compact')!;
    expect(byName).toBeGreaterThan(byDesc);
  });

  it('returns null when neither name nor description matches', () => {
    expect(scoreCommand(cmd('clear', '清空'), 'xyz')).toBeNull();
  });
});

describe('searchCommands', () => {
  it('ranks a prefix match above an internal-substring match', () => {
    const out = searchCommands([cmd('decode'), cmd('code-review')], 'code');
    expect(out.map(c => c.name)).toEqual(['code-review', 'decode']);
  });

  it('dedupes by lowercased name (keeps one)', () => {
    const out = searchCommands(
      [cmd('compact'), cmd('compact', 'dup description'), cmd('clear')],
      'comp',
    );
    expect(out.map(c => c.name)).toEqual(['compact']);
  });

  it('caps at the limit', () => {
    const list = ['a', 'ab', 'abc', 'abcd', 'abcde'].map(n => cmd(n));
    expect(searchCommands(list, 'a', 3)).toHaveLength(3);
  });

  it('empty query returns all in input order, deduped', () => {
    expect(searchCommands([cmd('a'), cmd('b'), cmd('a')], '').map(c => c.name)).toEqual([
      'a',
      'b',
    ]);
  });

  it('finds commands via a sparse subsequence (recall > prefix)', () => {
    const out = searchCommands([cmd('clear'), cmd('brainstorming')], 'brnst');
    expect(out.map(c => c.name)).toEqual(['brainstorming']);
  });

  it('excludes everything when nothing matches', () => {
    expect(searchCommands([cmd('clear'), cmd('compact')], 'zzz')).toEqual([]);
  });
});
