import { useControlCenterStore } from '../src/store/controlCenterStore';

jest.mock('../src/services/platformTransport', () => ({
  platformTransport: {
    loadProjectFiles: jest.fn(),
    loadProjectFileContent: jest.fn(),
    disconnect: jest.fn(),
    connect: jest.fn(),
    send: jest.fn(),
  },
}));

import { platformTransport } from '../src/services/platformTransport';
import { fileCache } from '../src/services/fileCache';

const seededFile = (over: Partial<any> = {}) => ({
  id: 'pj:/p/a.ts', projectId: 'pj', deviceId: 'd', directoryPath: '/p',
  path: '/p/a.ts', name: 'a.ts', kind: 'file' as const, status: 'clean' as const,
  language: 'TypeScript', size: '2 B', sizeBytes: 2, lastTouched: 'm', modifiedAt: 'm',
  summary: 'x', etag: '2:m', ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  fileCache.clear();
  useControlCenterStore.setState({
    serverMode: true,
    projects: [{ id: 'pj', name: 'P', deviceId: 'd', branch: 'main' } as any],
    projectFiles: [],
  });
});

describe('loadProjectFiles etag invalidation', () => {
  it('drops cached content when the list reports a changed etag', async () => {
    useControlCenterStore.setState({
      projectFiles: [seededFile({ content: 'old', encoding: 'utf8', loadedAt: 't', etag: '2:m' })],
    });
    (platformTransport.loadProjectFiles as jest.Mock).mockResolvedValue({
      project_id: 'pj', device_id: 'd', path: '/p', truncated: false, generated_at: 't',
      entries: [{ name: 'a.ts', path: '/p/a.ts', kind: 'file', size_bytes: 99, modified_at: 'm', language: 'TypeScript', summary: 'x' }],
    });
    await useControlCenterStore.getState().loadProjectFiles('pj', '/p', { force: true });
    const f = useControlCenterStore.getState().projectFiles.find(x => x.path === '/p/a.ts')!;
    expect(f.content).toBeUndefined();
    expect(f.etag).toBe('99:m');
  });

  it('preserves content + previewBlocked when etag matches and the file still qualifies as blocked', async () => {
    useControlCenterStore.setState({
      projectFiles: [seededFile({ name: 'a.png', path: '/p/a.png', id: 'pj:/p/a.png', content: 'keep', etag: '2:m', previewBlocked: { reason: 'binary', sizeBytes: 2 } })],
    });
    (platformTransport.loadProjectFiles as jest.Mock).mockResolvedValue({
      project_id: 'pj', device_id: 'd', path: '/p', truncated: false, generated_at: 't',
      entries: [{ name: 'a.png', path: '/p/a.png', kind: 'file', size_bytes: 2, modified_at: 'm', language: 'TypeScript', summary: 'x' }],
    });
    await useControlCenterStore.getState().loadProjectFiles('pj', '/p', { force: true });
    const f = useControlCenterStore.getState().projectFiles.find(x => x.path === '/p/a.png')!;
    expect(f.content).toBe('keep');
    expect(f.previewBlocked).toEqual({ reason: 'binary', sizeBytes: 2 });
  });
});

describe('loadProjectFiles previewBlocked recovery', () => {
  it('clears previewBlocked when a previously too-large file is now small enough', async () => {
    useControlCenterStore.setState({
      projectFiles: [seededFile({ name: 'big.ts', path: '/p/big.ts', id: 'pj:/p/big.ts', sizeBytes: 2_000_000, size: '2 MB', etag: '2000000:m', content: undefined, previewBlocked: { reason: 'too_large', sizeBytes: 2_000_000 } })],
    });
    (platformTransport.loadProjectFiles as jest.Mock).mockResolvedValue({
      project_id: 'pj', device_id: 'd', path: '/p', truncated: false, generated_at: 't',
      entries: [{ name: 'big.ts', path: '/p/big.ts', kind: 'file', size_bytes: 500_000, modified_at: 'm', language: 'TypeScript', summary: 'x' }],
    });
    await useControlCenterStore.getState().loadProjectFiles('pj', '/p', { force: true });
    const f = useControlCenterStore.getState().projectFiles.find(x => x.path === '/p/big.ts')!;
    expect(f.previewBlocked).toBeUndefined();
    expect(f.sizeBytes).toBe(500_000);
  });

  it('keeps previewBlocked (with fresh size) when a too-large file is still too large', async () => {
    useControlCenterStore.setState({
      projectFiles: [seededFile({ name: 'big.ts', path: '/p/big.ts', id: 'pj:/p/big.ts', sizeBytes: 2_000_000, size: '2 MB', etag: '2000000:m', content: undefined, previewBlocked: { reason: 'too_large', sizeBytes: 2_000_000 } })],
    });
    (platformTransport.loadProjectFiles as jest.Mock).mockResolvedValue({
      project_id: 'pj', device_id: 'd', path: '/p', truncated: false, generated_at: 't',
      entries: [{ name: 'big.ts', path: '/p/big.ts', kind: 'file', size_bytes: 3_000_000, modified_at: 'm', language: 'TypeScript', summary: 'x' }],
    });
    await useControlCenterStore.getState().loadProjectFiles('pj', '/p', { force: true });
    const f = useControlCenterStore.getState().projectFiles.find(x => x.path === '/p/big.ts')!;
    expect(f.previewBlocked).toEqual({ reason: 'too_large', sizeBytes: 3_000_000 });
  });
});

describe('loadProjectFileContent blocked handling', () => {
  it('sets previewBlocked for a >1MB file and skips fetch', async () => {
    useControlCenterStore.setState({
      projectFiles: [seededFile({ sizeBytes: 2_000_000, size: '2 MB', etag: '2000000:m', content: undefined })],
    });
    await useControlCenterStore.getState().loadProjectFileContent('pj', '/p/a.ts');
    const f = useControlCenterStore.getState().projectFiles.find(x => x.path === '/p/a.ts')!;
    expect(f.previewBlocked).toEqual({ reason: 'too_large', sizeBytes: 2_000_000 });
    expect(platformTransport.loadProjectFileContent).not.toHaveBeenCalled();
  });
});

describe('dropFileContent', () => {
  it('clears only content fields, keeps metadata', () => {
    useControlCenterStore.setState({
      projectFiles: [seededFile({ content: 'x', encoding: 'utf8', loadedAt: 't', etag: '2:m' })],
    });
    useControlCenterStore.getState().dropFileContent('pj', '/p/a.ts');
    const f = useControlCenterStore.getState().projectFiles.find(x => x.path === '/p/a.ts')!;
    expect(f.content).toBeUndefined();
    expect(f.etag).toBeUndefined();
    expect(f.name).toBe('a.ts');
  });
});

describe('loadProjectFileContent eviction wiring', () => {
  it('drops content of the LRU victim when the content cache exceeds its cap', async () => {
    // 17 distinct files; loading all 17 fills fileCache (cap 16) and the 17th
    // noteContentLoaded evicts the LRU victim (/p/0.ts, oldest) via dropFileContent.
    const files = Array.from({ length: 17 }, (_, i) =>
      seededFile({
        id: `pj:/p/${i}.ts`,
        path: `/p/${i}.ts`,
        name: `${i}.ts`,
        sizeBytes: 2,
        size: '2 B',
        content: undefined,
      }),
    );
    useControlCenterStore.setState({ projectFiles: files });
    (platformTransport.loadProjectFileContent as jest.Mock).mockImplementation(
      async (_projectId: string, path: string) => ({
        project_id: 'pj',
        device_id: 'd',
        path,
        content: `body-${path}`,
        encoding: 'utf8',
        size_bytes: 2,
        modified_at: 'm',
        truncated: false,
      }),
    );

    for (let i = 0; i < 17; i++) {
      await useControlCenterStore.getState().loadProjectFileContent('pj', `/p/${i}.ts`);
    }

    const victim = useControlCenterStore.getState().projectFiles.find(f => f.path === '/p/0.ts')!;
    expect(victim.content).toBeUndefined(); // evicted via dropFileContent
    // a non-victim still holds its content
    const survivor = useControlCenterStore.getState().projectFiles.find(f => f.path === '/p/16.ts')!;
    expect(survivor.content).toBe('body-/p/16.ts');
  });
});
