import { ApiResponseError } from '../api/client';

// Upstream commandGen failures arrive as ApiResponseError whose code is one of
// the server's dedicated llm_* codes (server/src/commandGen/llmErrors.ts). The
// error text is rendered verbatim, so known codes map to actionable localized
// copy; unknown codes keep the raw message. Moved here from VoiceToBashModal so
// the terminal AI-suggest bar can reuse it (the modal re-exports for compat).
const COMMAND_GEN_ERROR_KEYS: Record<string, string> = {
  llm_model_not_found: 'voiceBash.error.llmModelNotFound',
  llm_auth_failed: 'voiceBash.error.llmAuthFailed',
  llm_rate_limited: 'voiceBash.error.llmRateLimited',
  llm_timeout: 'voiceBash.error.llmTimeout',
  llm_unreachable: 'voiceBash.error.llmUnreachable',
  llm_upstream_error: 'voiceBash.error.llmUpstreamError',
};

export const commandGenErrorText = (
  e: unknown,
  t: (key: string) => string,
): string => {
  const code = e instanceof ApiResponseError ? e.code : undefined;
  if (code && COMMAND_GEN_ERROR_KEYS[code]) return t(COMMAND_GEN_ERROR_KEYS[code]);
  return e instanceof Error && e.message
    ? e.message
    : t('voiceBash.error.generateFallback');
};
