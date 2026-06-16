import {
  ACTIVE_AGENT_WINDOW_MS,
  formatConversationRelativeShort,
  isSessionActiveWithin,
  parseConversationTimestampMs,
} from '../src/utils/conversationActivity';
import type { VibeCodingRun } from '../src/data/platformModels';

type ActivitySource = Pick<
  VibeCodingRun,
  'lastActivityMs' | 'lastMessage' | 'updatedAt'
>;

const nowMs = new Date('2026-06-16T10:10:00').getTime();

const activitySource = (lastActivityMs: number): ActivitySource => ({
  lastActivityMs,
  updatedAt: '',
});

describe('conversationActivity', () => {
  it('parses display-only clock timestamps as activity from today', () => {
    const parsed = parseConversationTimestampMs('10:03:00', nowMs);

    expect(nowMs - parsed).toBe(7 * 60 * 1000);
  });

  it('parses relative labels used by the home event stream', () => {
    expect(parseConversationTimestampMs('刚刚', nowMs)).toBe(nowMs);
    expect(nowMs - parseConversationTimestampMs('5 分钟前', nowMs)).toBe(
      5 * 60 * 1000,
    );
    expect(nowMs - parseConversationTimestampMs('2 hours ago', nowMs)).toBe(
      2 * 60 * 60 * 1000,
    );
  });

  it('treats recently updated idle or completed sessions as 24h active', () => {
    expect(
      isSessionActiveWithin(
        activitySource(nowMs - 3 * 60 * 1000),
        ACTIVE_AGENT_WINDOW_MS,
        nowMs,
      ),
    ).toBe(true);
  });

  it('filters sessions outside the 24h activity window', () => {
    expect(
      isSessionActiveWithin(
        activitySource(nowMs - ACTIVE_AGENT_WINDOW_MS - 1),
        ACTIVE_AGENT_WINDOW_MS,
        nowMs,
      ),
    ).toBe(false);
  });

  it('renders short relative labels from authoritative activity time', () => {
    expect(formatConversationRelativeShort(nowMs - 90 * 60 * 1000, nowMs)).toBe(
      '1 小时前',
    );
  });
});
