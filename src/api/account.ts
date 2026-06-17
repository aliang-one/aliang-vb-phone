import { accountGet } from './accountClient';

/**
 * Account data from aliang-official-website backend (sub2api upstream).
 *
 * Real API endpoints:
 *  - AccountProfile         ← /api/dashboard/account (proxies to /api/v1/user/profile)
 *  - UserSubscription[]     ← /api/subscriptions/active (proxies to /api/v1/subscriptions/active)
 *  - SubscriptionSummary    ← /api/subscriptions/summary (local package subscriptions)
 *  - UsageStats             ← /api/v1/usage/stats (proxied via /api/dashboard/usage)
 */

/** User profile from sub2api with balance and group access. */
export interface AccountProfile {
  id: number | string;
  email: string;
  username: string;
  role: string;
  /** Account balance in USD. */
  balance: number;
  /** Cumulative recharge amount. */
  total_recharged?: number;
  /** Concurrent request limit. */
  concurrency?: number;
  /** User status: active / suspended / etc. */
  status: string;
  /** Groups the user has access to (subscription-based). */
  allowed_groups?: number[];
  /** Per-minute request limit (0 = unlimited). */
  rpm_limit?: number;
  /** Avatar URL. */
  avatar_url?: string | null;
  created_at?: string;
  updated_at?: string;
  last_active_at?: string | null;
}

/** Group info (model access group with rate multiplier and usage limits). */
export interface AccountGroup {
  id: number | string;
  name: string;
  description?: string;
  platform: string;
  /** Rate multiplier for pricing. */
  rate_multiplier: number;
  /** Subscription type: prepaid / postpaid / etc. */
  subscription_type?: string;
  /** Daily usage limit in USD (null = unlimited). */
  daily_limit_usd?: number | null;
  /** Weekly usage limit in USD. */
  weekly_limit_usd?: number | null;
  /** Monthly usage limit in USD. */
  monthly_limit_usd?: number | null;
  status: string;
  is_exclusive?: boolean;
  allow_image_generation?: boolean;
  claude_code_only?: boolean;
  allow_messages_dispatch?: boolean;
}

/** User's subscription to a group (time-bound access). */
export interface AccountSubscription {
  id: number | string;
  user_id: number | string;
  group_id: number | string;
  /** Subscription start time. */
  starts_at: string;
  /** Subscription expiry time. */
  expires_at: string;
  status: string;
  /** Daily usage in USD. */
  daily_usage_usd?: number;
  /** Weekly usage in USD. */
  weekly_usage_usd?: number;
  /** Monthly usage in USD. */
  monthly_usage_usd?: number;
  /** Group info embedded. */
  group?: AccountGroup;
  created_at?: string;
  updated_at?: string;
}

/** Package subscription from local als_subscriptions/als_tiers tables. */
export interface PackageSubscription {
  id: number | string;
  package_code: string;
  package_name: string;
  status: string;
  started_at: string;
  expires_at: string;
  price_micros?: number;
  value_type?: string;
  value_amount?: number;
  description?: string;
  features?: string[];
  group_ids?: number[];
  source: 'package';
}

export interface SubscriptionSummary {
  active_count: number;
  total_used_usd?: number;
  subscriptions: PackageSubscription[];
}

/** Usage statistics (token counts, cost, request counts). */
export interface UsageStats {
  /** Total number of API requests. */
  total_requests: number;
  /** Total input tokens across all requests. */
  total_input_tokens: number;
  /** Total output tokens. */
  total_output_tokens: number;
  /** Total cached tokens (prompt cache). */
  total_cache_tokens?: number;
  /** Total tokens (input + output). */
  total_tokens: number;
  /** Sticker price cost in USD. */
  total_cost: number;
  /** Actual cost after discounts/rates in USD. */
  total_actual_cost: number;
  /** Average request duration in milliseconds. */
  average_duration_ms?: number;
}

export interface AccountPortalData {
  profile?: AccountProfile;
  subscriptions?: AccountSubscription[];
  packageSummary?: SubscriptionSummary;
  usageStats?: UsageStats;
  loadedAt: string;
}

/** Peel the server's { code, msg, data } envelope; tolerate a bare payload. */
function unwrap<T>(value: unknown): T | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const root = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(root, 'data')) {
    const data = root.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const inner = data as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(inner, 'data')) {
        return (inner.data as T) ?? undefined;
      }
      return data as T;
    }
    return undefined;
  }
  return root as T;
}

async function optionalGet<T>(path: string): Promise<T | undefined> {
  try {
    const raw = await accountGet<unknown>(path);
    return unwrap<T>(raw);
  } catch {
    // The portal must stay usable when one source is unavailable (e.g. 401).
    return undefined;
  }
}

export async function fetchAccountPortalData(): Promise<AccountPortalData> {
  // Fetch profile, active subscriptions, package summary, and usage stats.
  // Note: /api/dashboard/account proxies to /api/v1/user/profile
  // /api/subscriptions/active proxies to /api/v1/subscriptions/active
  // /api/subscriptions/summary returns local package subscriptions
  // /api/dashboard/usage proxies to /api/v1/usage (list endpoint; for stats use /api/v1/usage/stats)
  const [profile, subscriptions, packageSummary, usageStats] = await Promise.all([
    optionalGet<AccountProfile>('/api/dashboard/account'),
    optionalGet<AccountSubscription[]>('/api/subscriptions/active'),
    optionalGet<SubscriptionSummary>('/api/subscriptions/summary'),
    // Usage stats with period=today (current day stats)
    optionalGet<UsageStats>('/api/v1/usage/stats?period=today'),
  ]);

  return {
    profile,
    subscriptions,
    packageSummary,
    usageStats,
    loadedAt: new Date().toISOString(),
  };
}