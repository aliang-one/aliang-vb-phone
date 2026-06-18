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

describe('fileCache.readFile', () => {
  const content = (over: Partial<any> = {}) => ({
    project_id: 'pj', device_id: 'd', path: '/p/a.ts', content: 'x',
    encoding: 'utf8', size_bytes: 2, modified_at: 'm', truncated: false, ...over,
  });

  it('blocks binary files by extension', async () => {
    const transport = mkTransport();
    const cache = createFileCache({ transport: transport as any, now: () => 1000 });
    const r = await cache.readFile('pj', '/p/a.png', { name: 'a.png', sizeBytes: 10 });
    expect(r).toEqual({ kind: 'blocked', reason: 'binary', sizeBytes: 10 });
    expect(transport.loadProjectFileContent).not.toHaveBeenCalled();
  });

  it('blocks text files larger than 1MB', async () => {
    const transport = mkTransport();
    const cache = createFileCache({ transport: transport as any, now: () => 1000 });
    const r = await cache.readFile('pj', '/p/big.ts', { name: 'big.ts', sizeBytes: 2_000_000 });
    expect(r).toEqual({ kind: 'blocked', reason: 'too_large', sizeBytes: 2_000_000 });
    expect(transport.loadProjectFileContent).not.toHaveBeenCalled();
  });

  it('fetches small text files and dedups concurrent reads', async () => {
    const transport = mkTransport();
    transport.loadProjectFileContent.mockResolvedValue(content());
    const cache = createFileCache({ transport: transport as any, now: () => 1000 });
    const [a, b] = await Promise.all([
      cache.readFile('pj', '/p/a.ts', { name: 'a.ts', sizeBytes: 2 }),
      cache.readFile('pj', '/p/a.ts', { name: 'a.ts', sizeBytes: 2 }),
    ]);
    expect(transport.loadProjectFileContent).toHaveBeenCalledTimes(1);
    expect(a.kind).toBe('fetched');
    expect(b).toBe(a);
  });

  it('returns cache_hit within TTL when caller reports cached content', async () => {
    const transport = mkTransport();
    transport.loadProjectFileContent.mockResolvedValue(content());
    let t = 1000;
    const now = jest.fn(() => t);
    const cache = createFileCache({ transport: transport as any, now });
    const fetched = await cache.readFile('pj', '/p/a.ts', { name: 'a.ts', sizeBytes: 2 });
    expect(fetched.kind).toBe('fetched');
    // caller writes content + calls noteContentLoaded (sets loadedAt)
    cache.noteContentLoaded('pj', '/p/a.ts', 2, '2:m');
    t = 1000 + 30_000; // within 60s
    const hit = await cache.readFile('pj', '/p/a.ts', { name: 'a.ts', sizeBytes: 2 }, { hasCachedContent: true });
    expect(hit).toEqual({ kind: 'cache_hit' });
    expect(transport.loadProjectFileContent).toHaveBeenCalledTimes(1);
  });

  it('refetches after content TTL expires', async () => {
    const transport = mkTransport();
    transport.loadProjectFileContent.mockResolvedValue(content());
    let t = 1000;
    const now = jest.fn(() => t);
    const cache = createFileCache({ transport: transport as any, now });
    await cache.readFile('pj', '/p/a.ts', { name: 'a.ts', sizeBytes: 2 });
    cache.noteContentLoaded('pj', '/p/a.ts', 2, '2:m');
    t = 1000 + 61_000; // past 60s
    const r = await cache.readFile('pj', '/p/a.ts', { name: 'a.ts', sizeBytes: 2 }, { hasCachedContent: true });
    expect(r.kind).toBe('fetched');
    expect(transport.loadProjectFileContent).toHaveBeenCalledTimes(2);
  });

  it('falls through to fetch when size is unknown', async () => {
    const transport = mkTransport();
    transport.loadProjectFileContent.mockResolvedValue(content());
    const cache = createFileCache({ transport: transport as any, now: () => 1000 });
    const r = await cache.readFile('pj', '/p/a.ts', { name: 'a.ts' });
    expect(r.kind).toBe('fetched');
  });
});
