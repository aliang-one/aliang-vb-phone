// Capability-field pipeline tests: the `download` object on the GET /files
// response must survive the transport → fileCache → loadProjectFiles chain
// and land in state as `fileDownloadCapability` (fileCache itself must NOT
// change — the capability is per-server, not per-file metadata).
jest.mock('../../services/platformTransport', () => ({
  platformTransport: {
    loadProjectFiles: jest.fn(),
    loadProjectFileContent: jest.fn(),
  },
}));

import { useControlCenterStore } from '../controlCenterStore';
import { fileCache } from '../../services/fileCache';
import { platformTransport } from '../../services/platformTransport';
import type { ServerProjectFileList } from '../../api/projects';

const mockedLoadProjectFiles = platformTransport.loadProjectFiles as jest.MockedFunction<
  typeof platformTransport.loadProjectFiles
>;

const makeListSnapshot = (
  projectId: string,
  overrides?: Partial<ServerProjectFileList>,
): ServerProjectFileList => ({
  project_id: projectId,
  device_id: 'dev-1',
  path: '',
  entries: [
    {
      project_id: projectId,
      device_id: 'dev-1',
      path: 'README.md',
      name: 'README.md',
      kind: 'file',
      size_bytes: 128,
      modified_at: '2026-09-20T00:00:00Z',
    },
  ],
  truncated: false,
  generated_at: '2026-09-20T00:00:00Z',
  ...overrides,
});

const resetStore = () => {
  useControlCenterStore.setState({
    serverMode: true,
    projectFiles: [],
    events: [],
    fileDownloadCapability: undefined,
  });
};

beforeEach(() => {
  mockedLoadProjectFiles.mockReset();
  resetStore();
});

describe('loadProjectFiles download capability pipeline', () => {
  test('stores the response `download` object as fileDownloadCapability', async () => {
    const capability = { enabled: true, max_bytes: 52_428_800 };
    mockedLoadProjectFiles.mockResolvedValue(
      makeListSnapshot('cap-proj', { download: capability }),
    );

    await useControlCenterStore.getState().loadProjectFiles('cap-proj', '', {
      force: true,
    });

    expect(useControlCenterStore.getState().fileDownloadCapability).toEqual(
      capability,
    );
    // Pipeline intact: entries still land in projectFiles.
    expect(
      useControlCenterStore
        .getState()
        .projectFiles.filter(file => file.projectId === 'cap-proj'),
    ).toHaveLength(1);
  });

  test('a response without `download` clears the capability to undefined', async () => {
    // Seed a stale capability from a previous response (older server).
    useControlCenterStore.setState({
      fileDownloadCapability: { enabled: true, max_bytes: 1024 },
    });
    mockedLoadProjectFiles.mockResolvedValue(makeListSnapshot('nocap-proj'));

    await useControlCenterStore.getState().loadProjectFiles('nocap-proj', '', {
      force: true,
    });

    expect(
      useControlCenterStore.getState().fileDownloadCapability,
    ).toBeUndefined();
  });

  test('an explicitly disabled capability is preserved as-is', async () => {
    const capability = { enabled: false, max_bytes: 0 };
    mockedLoadProjectFiles.mockResolvedValue(
      makeListSnapshot('disabled-proj', { download: capability }),
    );

    await useControlCenterStore
      .getState()
      .loadProjectFiles('disabled-proj', '', { force: true });

    expect(useControlCenterStore.getState().fileDownloadCapability).toEqual(
      capability,
    );
  });
});

describe('目录级截断标记(审计 #1)', () => {
  test('truncated=true 落进 projectFileListTruncated;重拉全量后清除', async () => {
    mockedLoadProjectFiles.mockResolvedValueOnce(
      makeListSnapshot('trunc-proj', { path: '/work/big', truncated: true }),
    );
    await useControlCenterStore.getState().loadProjectFiles('trunc-proj', '/work/big');

    const key = 'trunc-proj:/work/big';
    expect(useControlCenterStore.getState().projectFileListTruncated[key]).toBe(true);

    // 再拉一次,agent 给了全量 → 标记清除
    mockedLoadProjectFiles.mockResolvedValueOnce(
      makeListSnapshot('trunc-proj', { path: '/work/big', truncated: false }),
    );
    await useControlCenterStore.getState().loadProjectFiles('trunc-proj', '/work/big', {
      force: true,
      maxEntries: 1000,
    });
    expect(
      useControlCenterStore.getState().projectFileListTruncated[key],
    ).toBeUndefined();
  });

  test('maxEntries 进 transport 调用(1000 项全量拉取要真的带上参数)', async () => {
    mockedLoadProjectFiles.mockResolvedValue(makeListSnapshot('me-proj', { truncated: false }));
    await useControlCenterStore.getState().loadProjectFiles('me-proj', '/work/x', {
      force: true,
      maxEntries: 1000,
    });
    expect(mockedLoadProjectFiles).toHaveBeenCalledWith('me-proj', '/work/x', 1000);
  });

  test('不同 maxEntries 的缓存互不命中(fileCache 键隔离)', async () => {
    mockedLoadProjectFiles.mockResolvedValue(
      makeListSnapshot('key-proj', { truncated: true }),
    );
    fileCache.clear();
    await fileCache.listFiles('key-proj', '/work/x', { maxEntries: 200 });
    await fileCache.listFiles('key-proj', '/work/x', { maxEntries: 1000 });
    expect(mockedLoadProjectFiles).toHaveBeenCalledTimes(2);
    fileCache.clear();
  });
});
