import { describe, expect, it } from '@jest/globals';
import {
  GOAL_STATE_LABELS,
  GOAL_USER_ACTION_STATES,
  goalStateLabel,
  goalToneForState,
} from '../goalStatePresentation';

describe('goalStatePresentation (Phase 1 可信签署闸)', () => {
  it('labels awaiting_user_acceptance as an action-needed state, NOT completed', () => {
    expect(GOAL_STATE_LABELS.awaiting_user_acceptance).toBe('待你确认完成');
    expect(GOAL_STATE_LABELS.completed).toBe('已完成');
    // The two must differ — coloring/labeling them the same re-creates false completion.
    expect(GOAL_STATE_LABELS.awaiting_user_acceptance).not.toBe(GOAL_STATE_LABELS.completed);
  });

  it('tones awaiting_user_acceptance as warning (action-needed), never success/completed', () => {
    expect(goalToneForState('awaiting_user_acceptance')).toBe('warning');
    expect(goalToneForState('completed')).toBe('success');
    // The sign-off state must NOT take the completed/success tone.
    expect(goalToneForState('awaiting_user_acceptance')).not.toBe('success');
  });

  it('mirrors awaiting_approval tone (both are action-needed)', () => {
    expect(goalToneForState('awaiting_user_acceptance')).toBe(goalToneForState('awaiting_approval'));
  });

  it('goalStateLabel falls back to the raw enum then 同步中', () => {
    expect(goalStateLabel('awaiting_user_acceptance')).toBe('待你确认完成');
    expect(goalStateLabel('not-a-real-state')).toBe('not-a-real-state');
    expect(goalStateLabel(undefined)).toBe('同步中');
  });

  it('classifies the user-action states the session header must not call completed (codex #16)', () => {
    expect(GOAL_USER_ACTION_STATES.has('awaiting_user_acceptance')).toBe(true);
    expect(GOAL_USER_ACTION_STATES.has('awaiting_approval')).toBe(true);
    expect(GOAL_USER_ACTION_STATES.has('blocked')).toBe(true);
    // A running or completed goal is NOT a user-action state.
    expect(GOAL_USER_ACTION_STATES.has('active')).toBe(false);
    expect(GOAL_USER_ACTION_STATES.has('completed')).toBe(false);
  });
});
