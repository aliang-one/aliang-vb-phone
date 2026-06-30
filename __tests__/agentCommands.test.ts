import { mergeCommands, builtinCommandsFor } from '../src/utils/agentCommands';

describe('agentCommands', () => {
  it('falls back to the full builtin surface when the agent reports nothing', () => {
    // Production Go agent (no discovery) → undefined → universal builtins fill in.
    const claude = mergeCommands('claude_code', undefined);
    expect(claude.map(c => c.name)).toEqual(
      builtinCommandsFor('claude_code').map(c => c.name),
    );
    expect(claude.some(c => c.name === 'clear')).toBe(true);
    expect(claude.some(c => c.name === 'compact')).toBe(true);

    const codex = mergeCommands('codex', undefined);
    expect(codex.some(c => c.name === 'diff')).toBe(true);

    const opencode = mergeCommands('opencode', undefined);
    expect(opencode.map(c => c.name)).toEqual(
      builtinCommandsFor('opencode').map(c => c.name),
    );
    expect(opencode.some(c => c.name === 'model')).toBe(true);
  });

  it('puts agent commands first and appends builtins that are missing', () => {
    const agent = [
      { name: 'mycmd', description: '项目自定义', scope: 'project' as const },
    ];
    const merged = mergeCommands('claude_code', agent);
    // Agent (custom) command first.
    expect(merged[0]).toEqual(agent[0]);
    // Builtins fill the rest.
    expect(merged.some(c => c.name === 'clear')).toBe(true);
    // No duplicate of the agent command.
    expect(merged.filter(c => c.name === 'mycmd')).toHaveLength(1);
  });

  it('lets an agent-reported command shadow a same-named builtin (no dup)', () => {
    const agent = [
      { name: 'clear', description: 'agent 的真实描述', scope: 'builtin' as const },
    ];
    const merged = mergeCommands('claude_code', agent);
    const clears = merged.filter(c => c.name === 'clear');
    expect(clears).toHaveLength(1);
    // Agent's version wins.
    expect(clears[0].description).toBe('agent 的真实描述');
  });

  it('is never empty for a known provider', () => {
    expect(mergeCommands('claude_code', []).length).toBeGreaterThan(0);
    expect(mergeCommands('codex', []).length).toBeGreaterThan(0);
    expect(mergeCommands('opencode', []).length).toBeGreaterThan(0);
  });
});
