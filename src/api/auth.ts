import { LOCAL_SERVICE_AUTH_URL } from '../config/localService';

interface AuthResponse {
  agentId?: string;
  user?: {
    id?: string;
    email?: string;
    name?: string;
  };
}

export interface LoginResult {
  agentId: string;
  accessToken: string;
}

const getErrorMessage = async (response: Response) => {
  try {
    const payload = await response.json();
    if (typeof payload?.error === 'string') {
      return payload.error;
    }
    if (typeof payload?.message === 'string') {
      return payload.message;
    }
  } catch {
    // Ignore non-JSON responses.
  }

  return `Login failed with HTTP ${response.status}`;
};

export const loginWithAccessKey = async (
  agentId: string,
  accessKey: string,
): Promise<LoginResult> => {
  const response = await fetch(LOCAL_SERVICE_AUTH_URL, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  let payload: AuthResponse = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  return {
    agentId:
      payload.agentId ??
      payload.user?.email ??
      payload.user?.name ??
      payload.user?.id ??
      agentId,
    accessToken: accessKey,
  };
};
