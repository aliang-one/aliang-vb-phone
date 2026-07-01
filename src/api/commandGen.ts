import { apiPost } from './client';

const COMMAND_GEN_TIMEOUT_MS = 120_000;

/**
 * Voice→bash: ask the server to turn a natural-language request into a single
 * bash command. The server runs an LLM tool-calling loop (read-only env tools
 * proxied to the device agent) and returns raw bash + whether it matched the
 * danger filter. The phone gates execution behind a confirm popup.
 */
export type CommandGenMode = 'initial' | 'live';

export interface CommandGenResult {
  command: string;
  dangerous: boolean;
}

export interface GenerateCommandInput {
  text: string;
  deviceId: string;
  cwd: string;
  mode: CommandGenMode;
  sessionId?: string;
  projectId?: string;
}

export const generateCommand = (
  input: GenerateCommandInput,
): Promise<CommandGenResult> =>
  apiPost<CommandGenResult>('/api/ai/command-gen', input, {
    timeoutMs: COMMAND_GEN_TIMEOUT_MS,
  });
