import { createFileCache } from '../src/services/fileCache';

const mkTransport = () => ({
  loadProjectFiles: jest.fn(),
  loadProjectFileContent: jest.fn(),
});

describe('fileCache.listFiles', () => {
  it('dedups concurrent calls (transport called once)', async () => {
    const transport = mkTransport();
    let resolveList: (v: any) => void = () => {};
    transport.loadProjectFiles.mockReturnValue(
      new Promise(res => {
        resolveList = res;
      }),
    );
    const now = jest.fn(() => 1000);
    const cache = createFileCache({ transport: transport as any, now });

    const p1 = cache.listFiles('pj', '/p');
    const p2 = cache.listFiles('pj', '/p');
    resolveList({ project_id: 'pj', device_id: 'd', path: '/p', entries: [], truncated: false, generated_at: 't' });
    const [a, b] = await Promise.all([p1, p2]);

    expect(transport.loadProjectFiles).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it('serves cached list within TTL without calling transport', async () => {
    const transport = mkTransport();
    transport.loadProjectFiles.mockResolvedValue({ project_id: 'pj', device_id: 'd', path: '/p', entries: [], truncated: false, generated_at: 't' });
    let t = 1000;
    const now = jest.fn(() => t);
    const cache = createFileCache({ transport: transport as any, now });

    await cache.listFiles('pj', '/p');
    await cache.listFiles('pj', '/p'); // within TTL
    expect(transport.loadProjectFiles).toHaveBeenCalledTimes(1);

    t = 1000 + 16_000; // past 15s TTL
    await cache.listFiles('pj', '/p');
    expect(transport.loadProjectFiles).toHaveBeenCalledTimes(2);
  });

  it('force bypasses TTL', async () => {
    const transport = mkTransport();
    transport.loadProjectFiles.mockResolvedValue({ project_id: 'pj', device_id: 'd', path: '/p', entries: [], truncated: false, generated_at: 't' });
    const now = jest.fn(() => 1000);
    const cache = createFileCache({ transport: transport as any, now });

    await cache.listFiles('pj', '/p');
    await cache.listFiles('pj', '/p', { force: true });
    expect(transport.loadProjectFiles).toHaveBeenCalledTimes(2);
  });
});
