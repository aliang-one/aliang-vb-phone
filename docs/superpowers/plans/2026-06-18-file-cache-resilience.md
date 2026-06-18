# File Browser — Cache, Consistency & Large-File Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-memory `fileCache` layer to the phone app that dedups in-flight file requests, TTL/etag-validates cached content, bounds cached content via LRU, and blocks binary / >1 MB files from auto-preview — no server or Agent changes.

**Architecture:** A new pure-TS module `src/services/fileCache.ts` sits between the store and `platformTransport` and owns policy (dedup, TTL, etag, LRU, large-file gate). Content **bytes** stay in the store (`projectFiles[i].content`); the cache holds only metadata. Eviction is computed by the cache and executed by a new store action `dropFileContent`. Consistency uses a free `size+mtime` etag (no full-file hash).

**Tech Stack:** TypeScript, React Native 0.85, Zustand store slices, Jest (RN preset), `react-native-svg` icons.

**Spec:** `docs/superpowers/specs/2026-06-18-file-cache-resilience-design.md`

---

## File Structure

- **Create** `src/services/fileCache.ts` — pure-TS cache: dedup, TTL, etag, LRU, large-file gate. Factory `createFileCache(deps)` + singleton `fileCache`. No React/RN imports (fully unit-testable).
- **Create** `__tests__/fileCache.test.ts` — unit tests for the module (mock transport + fake clock).
- **Modify** `src/store/types.ts` — add `etag?`, `previewBlocked?` to `ProjectFileEntry`; add `force?` to the two action signatures; add `dropFileContent`.
- **Modify** `src/store/internals.ts` — set `etag` in `serverProjectFileToClient` and `serverProjectContentToFileEntry`.
- **Modify** `src/store/slices/deviceProjectSlice.ts` — route the two actions through `fileCache`; etag-invalidation on list merge (incl. preserve `etag`/`previewBlocked`); handle `blocked`; add `dropFileContent`.
- **Modify** `src/screens/projects/FileBrowserScreen.tsx` — pass `{force:true}` on REFRESH; render a blocked panel when `previewBlocked` is set.
- **Create** `__tests__/fileCacheSlice.test.ts` — slice-level tests (mocked transport) for etag invalidation, blocked handling, eviction wiring.

---

## Task 1: `fileCache` core — constants, types, factory, `listFiles` dedup + TTL

**Files:**
- Create: `src/services/fileCache.ts`
- Create: `__tests__/fileCache.test.ts`

- [ ] **Step 1: Write the failing tests for `listFiles` (dedup + TTL)**

Create `__tests__/fileCache.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/fileCache.test.ts`
Expected: FAIL — `Cannot find module '../src/services/fileCache'`.

- [ ] **Step 3: Implement the module core + `listFiles`**

Create `src/services/fileCache.ts`:

```ts
import { platformTransport } from './platformTransport';
import type {
  PlatformProjectFileContentSnapshot,
  PlatformProjectFileListSnapshot,
} from './platformTransport'; // these aliases are defined in platformTransport.ts, NOT api/projects.ts

// --- Tunable knobs (module-level, easy to adjust) ---
const LIST_TTL_MS = 15_000;
const CONTENT_TTL_MS = 60_000;
const MAX_CONTENT_ENTRIES = 16;
const MAX_CONTENT_BYTES = 6 * 1024 * 1024; // 6 MB
const LARGE_FILE_BYTES = 1 * 1024 * 1024; // 1 MB

const BINARY_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'svgz',
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'mp3', 'wav', 'flac', 'ogg', 'aac',
  'zip', 'tar', 'gz', 'tgz', 'bz2', 'rar', '7z',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'woff', 'woff2', 'ttf', 'otf',
  'exe', 'dll', 'so', 'dylib', 'class', 'jar', 'wasm', 'o', 'pdb', 'db', 'sqlite',
]);

export interface FileCacheTransport {
  loadProjectFiles(projectId: string, path?: string): Promise<PlatformProjectFileListSnapshot>;
  loadProjectFileContent(projectId: string, path: string): Promise<PlatformProjectFileContentSnapshot>;
}

export interface FileCacheDeps {
  transport: FileCacheTransport;
  now: () => number;
}

export interface ReadMeta {
  name: string;
  sizeBytes?: number;
}

export type ReadOutcome =
  | { kind: 'blocked'; reason: 'too_large' | 'binary'; sizeBytes?: number }
  | { kind: 'cache_hit' }
  | { kind: 'fetched'; content: PlatformProjectFileContentSnapshot };

interface ListCacheEntry {
  result: PlatformProjectFileListSnapshot;
  fetchedAt: number;
}

interface ContentCacheEntry {
  etag: string;
  loadedAt: number;
  lastAccess: number;
  bytes: number;
}

const listKey = (projectId: string, path: string) => `list:${projectId}:${path}`;
const readKey = (projectId: string, path: string) => `read:${projectId}:${path}`;

export const extOf = (name: string): string => {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
};

export const isBinaryByName = (name: string): boolean => BINARY_EXTS.has(extOf(name));

export interface FileCache {
  listFiles(projectId: string, path: string, opts?: { force?: boolean }): Promise<PlatformProjectFileListSnapshot>;
  readFile(
    projectId: string,
    path: string,
    meta: ReadMeta,
    opts?: { force?: boolean; hasCachedContent?: boolean },
  ): Promise<ReadOutcome>;
  noteContentLoaded(projectId: string, path: string, bytes: number, etag: string): string[];
  touch(projectId: string, path: string): void;
  invalidateContent(projectId: string, path: string): void;
  clear(): void;
}

export function createFileCache(deps: FileCacheDeps): FileCache {
  const { transport, now } = deps;
  const listCache = new Map<string, ListCacheEntry>();
  const contentCache = new Map<string, ContentCacheEntry>();
  const inflight = new Map<string, Promise<unknown>>();

  return {
    async listFiles(projectId, path, opts) {
      const key = listKey(projectId, path);
      const force = opts?.force ?? false;
      const cached = listCache.get(key);
      if (!force && cached && now() - cached.fetchedAt < LIST_TTL_MS) {
        return cached.result;
      }
      const existing = inflight.get(key);
      if (existing) return existing as Promise<PlatformProjectFileListSnapshot>;
      const p = (async () => {
        try {
          const result = await transport.loadProjectFiles(projectId, path);
          listCache.set(key, { result, fetchedAt: now() });
          return result;
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, p);
      return p;
    },

    // readFile implemented in Task 2.
    async readFile(): Promise<ReadOutcome> {
      throw new Error('not implemented');
    },
    // noteContentLoaded/touch/invalidateContent/clear implemented in later tasks.
    noteContentLoaded: () => [],
    touch: () => {},
    invalidateContent: () => {},
    clear: () => {
      listCache.clear();
      contentCache.clear();
      inflight.clear();
    },
  };
}

export const fileCache = createFileCache({
  transport: platformTransport,
  now: () => Date.now(),
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/fileCache.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/fileCache.ts __tests__/fileCache.test.ts
git commit -m "feat(files): add fileCache module core with list dedup + TTL"
```

---

## Task 2: `fileCache.readFile` — large-file gate, TTL cache-hit, dedup fetch

**Files:**
- Modify: `src/services/fileCache.ts` (replace the `readFile` stub)
- Modify: `__tests__/fileCache.test.ts` (add tests)

- [ ] **Step 1: Write failing tests for `readFile`**

Append to `__tests__/fileCache.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/fileCache.test.ts`
Expected: FAIL — readFile throws / wrong outcomes.

- [ ] **Step 3: Implement `readFile`**

Replace the `readFile` stub in `src/services/fileCache.ts` with:

```ts
    async readFile(projectId, path, meta, opts) {
      const force = opts?.force ?? false;
      const hasCachedContent = opts?.hasCachedContent ?? false;

      if (isBinaryByName(meta.name)) {
        return { kind: 'blocked', reason: 'binary', sizeBytes: meta.sizeBytes };
      }
      if (meta.sizeBytes !== undefined && meta.sizeBytes > LARGE_FILE_BYTES) {
        return { kind: 'blocked', reason: 'too_large', sizeBytes: meta.sizeBytes };
      }

      const key = readKey(projectId, path);
      const entry = contentCache.get(key);
      if (!force && hasCachedContent && entry && now() - entry.loadedAt < CONTENT_TTL_MS) {
        entry.lastAccess = now();
        return { kind: 'cache_hit' };
      }

      const existing = inflight.get(key) as Promise<ReadOutcome> | undefined;
      if (existing) return existing;

      const p = (async (): Promise<ReadOutcome> => {
        try {
          const fetched = await transport.loadProjectFileContent(projectId, path);
          return { kind: 'fetched', content: fetched };
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, p);
      return p;
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/fileCache.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/services/fileCache.ts __tests__/fileCache.test.ts
git commit -m "feat(files): fileCache.readFile large-file gate + TTL + dedup"
```

---

## Task 3: `fileCache` LRU eviction (`noteContentLoaded`, `touch`, `invalidateContent`)

**Files:**
- Modify: `src/services/fileCache.ts`
- Modify: `__tests__/fileCache.test.ts`

- [ ] **Step 1: Write failing tests for eviction/touch/invalidate**

Append to `__tests__/fileCache.test.ts`:

```ts
describe('fileCache LRU + invalidation', () => {
  it('evicts oldest entries past MAX_CONTENT_ENTRIES (16)', () => {
    const transport = mkTransport();
    const cache = createFileCache({ transport: transport as any, now: () => 1000 });
    for (let i = 0; i < 16; i++) {
      cache.noteContentLoaded('pj', `/p/${i}.ts`, 10, `e${i}`);
    }
    // adding the 17th evicts the LRU (/p/0.ts)
    const evicted = cache.noteContentLoaded('pj', '/p/16.ts', 10, 'e16');
    expect(evicted).toEqual([expect.stringMatching(/\/p\/0\.ts$/)]);
  });

  it('evicts by total bytes budget', () => {
    const transport = mkTransport();
    const cache = createFileCache({ transport: transport as any, now: () => 1000 });
    // two 4MB entries -> 8MB > 6MB budget; second insert evicts the first
    const evicted = cache.noteContentLoaded('pj', '/p/a.ts', 4 * 1024 * 1024, 'ea');
    expect(evicted).toEqual([]);
    const evicted2 = cache.noteContentLoaded('pj', '/p/b.ts', 4 * 1024 * 1024, 'eb');
    expect(evicted2.length).toBe(1);
  });

  it('touch bumps lastAccess so a newer entry survives over an older touched one', () => {
    const transport = mkTransport();
    let t = 1000;
    const now = jest.fn(() => t);
    const cache = createFileCache({ transport: transport as any, now });
    cache.noteContentLoaded('pj', '/p/old.ts', 10, 'o');
    t = 2000;
    cache.noteContentLoaded('pj', '/p/mid.ts', 10, 'm');
    t = 3000;
    cache.touch('pj', '/p/old.ts'); // old is now most-recent
    // fill to 16 + 1 to force one eviction; 'mid' should be the LRU victim
    for (let i = 0; i < 15; i++) cache.noteContentLoaded('pj', `/p/${i}.ts`, 10, `e${i}`);
    const evicted = cache.noteContentLoaded('pj', '/p/x.ts', 10, 'ex');
    expect(evicted.some(k => k.endsWith('/p/mid.ts'))).toBe(true);
    expect(evicted.some(k => k.endsWith('/p/old.ts'))).toBe(false);
  });

  it('invalidateContent removes a single entry', () => {
    const transport = mkTransport();
    const cache = createFileCache({ transport: transport as any, now: () => 1000 });
    cache.noteContentLoaded('pj', '/p/a.ts', 10, 'ea');
    cache.invalidateContent('pj', '/p/a.ts');
    // after invalidate, a read with cached content no longer hits TTL
    transport.loadProjectFileContent.mockResolvedValue({ project_id: 'pj', device_id: 'd', path: '/p/a.ts', content: 'x', encoding: 'utf8', size_bytes: 1, modified_at: 'm', truncated: false });
    return cache.readFile('pj', '/p/a.ts', { name: 'a.ts', sizeBytes: 1 }, { hasCachedContent: true }).then(r => {
      expect(r.kind).toBe('fetched'); // not cache_hit
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/fileCache.test.ts`
Expected: FAIL — eviction returns `[]`.

- [ ] **Step 3: Implement eviction helpers**

Replace the `noteContentLoaded`/`touch`/`invalidateContent` stubs in `src/services/fileCache.ts`:

```ts
    noteContentLoaded(projectId, path, bytes, etag) {
      const key = readKey(projectId, path);
      const t = now();
      contentCache.set(key, { etag, loadedAt: t, lastAccess: t, bytes });
      const evicted: string[] = [];
      const totalBytes = () => [...contentCache.values()].reduce((s, e) => s + e.bytes, 0);
      while (contentCache.size > MAX_CONTENT_ENTRIES || totalBytes() > MAX_CONTENT_BYTES) {
        // find LRU entry (min lastAccess), never the just-inserted key
        let lruKey: string | null = null;
        let lruAccess = Infinity;
        for (const [k, e] of contentCache) {
          if (k === key) continue;
          if (e.lastAccess < lruAccess) {
            lruAccess = e.lastAccess;
            lruKey = k;
          }
        }
        if (lruKey === null) break;
        contentCache.delete(lruKey);
        evicted.push(lruKey);
      }
      return evicted;
    },

    touch(projectId, path) {
      const entry = contentCache.get(readKey(projectId, path));
      if (entry) entry.lastAccess = now();
    },

    invalidateContent(projectId, path) {
      contentCache.delete(readKey(projectId, path));
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/fileCache.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/services/fileCache.ts __tests__/fileCache.test.ts
git commit -m "feat(files): fileCache LRU eviction + touch + invalidate"
```

---

## Task 4: Type additions (`etag`, `previewBlocked`, action signatures, `dropFileContent`)

**Files:**
- Modify: `src/store/types.ts`
- Test: `npx tsc --noEmit` (type-only change; no runtime test)

- [ ] **Step 1: Add fields to `ProjectFileEntry`**

In `src/store/types.ts`, inside `interface ProjectFileEntry` (after `error?: string;`), add:

```ts
  etag?: string;
  previewBlocked?: { reason: 'too_large' | 'binary'; sizeBytes?: number };
```

- [ ] **Step 2: Update the store action signatures**

In `src/store/types.ts`, find the `loadProjectFiles` / `loadProjectFileContent` signatures and add an optional `opts` plus the new action. They should read:

```ts
  loadProjectFiles: (projectId: string, path?: string, opts?: { force?: boolean }) => Promise<void>;
  loadProjectFileContent: (projectId: string, path: string, opts?: { force?: boolean }) => Promise<void>;
  dropFileContent: (projectId: string, path: string) => void;
```

- [ ] **Step 3: Typecheck (expect errors in the slice — that's fine, Task 5 fixes them)**

Run: `npx tsc --noEmit`
Expected: errors in `deviceProjectSlice.ts` (missing `dropFileContent`, signature mismatch) — acceptable; resolved in Task 6/7. Do NOT commit yet.

---

## Task 5: Set `etag` in the two entry builders

**Files:**
- Modify: `src/store/internals.ts` (`serverProjectFileToClient`, `serverProjectContentToFileEntry`)

- [ ] **Step 1: Add `etag` to `serverProjectFileToClient`**

In `src/store/internals.ts`, in the returned object of `serverProjectFileToClient` (~line 873), add:

```ts
    etag: `${file.size_bytes ?? ''}:${file.modified_at ?? ''}`,
```

- [ ] **Step 2: Add `etag` to `serverProjectContentToFileEntry`**

In the returned object of `serverProjectContentToFileEntry` (~line 896), add:

```ts
    etag: `${content.size_bytes ?? ''}:${content.modified_at ?? ''}`,
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: same slice errors as Task 4 (still pending). No new errors.

---

## Task 6: Slice tests — etag invalidation, blocked, eviction wiring

**Files:**
- Create: `__tests__/fileCacheSlice.test.ts`

- [ ] **Step 1: Write failing slice tests**

Create `__tests__/fileCacheSlice.test.ts`:

```ts
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
    // server now reports a different size -> different etag
    (platformTransport.loadProjectFiles as jest.Mock).mockResolvedValue({
      project_id: 'pj', device_id: 'd', path: '/p', truncated: false, generated_at: 't',
      entries: [{ name: 'a.ts', path: '/p/a.ts', kind: 'file', size_bytes: 99, modified_at: 'm', language: 'TypeScript', summary: 'x' }],
    });
    await useControlCenterStore.getState().loadProjectFiles('pj', '/p', { force: true });
    const f = useControlCenterStore.getState().projectFiles.find(x => x.path === '/p/a.ts')!;
    expect(f.content).toBeUndefined();      // invalidated
    expect(f.etag).toBe('99:m');            // fresh etag written
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
    expect(f.name).toBe('a.ts'); // metadata kept
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/fileCacheSlice.test.ts`
Expected: FAIL — `dropFileContent is not a function` / actions don't route through cache yet.

---

## Task 7: Wire `loadProjectFiles` through `fileCache` (force + etag invalidation + preserve-set)

**Files:**
- Modify: `src/store/slices/deviceProjectSlice.ts` (`loadProjectFiles`, ~line 191)

- [ ] **Step 1: Route through cache + add etag invalidation**

In `src/store/slices/deviceProjectSlice.ts`, add the import at the top:

```ts
import { fileCache } from '../../services/fileCache';
```

Replace the body of `loadProjectFiles` (the `try { ... }` block that calls `platformTransport.loadProjectFiles`) so it (a) calls `fileCache.listFiles(projectId, path, { force: opts?.force })`, (b) during merge, when an existing entry's `etag` differs from the incoming etag, drop its content fields + `fileCache.invalidateContent`, and (c) preserves `etag`/`previewBlocked` for surviving entries:

```ts
  loadProjectFiles: async (projectId, path, opts) => {
    if (!get().serverMode) {
      throw new Error('Platform connection is required before loading project files.');
    }

    try {
      const result = await fileCache.listFiles(projectId, path, { force: opts?.force });
      const nextEntries = result.entries.map(entry =>
        serverProjectFileToClient(result.project_id, result.path, entry),
      );

      set(state => {
        const existingByPath = new Map(
          state.projectFiles
            .filter(item => item.projectId === result.project_id)
            .map(item => [item.path, item]),
        );
        const mergedEntries = nextEntries.map(entry => {
          const existing = existingByPath.get(entry.path);
          if (!existing) return entry;
          // etag mismatch -> the file changed on disk; drop cached content.
          if (existing.content !== undefined && existing.etag !== entry.etag) {
            fileCache.invalidateContent(result.project_id, entry.path);
            return entry; // fresh entry, no content
          }
          // etag matches (or no prior content): preserve cached content + block state.
          return {
            ...entry,
            content: existing.content,
            encoding: existing.encoding,
            loadedAt: existing.loadedAt,
            truncated: existing.truncated,
            etag: entry.etag,
            previewBlocked: existing.previewBlocked,
          };
        });

        return {
          projectFiles: [
            ...state.projectFiles.filter(
              item =>
                item.projectId !== result.project_id ||
                item.directoryPath !== result.path,
            ),
            ...mergedEntries,
          ],
          events: [
            event(
              'project.scan.completed',
              'Project files loaded',
              `${mergedEntries.length} entries from ${result.path}`,
              'done',
              { projectId: result.project_id, deviceId: result.device_id },
            ),
            ...state.events,
          ].slice(0, 120),
        };
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Project file list failed';
      set(state => ({
        events: [
          event('project.scan.completed', 'Project file load failed', detail, 'failed', {
            projectId,
          }),
          ...state.events,
        ].slice(0, 120),
      }));
      throw error;
    }
  },
```

- [ ] **Step 2: Run the etag-invalidation tests**

Run: `npx jest __tests__/fileCacheSlice.test.ts -t "etag"`
Expected: the two `loadProjectFiles etag invalidation` tests PASS; the others still fail (handled in Task 8).

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/store/types.ts src/store/internals.ts src/store/slices/deviceProjectSlice.ts __tests__/fileCacheSlice.test.ts
git commit -m "feat(files): route loadProjectFiles through fileCache + etag invalidation"
```

---

## Task 8: Wire `loadProjectFileContent` through `fileCache` (blocked + cache-hit + eviction) + `dropFileContent`

**Files:**
- Modify: `src/store/slices/deviceProjectSlice.ts` (`loadProjectFileContent` ~256; add `dropFileContent`)

- [ ] **Step 1: Replace `loadProjectFileContent` body + add `dropFileContent`**

In `src/store/slices/deviceProjectSlice.ts`, replace `loadProjectFileContent` so it routes through `fileCache.readFile`, handles `blocked`/`cache_hit`/`fetched`, and evicts via `noteContentLoaded`; then add `dropFileContent`:

```ts
  loadProjectFileContent: async (projectId, path, opts) => {
    if (!get().serverMode) {
      throw new Error('Platform connection is required before reading project files.');
    }

    const existing = get().projectFiles.find(
      item => item.projectId === projectId && item.path === path,
    );
    const meta = {
      name: existing?.name ?? path.split('/').pop() ?? path,
      sizeBytes: existing?.sizeBytes,
    };

    try {
      const outcome = await fileCache.readFile(projectId, path, meta, {
        force: opts?.force,
        hasCachedContent: existing?.content !== undefined,
      });

      if (outcome.kind === 'blocked') {
        set(state => ({
          projectFiles: state.projectFiles.map(item =>
            item.projectId === projectId && item.path === path
              ? { ...item, content: undefined, previewBlocked: { reason: outcome.reason, sizeBytes: outcome.sizeBytes } }
              : item,
          ),
        }));
        return;
      }
      if (outcome.kind === 'cache_hit') {
        fileCache.touch(projectId, path);
        return;
      }

      const result = outcome.content;
      const etag = `${result.size_bytes ?? ''}:${result.modified_at ?? ''}`;
      const bytes = result.content.length;

      set(state => {
        const hasExisting = state.projectFiles.some(
          item => item.projectId === result.project_id && item.path === result.path,
        );
        const nextFiles = hasExisting
          ? state.projectFiles.map(item =>
              item.projectId === result.project_id && item.path === result.path
                ? {
                    ...item,
                    content: result.content,
                    encoding: result.encoding,
                    loadedAt: nowTime(),
                    truncated: result.truncated,
                    sizeBytes: result.size_bytes ?? item.sizeBytes,
                    size: result.size_bytes !== undefined ? formatBytes(result.size_bytes) : item.size,
                    modifiedAt: result.modified_at ?? item.modifiedAt,
                    lastTouched: result.modified_at ?? item.lastTouched,
                    etag,
                    previewBlocked: undefined,
                    error: undefined,
                  }
                : item,
            )
          : [...state.projectFiles, serverProjectContentToFileEntry(result.project_id, result)];

        return {
          projectFiles: nextFiles,
          events: [
            event('file.changed', 'Project file loaded', result.path, 'done', {
              projectId: result.project_id,
              deviceId: result.device_id,
            }),
            ...state.events,
          ].slice(0, 120),
        };
      });

      // LRU eviction: drop content for evicted keys.
      const evicted = fileCache.noteContentLoaded(projectId, path, bytes, etag);
      for (const key of evicted) {
        // key format: `read:<projectId>:<path>`
        const rest = key.slice('read:'.length);
        const sep = rest.indexOf(':');
        const evProjectId = rest.slice(0, sep);
        const evPath = rest.slice(sep + 1);
        get().dropFileContent(evProjectId, evPath);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Project file read failed';
      set(state => ({
        projectFiles: state.projectFiles.map(item =>
          item.projectId === projectId && item.path === path
            ? { ...item, error: detail }
            : item,
        ),
        events: [
          event('file.changed', 'Project file read failed', detail, 'failed', {
            projectId,
          }),
          ...state.events,
        ].slice(0, 120),
      }));
      throw error;
    }
  },

  dropFileContent: (projectId, path) => {
    set(state => ({
      projectFiles: state.projectFiles.map(item =>
        item.projectId === projectId && item.path === path
          ? {
              ...item,
              content: undefined,
              encoding: undefined,
              loadedAt: undefined,
              etag: undefined,
              error: undefined,
            }
          : item,
      ),
    }));
  },
```

> Note: `serverProjectContentToFileEntry` already sets `etag` (Task 5) and `loadedAt`/`truncated`/`content`; confirm the existing helper signature matches the call (it takes `(projectId, content)`). Confirm `formatBytes` and `nowTime` are already imported in the slice (they are — used by the current code).

- [ ] **Step 2: Run the full slice test file**

Run: `npx jest __tests__/fileCacheSlice.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 3: Typecheck + run full suite + commit**

```bash
npx tsc --noEmit
npx jest
git add src/store/slices/deviceProjectSlice.ts __tests__/fileCacheSlice.test.ts
git commit -m "feat(files): route loadProjectFileContent through fileCache + dropFileContent"
```

---

## Task 9: `FileBrowserScreen` — force refresh + blocked panel

**Files:**
- Modify: `src/screens/projects/FileBrowserScreen.tsx`

- [ ] **Step 1: Pass `{ force: true }` on refresh**

In `FileBrowserScreen.tsx` `handleRefresh`, change the `loadProjectFiles` call:

```ts
      await loadProjectFiles(project.id, effectivePath, { force: true });
```

(The mount `useEffect` that calls `loadProjectFiles(project.id, effectivePath)` stays without `force` — default `false`, so it respects TTL.)

- [ ] **Step 2: Respect `previewBlocked` in `handleOpenFile`**

In `handleOpenFile`, for the file branch, if the entry is already blocked, just select it (render the blocked panel) without fetching:

```ts
    if (file.previewBlocked) {
      setSelectedPath(file.path);
      return;
    }
    setSelectedPath(file.path);
    if (file.content !== undefined) return;
```

- [ ] **Step 3: Render a blocked panel instead of the content preview**

Find the `{selectedFile?.content !== undefined ? ( ... preview panel ... ) : null}` block and add a sibling blocked panel before it. Replace the block with:

```tsx
        {selectedFile?.previewBlocked ? (
          <GlassPanel style={styles.previewPanel}>
            <View style={styles.previewHeader}>
              <IconBadge
                name="warning"
                tone={selectedFile.previewBlocked.reason === 'binary' ? 'tertiary' : 'error'}
                size={36}
                iconSize={18}
              />
              <View style={styles.previewTitle}>
                <Text numberOfLines={1} style={[theme.typography.titleMd, { color: theme.colors.onSurface }]}>
                  {selectedFile.previewBlocked.reason === 'binary'
                    ? '二进制文件，无法预览'
                    : '文件过大，未自动打开'}
                </Text>
                <Text numberOfLines={1} style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>
                  {selectedFile.path}
                  {selectedFile.previewBlocked.sizeBytes !== undefined
                    ? ` · ${formatBytesLocal(selectedFile.previewBlocked.sizeBytes)}`
                    : ''}
                </Text>
              </View>
            </View>
            <Text style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
              {selectedFile.previewBlocked.reason === 'binary'
                ? '该文件是二进制内容，不适合在手机端预览。'
                : '该文件超过 1 MB，预览会截断且占用大量内存。'}
            </Text>
            <GlowButton
              title="在终端打开"
              onPress={() =>
                device &&
                navigation.navigate('DeviceTerminal', {
                  deviceId: device.id,
                  directory: parentPathOf(selectedFile.path),
                })
              }
              disabled={!device}
              variant="primary"
              style={styles.stateAction}
            />
          </GlassPanel>
        ) : null}
        {selectedFile?.content !== undefined ? (
          /* …existing preview panel, unchanged… */
        ) : null}
```

Add a tiny local bytes formatter near `parentPathOf` (avoid importing server helpers into the screen):

```ts
const formatBytesLocal = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  return `${(kb / 1024).toFixed(kb / 1024 >= 10 ? 0 : 1)} MB`;
};
```

- [ ] **Step 4: Typecheck + lint + commit**

```bash
npx tsc --noEmit
npx eslint src/screens/projects/FileBrowserScreen.tsx
git add src/screens/projects/FileBrowserScreen.tsx
git commit -m "feat(files): force refresh + blocked-file panel in FileBrowserScreen"
```

---

## Task 10: Final verification

- [ ] **Step 1: Full typecheck + lint + tests**

```bash
npx tsc --noEmit
npx eslint src/services/fileCache.ts src/store/slices/deviceProjectSlice.ts src/store/types.ts src/store/internals.ts src/screens/projects/FileBrowserScreen.tsx
npx jest
```
Expected: 0 errors; all tests pass; lint warnings only (inline-style, consistent with codebase).

- [ ] **Step 2: Manual smoke (device/simulator)**

1. Open a project's Files → small `.ts` file opens with preview.
2. A `.png` / `.zip` → blocked panel with "在终端打开".
3. A >1 MB text file → blocked panel ("文件过大").
4. Tap REFRESH twice quickly → observe (logs/network) only one `file.list` request per path.
5. Open a file, modify it on disk, tap REFRESH → re-open: content is refetched (etag invalidated).
6. Open ~20 different files → memory stays bounded (no crash; oldest content evicted).

- [ ] **Step 3: Final commit (if any smoke-fix nudges)**

```bash
git add -A
git commit -m "test(files): final verification pass"
```

---

## Notes for the executor
- `fileCache` is a singleton imported by the slice; tests use the factory `createFileCache` with a mock transport + fake `now`, and call `fileCache.clear()` in slice-test `beforeEach` to isolate. (The slice test relies on `jest.mock('../src/services/platformTransport', ...)` being hoisted before `fileCache.ts` imports `platformTransport` — that's how the singleton's transport calls become observable. The pure `createFileCache` unit tests inject directly.)
- All knobs (TTL, LRU, threshold, binary set) are module-level constants at the top of `fileCache.ts`.
- The `status:'clean'` hardcode is **out of scope** (cross-repo); do not "fix" it here.
- **Evicted-key parsing (Task 8):** keys look like `read:<projectId>:<path>`. Project IDs are UUIDs (no colon), so `indexOf(':')` after the `read:` prefix safely splits projectId from path. Add a one-line comment confirming this assumption — a path may legally contain `:`, but the projectId will not.
- **Byte budget is approximate (Task 8):** `result.content.length` counts UTF-16 code units, not true byte memory (base64/large content undercounts). That's intentional per spec — LRU is a safety bound, not an exact memory accounting.
