import type { VibeCodingRun } from '../data/platformModels';

export const ACTIVE_AGENT_WINDOW_MS = 24 * 60 * 60 * 1000;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

type SessionActivitySource = Pick<
  VibeCodingRun,
  'lastActivityMs' | 'lastMessage' | 'updatedAt'
>;

const timeOnlyPattern = /^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/;
const zhRelativePattern = /^(\d+)\s*(分钟|分|小时|天)前$/;
const enRelativePattern =
  /^(\d+)\s*(m|min|minute|minutes|h|hr|hour|hours|d|day|days)\s*ago$/;

export const parseConversationTimestampMs = (
  value?: string,
  nowMs = Date.now(),
) => {
  const text = value?.trim();
  if (!text) return 0;

  const normalized = text.toLowerCase();
  if (normalized === 'now' || normalized === 'just now' || text === '刚刚') {
    return nowMs;
  }

  const zhRelative = text.match(zhRelativePattern);
  if (zhRelative) {
    const amount = Number(zhRelative[1]);
    const unit = zhRelative[2];
    if (unit === '分钟' || unit === '分') return nowMs - amount * MINUTE_MS;
    if (unit === '小时') return nowMs - amount * HOUR_MS;
    if (unit === '天') return nowMs - amount * DAY_MS;
  }

  const enRelative = normalized.match(enRelativePattern);
  if (enRelative) {
    const amount = Number(enRelative[1]);
    const unit = enRelative[2];
    if (unit.startsWith('m')) return nowMs - amount * MINUTE_MS;
    if (unit.startsWith('h')) return nowMs - amount * HOUR_MS;
    if (unit.startsWith('d')) return nowMs - amount * DAY_MS;
  }

  const timeOnly = text.match(timeOnlyPattern);
  if (timeOnly) {
    const rawHour = Number(timeOnly[1]);
    if (rawHour > 24) return 0;
    const hour = rawHour === 24 ? 0 : rawHour;
    const minute = Number(timeOnly[2]);
    const second = Number(timeOnly[3] ?? 0);
    const candidate = new Date(nowMs);
    candidate.setHours(hour, minute, second, 0);
    let candidateMs = candidate.getTime();
    if (candidateMs - nowMs > MINUTE_MS) {
      candidateMs -= DAY_MS;
    }
    return candidateMs;
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const formatConversationRelativeShort = (
  ms: number,
  nowMs = Date.now(),
) => {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const diffMin = Math.max(0, Math.floor((nowMs - ms) / MINUTE_MS));
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  return `${Math.floor(diffHour / 24)} 天前`;
};

export const getSessionActivityMs = (
  session: SessionActivitySource,
  nowMs = Date.now(),
) => {
  if (
    Number.isFinite(session.lastActivityMs) &&
    session.lastActivityMs > 0
  ) {
    return session.lastActivityMs;
  }
  return (
    parseConversationTimestampMs(session.lastMessage?.timestamp, nowMs) ||
    parseConversationTimestampMs(session.updatedAt, nowMs)
  );
};

export const isSessionActiveWithin = (
  session: SessionActivitySource,
  windowMs = ACTIVE_AGENT_WINDOW_MS,
  nowMs = Date.now(),
) => {
  const activityMs = getSessionActivityMs(session, nowMs);
  if (!activityMs) return false;
  return nowMs - activityMs <= windowMs;
};
