import i18n from '../src/i18n';
import { useControlCenterStore } from '../src/store/controlCenterStore';
import { classifySessionBusyError } from '../src/utils/sessionBusyError';
import type { VibeCodingRun } from '../src/data/platformModels';

const TUI_BUSY_RAW =
  'TUI session is running an active turn in its terminal; retry after it finishes';

const run = (): VibeCodingRun => ({
  id: 's1',
  title: 'run-s1',
  deviceId: 'device-1',
  projectId: 'project-1',
  directory: '~/proj',
  status: 'running',
  objective: '',
  model: 'Claude Code',
  risk: 'medium',
  currentStep: '',
  branch: 'main',
  lastActivityMs: 0,
  updatedAt: '',
  suggestions: [],
  transcript: [],
  events: [],
  structuredEvents: [],
});

const seedAndDispatch = (error: string): string | undefined => {
  useControlCenterStore.setState({ vibeRuns: [run()], events: [] });
  useControlCenterStore.getState().handleTransportEvent({
    type: 'ai.error',
    sessionId: 's1',
    error,
  } as never);
  return useControlCenterStore
    .getState()
    .vibeRuns.find(item => item.id === 's1')?.currentStep;
};

describe('ai.error busy-class friendly copy', () => {
  it('maps the agent tui_busy precheck refusal to the localized sessionBusyTui copy', () => {
    expect(classifySessionBusyError(TUI_BUSY_RAW)).toBe('tui_busy');
    const step = seedAndDispatch(TUI_BUSY_RAW);
    expect(step).toBe(i18n.t('vibecoding:session.error.sessionBusyTui'));
    expect(step).not.toBe(TUI_BUSY_RAW);
  });

  it('maps the server ai_session_busy refusal to the localized sessionBusy copy', () => {
    const step = seedAndDispatch('ai_session_busy');
    expect(step).toBe(i18n.t('vibecoding:session.error.sessionBusy'));
  });

  it('passes non-busy agent errors through untouched', () => {
    const step = seedAndDispatch('upstream exploded for real');
    expect(step).toBe('upstream exploded for real');
  });
});
