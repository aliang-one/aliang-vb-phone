import { deriveMcpTiers } from '../src/utils/mcpTiers';

describe('deriveMcpTiers', () => {
  it('derives server + all-MCP tiers for a typical MCP tool', () => {
    expect(deriveMcpTiers('mcp__serena__find_symbol')).toEqual([
      { prefix: 'mcp__serena__', label: 'mcp__serena__*' },
      { prefix: 'mcp__', label: 'mcp__*' },
    ]);
  });

  it('handles a server name with internal single underscores', () => {
    // split('__') must not shred the server segment. The server here is
    // 'plugin_playwright_playwright'.
    expect(deriveMcpTiers('mcp__plugin_playwright_playwright__browser_navigate')).toEqual([
      { prefix: 'mcp__plugin_playwright_playwright__', label: 'mcp__plugin_playwright_playwright__*' },
      { prefix: 'mcp__', label: 'mcp__*' },
    ]);
  });

  it('handles a server name containing hyphens', () => {
    expect(deriveMcpTiers('mcp__chrome-devtools__click')).toEqual([
      { prefix: 'mcp__chrome-devtools__', label: 'mcp__chrome-devtools__*' },
      { prefix: 'mcp__', label: 'mcp__*' },
    ]);
  });

  it('returns [] for non-MCP tools (Bash/Edit/Read)', () => {
    expect(deriveMcpTiers('Bash')).toEqual([]);
    expect(deriveMcpTiers('Read')).toEqual([]);
    expect(deriveMcpTiers('Edit')).toEqual([]);
  });

  it('returns [] for malformed names (only 2 segments, or wrong prefix)', () => {
    expect(deriveMcpTiers('mcp__serena')).toEqual([]); // no method segment
    expect(deriveMcpTiers('tool__serena__x')).toEqual([]); // wrong first segment
  });

  it('returns [] for empty / undefined', () => {
    expect(deriveMcpTiers(undefined)).toEqual([]);
    expect(deriveMcpTiers('')).toEqual([]);
  });

  it('still derives 2 tiers for a 4-segment name (only mcp + server matter)', () => {
    // A hypothetical deeper name; we only ever take the mcp + server tiers.
    expect(deriveMcpTiers('mcp__serena__nested__thing')).toEqual([
      { prefix: 'mcp__serena__', label: 'mcp__serena__*' },
      { prefix: 'mcp__', label: 'mcp__*' },
    ]);
  });
});
