/**
 * preview.updated converges the auto port-forwarding mapping state.
 *
 * Server contract: after preview.ready, the tunnel mapping commit is async.
 * The outcome (mapped / failed / unavailable / revoked) is broadcast as
 * preview.updated with the same preview payload plus public_url /
 * port_mapping_id / mapping_status / mapping_error.
 *
 * Phone invariant (spec, 14-task plan T12): preview.updated merges the LINK
 * RECORD ONLY. It must never flip run status — preview.ready already moved the
 * run to preview_ready, and a late (or post-settle) mapping result must not
 * resurrect a settled run. The revoke path (phone DELETE → server broadcast
 * mapping_status='revoked') rides the same event into the same merge.
 */
type SocketHandler = (message: Record<string, unknown>) => void;

let socketHandler: SocketHandler | undefined;

jest.mock('../src/services/websocket', () => ({
  connectMobileSocket: jest.fn((handler: SocketHandler) => {
    socketHandler = handler;
    return { connected: true };
  }),
  disconnectMobileSocket: jest.fn(() => {
    socketHandler = undefined;
  }),
  getActiveSocket: jest.fn(() => ({ connected: true, send: jest.fn() })),
}));

// NOTE: platformTransport is intentionally NOT mocked here — the transport
// layer of this file exercises the real WS-message → transport-event reducer.
// Only websocket is mocked to capture the message handler; the store assertions
// below never call loadSnapshot/connect, so the real singleton is inert.

import { platformTransport } from '../src/services/platformTransport';
import { serverPreviewToClient } from '../src/store/internals';
import { useControlCenterStore } from '../src/store/controlCenterStore';
import type { PlatformPreviewSnapshot } from '../src/services/platformTransport';
import type { PreviewLink, VibeCodingRun } from '../src/data/platformModels';

describe('preview.updated transport normalization', () => {
  beforeEach(() => {
    socketHandler = undefined;
    jest.clearAllMocks();
  });

  afterEach(() => {
    platformTransport.disconnect();
  });

  it('maps preview.updated WS message to preview.updated transport event with mapping fields', () => {
    const events: unknown[] = [];
    const message = {
      type: 'preview.updated',
      preview: {
        id: 'p1',
        session_id: 'ai_1',
        port: 443,
        short_url: 'https://s.test/p1',
        target_url: 'http://localhost:3000',
        public_url: 'https://x.tunnel.test',
        port_mapping_id: 'pm_1',
        mapping_status: 'mapped',
        access: 'private',
      },
    };

    platformTransport.connect(event => {
      events.push(event);
    });
    socketHandler?.(message);

    expect(events).toEqual([
      {
        type: 'preview.updated',
        preview: {
          id: 'p1',
          sessionId: 'ai_1',
          port: 443,
          shortUrl: 'https://s.test/p1',
          targetUrl: 'http://localhost:3000',
          publicUrl: 'https://x.tunnel.test',
          portMappingId: 'pm_1',
          mappingStatus: 'mapped',
          access: 'private',
        },
        expiresIn: '',
        raw: message,
      },
    ]);
  });

  it('maps the revoke broadcast (mapping_status revoked) through the same shape', () => {
    const events: unknown[] = [];

    platformTransport.connect(event => {
      events.push(event);
    });
    socketHandler?.({
      type: 'preview.updated',
      preview: {
        id: 'p1',
        session_id: 'ai_1',
        port: 443,
        short_url: 'https://s.test/p1',
        target_url: 'http://localhost:3000',
        port_mapping_id: 'pm_1',
        mapping_status: 'revoked',
        access: 'private',
      },
    });

    const [event] = events as Array<{ type: string; preview: PlatformPreviewSnapshot }>;
    expect(event.type).toBe('preview.updated');
    expect(event.preview.mappingStatus).toBe('revoked');
    expect(event.preview.publicUrl).toBeUndefined();
  });
});

describe('serverPreviewToClient snapshot hydration', () => {
  it('passes the auto port-forwarding mapping fields through to PreviewLink', () => {
    const link = serverPreviewToClient({
      id: 'p1',
      sessionId: 'ai_1',
      port: 443,
      shortUrl: 'https://s.test/p1',
      targetUrl: 'http://localhost:3000',
      expiresIn: '1h',
      access: 'private',
      publicUrl: 'https://x.tunnel.test',
      portMappingId: 'pm_1',
      mappingStatus: 'mapped',
      mappingError: undefined,
    });

    expect(link.publicUrl).toBe('https://x.tunnel.test');
    expect(link.portMappingId).toBe('pm_1');
    expect(link.mappingStatus).toBe('mapped');
    expect(link.mappingError).toBeUndefined();
  });
});

describe('preview.updated store merge', () => {
  const baseLink = (over: Partial<PreviewLink>): PreviewLink =>
    ({
      id: 'p1',
      sessionId: 'ai_1',
      port: 443,
      shortUrl: 'https://s.test/p1',
      targetUrl: 'http://localhost:3000',
      expiresIn: '1h',
      access: 'private',
      ...over,
    }) as PreviewLink;

  const run = (over: Partial<VibeCodingRun>): VibeCodingRun =>
    ({
      id: 'ai_1',
      deviceId: 'd1',
      projectId: 'proj1',
      status: 'idle',
      transcript: [],
      events: [],
      structuredEvents: [],
      ...over,
    }) as unknown as VibeCodingRun;

  const previewUpdated = (
    preview: Partial<PlatformPreviewSnapshot> = {},
  ): Parameters<ReturnType<typeof useControlCenterStore.getState>['handleTransportEvent']>[0] =>
    ({
      type: 'preview.updated',
      preview: {
        id: 'p1',
        sessionId: 'ai_1',
        port: 443,
        shortUrl: 'https://s.test/p1',
        targetUrl: 'http://localhost:3000',
        publicUrl: 'https://x.tunnel.test',
        portMappingId: 'pm_1',
        mappingStatus: 'mapped',
        access: 'private',
        ...preview,
      },
      raw: {},
    }) as never;

  beforeEach(() => {
    jest.clearAllMocks();
    useControlCenterStore.setState({
      serverMode: true,
      devices: [],
      previewLinks: [baseLink({})],
      vibeRuns: [run({ status: 'idle' })],
    });
  });

  it('preview.updated merges previewLinks without flipping run status', () => {
    useControlCenterStore.getState().handleTransportEvent(previewUpdated());

    const links = useControlCenterStore.getState().previewLinks;
    const merged = links.filter(link => link.id === 'p1');
    expect(merged).toHaveLength(1);
    expect(merged[0].publicUrl).toBe('https://x.tunnel.test');
    expect(merged[0].portMappingId).toBe('pm_1');
    expect(merged[0].mappingStatus).toBe('mapped');

    // THE invariant: a late mapping result never touches run status.
    const runAfter = useControlCenterStore
      .getState()
      .vibeRuns.find(item => item.id === 'ai_1');
    expect(runAfter?.status).toBe('idle');
  });

  it('keeps unrelated links and stays idempotent on repeat broadcasts', () => {
    useControlCenterStore.setState({
      previewLinks: [
        baseLink({ id: 'p0', sessionId: 'ai_0' }),
        baseLink({}),
      ],
      vibeRuns: [run({ id: 'ai_0' }), run({})],
    });

    useControlCenterStore.getState().handleTransportEvent(previewUpdated());
    useControlCenterStore.getState().handleTransportEvent(previewUpdated());

    const links = useControlCenterStore.getState().previewLinks;
    expect(links).toHaveLength(2);
    const merged = links.find(link => link.id === 'p1');
    expect(merged?.publicUrl).toBe('https://x.tunnel.test');
    expect(merged?.mappingStatus).toBe('mapped');
    expect(links.find(link => link.id === 'p0')?.sessionId).toBe('ai_0');
    expect(
      useControlCenterStore.getState().vibeRuns.map(item => item.status),
    ).toEqual(['idle', 'idle']);
  });

  it('converges the revoke broadcast (mappingStatus revoked) with status untouched', () => {
    useControlCenterStore.setState({
      previewLinks: [
        baseLink({
          publicUrl: 'https://x.tunnel.test',
          portMappingId: 'pm_1',
          mappingStatus: 'mapped',
        }),
      ],
    });

    useControlCenterStore
      .getState()
      .handleTransportEvent(
        previewUpdated({ publicUrl: undefined, mappingStatus: 'revoked' }),
      );

    const merged = useControlCenterStore
      .getState()
      .previewLinks.find(link => link.id === 'p1');
    expect(merged?.mappingStatus).toBe('revoked');
    expect(
      useControlCenterStore.getState().vibeRuns.find(item => item.id === 'ai_1')
        ?.status,
    ).toBe('idle');
  });
});
