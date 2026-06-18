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

/**
 * Pure block decision, shared by `readFile` (open time) and the store's
 * list-merge (refresh time). Centralizing it lets a refresh re-evaluate whether
 * a previously-blocked file still qualifies: a `too_large` file that shrank
 * below LARGE_FILE_BYTES recovers (returns undefined); a binary file stays
 * blocked because its extension is authoritative. Returns the block descriptor
 * the store writes into `previewBlocked`, or undefined when previewable.
 */
export const shouldBlockPreview = (
  name: string,
  sizeBytes?: number,
): { reason: 'too_large' | 'binary'; sizeBytes?: number } | undefined => {
  if (isBinaryByName(name)) return { reason: 'binary', sizeBytes };
  if (sizeBytes !== undefined && sizeBytes > LARGE_FILE_BYTES) {
    return { reason: 'too_large', sizeBytes };
  }
  return undefined;
};

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
  // Safe to share across list/read keys: keys are namespaced (`list:` vs `read:`) so type-correctness holds.
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

    async readFile(projectId, path, meta, opts) {
      const force = opts?.force ?? false;
      const hasCachedContent = opts?.hasCachedContent ?? false;

      const block = shouldBlockPreview(meta.name, meta.sizeBytes);
      if (block) {
        return { kind: 'blocked', ...block };
      }

      const key = readKey(projectId, path);
      const entry = contentCache.get(key);
      if (!force && hasCachedContent && entry && now() - entry.loadedAt < CONTENT_TTL_MS) {
        entry.lastAccess = now();
        return { kind: 'cache_hit' };
      }

      // In-flight dedup: `force` still reuses an in-flight fetch (the result is fresh) — it bypasses the TTL cache, not an in-progress fetch.
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
    noteContentLoaded(projectId, path, bytes, etag) {
      const key = readKey(projectId, path);
      const t = now();
      // Overwrites any prior entry — a re-load refreshes the TTL window.
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
