import { accountGet } from './accountClient';

export interface AccountPortalData {
  profile?: unknown;
  subscriptionSummary?: unknown;
  activeSubscription?: unknown;
  usage?: unknown;
  loadedAt: string;
}

async function optionalGet(path: string): Promise<unknown> {
  try {
    return await accountGet<unknown>(path);
  } catch {
    return undefined;
  }
}

export async function fetchAccountPortalData(): Promise<AccountPortalData> {
  const [profile, subscriptionSummary, activeSubscription, usage] = await Promise.all([
    optionalGet('/api/dashboard/account'),
    optionalGet('/api/subscriptions/summary'),
    optionalGet('/api/subscriptions/active'),
    optionalGet('/api/dashboard/usage'),
  ]);

  return {
    profile,
    subscriptionSummary,
    activeSubscription,
    usage,
    loadedAt: new Date().toISOString(),
  };
}
