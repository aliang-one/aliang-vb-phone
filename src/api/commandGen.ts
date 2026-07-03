import { apiPost } from './client';

// Phone-side HTTP wait for the POST. Must exceed the server's total loop budget
// (DEFAULT_COMMAND_GEN.timeoutMs = 300000) plus buffer for agent RPC + network,
// so the request isn't aborted client-side while the server loop is still running.
const COMMAND_GEN_TIMEOUT_MS = 320_000;

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
  runId: string;
  /** The device the AI chose (defaults to the request's device if it never called select_device). */
  deviceId?: string;
  deviceName?: string;
  /** The cwd on the chosen device. */
  cwd?: string;
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
