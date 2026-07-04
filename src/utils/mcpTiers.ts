// MCP tool-name namespace tier derivation.
//
// MCP tool names follow `mcp__<server>__<method>` where the delimiter between
// segments is a DOUBLE underscore (`__`). Server names may themselves contain
// single underscores (e.g. `mcp__plugin_playwright_playwright__browser_navigate`
// → server `plugin_playwright_playwright`), so splitting on `__` is the only
// reliable parse — splitting on `_` would shred the server name.
//
// From a tool name we derive up to two auto-approve prefixes, most-specific
// first:
//   - server tier:  `mcp__<server>__`  (one server's tools)
//   - all-MCP tier: `mcp__`            (every MCP server)
// Non-MCP / malformed names return [].

export interface McpTier {
  prefix: string;
  /** Display label, e.g. 'mcp__serena__*' / 'mcp__*'. */
  label: string;
}

export function deriveMcpTiers(toolName?: string): McpTier[] {
  if (!toolName) return [];
  const parts = toolName.split('__');
  if (parts.length < 3 || parts[0] !== 'mcp') return [];
  const server = parts[1];
  if (!server) return [];
  return [
    { prefix: `mcp__${server}__`, label: `mcp__${server}__*` },
    { prefix: 'mcp__', label: 'mcp__*' },
  ];
}
