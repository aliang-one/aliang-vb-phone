/**
 * useSessionHeader — top-level status phase derivation for the chat header.
 *
 * Extracted from VibeCodingSessionScreen: computes the sessionPhase (the L1
 * 整体状态), retry/failure headlines, and the bottom pulse headline from
 * session data + live signals. These are pure derivations consumed by the
 * header JSX + composer lock logic.
 */
import { useMemo } from 'react';
import type { TFunction } from 'i18next';
import type { VibeCodingRun, AgentMessage } from '../../data/platformModels';
import {
  deriveSessionPhase,
  runDisplayPhase,
  type SessionPhase,
} from '../../utils/sessionPhase';
import { lastUnrepliedUserMessageId } from '../../utils/sessionPhase';
import { deriveLivePulse } from '../../utils/activitySummary';
import { GOAL_USER_ACTION_STATES } from '../../utils/goalStatePresentation';

export interface SessionHeaderInput {
  session: VibeCodingRun | undefined;
  isSessionLive: boolean;
  pendingApprovalCount: number;
  transcript: AgentMessage[];
  isDraft: boolean;
  t: TFunction;
}

export interface SessionHeader {
  sessionPhase: SessionPhase;
  failedTurnMessageId: string | undefined;
  retryHeadline: string | undefined;
  failedLabel: string;
  bottomPulseHeadline: string | undefined;
  livePulse: ReturnType<typeof deriveLivePulse>;
}

export function useSessionHeader(input: SessionHeaderInput): SessionHeader {
  const { session, isSessionLive, pendingApprovalCount, transcript, isDraft, t } =
    input;

  const sessionPhase = useMemo<SessionPhase>(
    () => {
      let phase: SessionPhase;
      if (session?.runStateVersion !== undefined && session.phase) {
        phase = runDisplayPhase(
          session.status,
          session.phase,
          session.runStateVersion,
          session.runState,
        );
      } else if (session?.status === 'failed') {
        phase = 'failed';
      } else if (isSessionLive) {
        phase = 'running';
      } else if (session?.phase) {
        phase = session.phase;
      } else {
        phase = deriveSessionPhase(
          session?.status ?? 'idle',
          pendingApprovalCount > 0,
          false,
        );
      }
      if (
        phase === 'completed' &&
        session?.purpose === 'goal' &&
        !!session.goalSummary?.state &&
        GOAL_USER_ACTION_STATES.has(session.goalSummary.state)
      ) {
        phase = 'waiting_approval';
      }
      return phase;
    },
    [
      isSessionLive,
      pendingApprovalCount,
      session?.purpose,
      session?.goalSummary?.state,
      session?.status,
      session?.phase,
      session?.runStateVersion,
      session?.runState,
    ],
  );

  const failedTurnMessageId =
    sessionPhase === 'failed'
      ? lastUnrepliedUserMessageId(transcript)
      : undefined;

  const retryHeadline = session?.retryActive
    ? session.retryMax
      ? session.retryErrorStatus
        ? t('session.error.retryHeadlineGateway', {
            attempt: session.retryAttempt ?? '?',
            max: `/${session.retryMax}`,
            status: session.retryErrorStatus,
          })
        : t('session.error.retryHeadlineMax', {
            attempt: session.retryAttempt ?? '?',
            max: `/${session.retryMax}`,
          })
      : session.retryErrorStatus
        ? t('session.error.retryHeadlineGateway', {
            attempt: session.retryAttempt ?? '?',
            max: '',
            status: session.retryErrorStatus,
          })
        : t('session.error.retryHeadlineMax', {
            attempt: session.retryAttempt ?? '?',
            max: '',
          })
    : undefined;

  const failedLabel = session?.lastErrorStatus
    ? session.lastRetryMax
      ? t('session.error.sessionFailedGatewayRetry', {
          status: session.lastErrorStatus,
          attempt: session.lastRetryAttempt ?? '?',
          max: session.lastRetryMax,
        })
      : t('session.error.sessionFailedGateway', {
          status: session.lastErrorStatus,
        })
    : t('session.error.sessionFailed');

  const livePulse = useMemo(
    () => deriveLivePulse(session?.structuredEvents ?? [], isSessionLive),
    [session?.structuredEvents, isSessionLive],
  );

  const bottomPulseHeadline = isDraft
    ? t('session.phase.pendingStart')
    : sessionPhase === 'failed'
      ? failedLabel
      : sessionPhase === 'completed'
        ? t('session.phase.lastTurnCompleted')
        : sessionPhase === 'waiting_approval'
          ? t('session.phase.waitingApproval')
          : retryHeadline ?? livePulse?.headline;

  return {
    sessionPhase,
    failedTurnMessageId,
    retryHeadline,
    failedLabel,
    bottomPulseHeadline,
    livePulse,
  };
}
