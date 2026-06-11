export const LOCAL_SERVICE_HOST = '172.16.0.123';
export const LOCAL_SERVICE_PORT = 5174;
export const LOCAL_SERVICE_BASE_URL = `http://${LOCAL_SERVICE_HOST}:${LOCAL_SERVICE_PORT}`;
export const LOCAL_SERVICE_WS_URL = `ws://${LOCAL_SERVICE_HOST}:${LOCAL_SERVICE_PORT}`;
export const LOCAL_SERVICE_AUTH_URL = `${LOCAL_SERVICE_BASE_URL}/api/login`;

export interface LocalServiceHealth {
  ok: boolean;
  status?: number;
  latencyMs: number;
  checkedAt: string;
  message: string;
}

const timeout = (ms: number) =>
  new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });

export const checkLocalService = async (
  timeoutMs = 5000,
): Promise<LocalServiceHealth> => {
  const startedAt = Date.now();

  try {
    const response = await Promise.race([
      fetch(LOCAL_SERVICE_BASE_URL, { method: 'GET' }),
      timeout(timeoutMs),
    ]);
    const latencyMs = Date.now() - startedAt;

    return {
      ok: response.ok,
      status: response.status,
      latencyMs,
      checkedAt: new Date().toLocaleTimeString(),
      message: response.ok
        ? `Connected to ${LOCAL_SERVICE_BASE_URL}`
        : `Service responded with HTTP ${response.status}`,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;

    return {
      ok: false,
      latencyMs,
      checkedAt: new Date().toLocaleTimeString(),
      message:
        error instanceof Error
          ? error.message
          : `Unable to reach ${LOCAL_SERVICE_BASE_URL}`,
    };
  }
};
