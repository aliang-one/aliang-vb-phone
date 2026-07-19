/**
 * Reference-stability tests for the churn-stable list selector.
 *
 * `useStableVibeRuns` exists so list screens (VibeCodingListScreen /
 * DeviceDetailScreen / ProjectDetailScreen / ...) do NOT re-render on every
 * thinking token / streaming delta. Those updates only mutate a run's
 * `structuredEvents` / `events` / `transcript` — none of which a list or
 * VibeSessionCard renders (cards show metadata: status / currentStep / branch /
 * ...). `toStableRun` caches per-id and returns the SAME run object reference
 * whenever the run's metadata is unchanged, so `useShallow` over the mapped
 * array sees identical elements and bails out → the subscriber never re-renders.
 *
 * Variants are built with object SPREAD (`{ ...run, structuredEvents }`) to
 * faithfully mirror how the store actually updates a run (`applyStructuredEvent`
 * does `{ ...run, structuredEvents }`, PRESERVING every other field's identity).
 * Reconstructing a run field-by-field would give fresh array identities and
 * falsely look like a metadata change — not what production does.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import {
  toStableRun,
  useControlCenterStore,
  useStableVibeRuns,
} from '../src/store/controlCenterStore';
import type { VibeCodingRun } from '../src/data/platformModels';

jest.mock('../src/services/platformTransport', () => ({
  platformTransport: {
    disconnect: jest.fn(),
    loadSnapshot: jest.fn(),
    connect: jest.fn(),
  },
}));

const baseRun = (overrides: Partial<VibeCodingRun> = {}): VibeCodingRun => ({
  id: 'session-A',
  title: 'title',
  deviceId: 'device-1',
  projectId: 'project-1',
  directory: '~/proj',
  status: 'running',
  objective: '',
  model: 'Claude Code',
  risk: 'medium',
  currentStep: '',
  branch: 'main',
  lastActivityMs: 1000,
  updatedAt: '',
  suggestions: [],
  transcript: [],
  events: [],
  structuredEvents: [],
  ...overrides,
});

describe('toStableRun (pure helper)', () => {
  it('returns the SAME reference when only structuredEvents changed', () => {
    const run = baseRun({ id: 'pure-stable-1' });
    const first = toStableRun(run);
    // A thinking flush produces a NEW run object differing ONLY in structuredEvents.
    const afterThinking: VibeCodingRun = {
      ...run,
      structuredEvents: [
        { kind: 'thinking', eventId: 'e1', messageId: 'm', active: true, chars: 42 },
      ],
    };
    expect(toStableRun(afterThinking)).toBe(first); // same ref → list won't re-render
  });

  it('returns a NEW reference when a visible metadata field (status) changed', () => {
    const run = baseRun({ id: 'pure-stable-2', status: 'running' });
    const first = toStableRun(run);
    const afterStatus: VibeCodingRun = { ...run, status: 'completed' };
    const second = toStableRun(afterStatus);
    expect(second).not.toBe(first);
    expect(second.status).toBe('completed');
  });

  it('coalesces volatile activity changes within 500ms, then publishes', () => {
    const run = baseRun({ id: 'pure-stable-3', lastActivityMs: 1000 });
    const first = toStableRun(run, 1000);
    const changed = { ...run, lastActivityMs: 2000 };
    expect(toStableRun(changed, 1200)).toBe(first);
    expect(toStableRun(changed, 1500)).not.toBe(first);
  });

  it('returns the SAME reference when only transcript changed (streaming text)', () => {
    const run = baseRun({ id: 'pure-stable-4' });
    const first = toStableRun(run);
    const after: VibeCodingRun = {
      ...run,
      transcript: [{ role: 'assistant', content: 'hi' } as never],
    };
    expect(toStableRun(after)).toBe(first);
  });
});

describe('useStableVibeRuns (rendered hook)', () => {
  let probeRenders = 0;
  const Probe: React.FC = () => {
    probeRenders += 1;
    useStableVibeRuns();
    return null;
  };

  beforeEach(() => {
    probeRenders = 0;
  });

  // Seed store state and mount the probe in SEPARATE acts so a queued
  // setState notification can't flush after the probe subscribes. We assert the
  // DELTA after mount (additional renders): React 19 dev double-invokes render
  // functions, so the absolute count is unreliable — only "did it re-render at
  // all" matters, and that is exactly what the fix controls.
  const mountWith = (runs: VibeCodingRun[]) => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      useControlCenterStore.setState({ vibeRuns: runs });
    });
    act(() => {
      renderer = TestRenderer.create(<Probe />);
    });
    return () => act(() => renderer!.unmount());
  };

  it('does NOT re-render when only structuredEvents change (thinking churn)', () => {
    const run = baseRun({ id: 'int-stable-1' });
    const unmount = mountWith([run]);
    const rendersAtMount = probeRenders;

    // Simulate a thinking flush: spread preserves identity of every other field,
    // exactly like applyStructuredEvent — so only structuredEvents differs.
    act(() => {
      useControlCenterStore.setState({
        vibeRuns: [
          {
            ...run,
            structuredEvents: [
              { kind: 'thinking', eventId: 'e1', messageId: 'm', active: true, chars: 99 },
            ],
          },
        ],
      });
    });
    expect(probeRenders).toBe(rendersAtMount); // zero additional renders — the whole point
    unmount();
  });

  it('re-renders when a visible metadata field (status) changes', () => {
    const run = baseRun({ id: 'int-stable-2', status: 'running' });
    const unmount = mountWith([run]);
    const rendersAtMount = probeRenders;

    act(() => {
      useControlCenterStore.setState({
        vibeRuns: [{ ...run, status: 'completed' }],
      });
    });
    expect(probeRenders).toBeGreaterThan(rendersAtMount); // at least one re-render
    unmount();
  });
});
