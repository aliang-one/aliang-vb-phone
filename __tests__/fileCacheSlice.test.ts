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

  it('preserves content + etag + previewBlocked when etag matches', async () => {
    useControlCenterStore.setState({
      projectFiles: [seededFile({ content: 'keep', etag: '2:m', previewBlocked: { reason: 'binary', sizeBytes: 2 } })],
    });
    (platformTransport.loadProjectFiles as jest.Mock).mockResolvedValue({
      project_id: 'pj', device_id: 'd', path: '/p', truncated: false, generated_at: 't',
      entries: [{ name: 'a.ts', path: '/p/a.ts', kind: 'file', size_bytes: 2, modified_at: 'm', language: 'TypeScript', summary: 'x' }],
    });
    await useControlCenterStore.getState().loadProjectFiles('pj', '/p', { force: true });
    const f = useControlCenterStore.getState().projectFiles.find(x => x.path === '/p/a.ts')!;
    expect(f.content).toBe('keep');
    expect(f.previewBlocked).toEqual({ reason: 'binary', sizeBytes: 2 });
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
