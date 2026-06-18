# File Browser — Cache, Consistency & Large-File Resilience (Pragmatic In-Memory Layer)

- **Date:** 2026-06-18
- **Status:** Approved (approach A) — pending spec review
- **Scope:** `AliangVibeCodingPhone` only (client). No server, no Agent, no disk persistence.
- **Owner screen:** `src/screens/projects/FileBrowserScreen.tsx`

## 1. Problem

The file browser fetches fresh on every interaction and never validates cached content against the disk. Concretely:

- **No concurrency dedup.** Tapping REFRESH twice, or re-entering a folder while a request is in flight, fires duplicate `file.list` / `file.read` requests to the Agent.
- **Content is cached forever, never revalidated.** The only cache guard is a screen-level `if (file.content !== undefined) return` in `handleOpenFile` (`FileBrowserScreen.tsx`). Once a file is loaded it is served indefinitely — even if it changed on disk. **Stale-content risk.**
- **No memory bound.** Browsing many files accumulates content strings in `projectFiles` with no eviction. The phone is memory-sensitive (bounded-memory is an established project concern for terminal/events/transcript; file content is currently unbounded).
- **No large-file guard.** The Agent caps reads at 128 KB (`local-agent.ts:800-832`) and returns base64 for binaries, but the client never pre-checks. Tapping a 50 MB file or a binary triggers a 128 KB base64 read — wasteful transfer and a useless garbage preview.
- **(Out of scope, noted)** `status` is hardcoded to `'clean'` in `internals.ts:881,904`, so the MODIFIED/ADDED filters never match. A real fix requires git status from the Agent/server (cross-repo) and is excluded.

## 2. Current behavior (ground truth)

- Listing: `deviceProjectSlice.ts:191 loadProjectFiles` always calls transport fresh, full-replaces the directory, but preserves `content/encoding/loadedAt/truncated` for entries whose `path` still exists (`:208-219`). Capped `max_entries=200` server-side with `truncated` (`api/projects.ts:117`, `local-agent.ts:744`).
- Content: `deviceProjectSlice.ts:256 loadProjectFileContent` always calls transport; the screen skips re-fetch only when `content` already exists (the guard in `handleOpenFile`, `FileBrowserScreen.tsx`). Capped `max_bytes=128*1024`, binary→base64, `truncated` flag (`api/projects.ts:129`, `local-agent.ts:800-832`).
- **Free consistency signal, unused:** the Agent `stat()`s every entry on each list and returns `size_bytes` + `modified_at` (`local-agent.ts:754-760`). The client stores these (`internals.ts:884-886, 907-909`) but never compares them to validate cached content.

## 3. Goals

1. **Dedup** identical in-flight list/read requests (promise sharing).
2. **TTL-bounded content freshness** so cached content is eventually revalidated.
3. **Lightweight consistency** using the already-free `size_bytes + modified_at` as an etag — invalidate cached content when a list refresh reports the file changed. No full-file hashing.
4. **Memory-bounded content** via LRU eviction (drop content bytes, keep entry metadata).
5. **Large-file policy:** block binary files and text files > 1 MB from auto-preview; offer "open in terminal" instead. Text 128 KB–1 MB remains a truncated preview (server cap) with a clear "first 128 KB" note.

## 4. Non-goals

- No AsyncStorage / disk cache (cold start still re-fetches).
- No server-side `ETag` / `304 Not Modified`.
- No Agent changes (no new `stat`-only command, no real hashing).
- No fix to the `status` hardcoded-`'clean'` bug (cross-repo; tracked separately).
- No background/async refresh — validation happens lazily on open/refresh.

## 5. Architecture decision: a dedicated `fileCache` module (Approach A)

A new pure-TS module `src/services/fileCache.ts` sits between the store and `platformTransport` and owns **policy**: in-flight dedup, TTL, etag, LRU eviction, and the large-file gate. The store keeps owning **domain state** (`projectFiles`) including the content **bytes**; `fileCache` holds only **metadata** (timestamps, etag, access order, in-flight promises).

Rationale: isolation + single responsibility + unit-testability (no React/RN dependency). Rejected alternatives: (B) inline in the store slice — mixes cache mechanics with domain merge logic, hard to test; (C) in `platformTransport` — transport is a thin API mirror, caching policy is app-level.

**Boundary rule:** content bytes stay in the store (single render source; the screen barely changes). Eviction is computed by `fileCache` and executed by the store via a new small action `dropFileContent`.

## 6. Detailed design

### 6.1 `src/services/fileCache.ts` (new)

Singleton module. All time comparisons use a pluggable `now()` (default `Date.now`) so tests are deterministic.

Data structures:

```ts
type ListKey = `list:${projectId}:${path}`;
type ReadKey = `read:${projectId}:${path}`;

interface ListEntry { fetchedAt: number; }
interface ContentEntry { etag: string; loadedAt: number; lastAccess: number; bytes: number; }

type ReadOutcome =
  | { kind: 'blocked'; reason: 'too_large' | 'binary'; sizeBytes?: number }
  | { kind: 'cache_hit' }                          // store serves its existing content
  | { kind: 'fetched'; content: ServerProjectFileContent };
```

Public API:

```ts
listFiles(projectId, path, opts?: { force?: boolean }): Promise<ServerProjectFileList>
readFile(projectId, path, meta: { name: string; sizeBytes?: number; modifiedAt?: string },
         opts?: { force?: boolean; hasCachedContent?: boolean }): Promise<ReadOutcome>
noteContentLoaded(projectId, path, bytes: number, etag: string): string[]  // returns ReadKeys to evict (LRU)
touch(projectId, path): void          // bump lastAccess (called on open / cache_hit)
invalidateContent(projectId, path): void
clear(): void
```

Behavior:

- **Dedup:** `inflight: Map<ListKey|ReadKey, Promise>`. Same key → share the promise; clear on settle.
- **List TTL (15 s):** `listFiles` short-circuits to the last result when within TTL **and** `!force`. Explicit REFRESH passes `force: true`. (List results are small; TTL mainly avoids re-listing on rapid screen re-mounts.)
- **Content TTL (60 s) + etag:** `readFile` returns `cache_hit` when `!force && hasCachedContent && now()-loadedAt < CONTENT_TTL`. Otherwise it dedup-fetches via transport and returns `fetched`. The etag is **not** re-checked at open time (no extra round-trip); it is validated on list refresh instead (§6.2).
- **Large-file gate (in `readFile`, before any fetch):**
  - `isBinaryByExt(name)` → `{kind:'blocked', reason:'binary', sizeBytes}`.
  - `sizeBytes !== undefined && sizeBytes > LARGE_FILE_BYTES (1 MB)` → `{kind:'blocked', reason:'too_large', sizeBytes}`.
  - If `sizeBytes` is unknown (Agent `stat` failed) → fall through to fetch; the server's own 128 KB cap + `truncated` flag still applies.
- **LRU:** `noteContentLoaded` inserts/updates a `ContentEntry` and, while `contentCache` exceeds `MAX_CONTENT_ENTRIES (16)` **or** `MAX_CONTENT_BYTES (6 MB)`, evicts the least-recently-used and returns their keys. Caller (store) drops those entries' content. Eviction removes only content bytes; entry metadata stays.

Binary extension blocklist (lowercase, ext-based): `png jpg jpeg gif bmp ico mp4 mov avi mkv webm mp3 wav flac ogg aac zip tar gz tgz bz2 rar 7z pdf doc docx xls xlsx ppt pptx woff woff2 ttf otf exe dll so dylib class jar wasm o pdb db sqlite`.

### 6.2 `src/store/slices/deviceProjectSlice.ts` (modify)

- `loadProjectFiles(projectId, path, opts?)`: pass through `fileCache.listFiles(projectId, path, { force: opts?.force })`. During the existing merge, for each incoming entry compute its etag `${size_bytes}:${modified_at ?? ''}`; if a stored entry has content **and** its stored `etag` differs from the incoming etag → drop that entry's content fields and call `fileCache.invalidateContent(projectId, path)`. Always write the fresh `etag` onto the entry. (This is the consistency mechanism: a folder refresh silently invalidates content of files that changed on disk.) **Preserve-set:** when an entry survives the refresh (path still present) and its etag matches, preserve its existing `content/encoding/loadedAt/truncated` **plus `etag` and `previewBlocked`** — a refresh must not blow away a just-written etag or a just-set block state. (The current merge only preserves the first four; `etag`/`previewBlocked` must be added.)
- `loadProjectFileContent(projectId, path, opts?)`:
  - Read current entry meta `{name, sizeBytes, modifiedAt}` and `hasCachedContent = content !== undefined` from state.
  - `const r = await fileCache.readFile(projectId, path, meta, { force: opts?.force, hasCachedContent })`.
  - `r.kind === 'blocked'` → set `entry.previewBlocked = { reason, sizeBytes }`, clear any prior content; return.
  - `r.kind === 'cache_hit'` → `fileCache.touch(...)`; no state change (content already current); return.
  - `r.kind === 'fetched'` → write `content/encoding/loadedAt/truncated/sizeBytes/modifiedAt` + `etag` (from the fetched result's `size_bytes + modified_at`); then `const evict = fileCache.noteContentLoaded(projectId, path, bytes, etag)`; for each evicted key, call `dropFileContent(...)`.
- New action **`dropFileContent(projectId, path)`**: clears `content/encoding/loadedAt/etag/error` on the matching entry; keeps name/path/kind/size/etc. (No content fetch.)
- `loadProjectFiles`/`loadProjectFileContent` gain an optional `{ force?: boolean }` 2nd/3rd param; defaults preserve existing call signatures. The screen's explicit REFRESH passes `force: true`.

### 6.3 `src/store/types.ts` (modify)

`ProjectFileEntry` gains:
```ts
etag?: string;                                              // `${sizeBytes}:${modifiedAt}`
previewBlocked?: { reason: 'too_large' | 'binary'; sizeBytes?: number };
```
`ControlCenterStore`: `loadProjectFiles`/`loadProjectFileContent` signatures gain optional `opts?: { force?: boolean }`.

### 6.4 `src/screens/projects/FileBrowserScreen.tsx` (modify)

- `handleRefresh` → call `loadProjectFiles(project.id, effectivePath, { force: true })`.
- `handleOpenFile` for a file: if `file.previewBlocked` → set `selectedPath` and render the blocked panel (no fetch). Else proceed as today, but pass `{ force: false }` (default) — the store/cache now decides cache-hit vs fetch.
- New **blocked panel** (reuses `GlassPanel`): icon (`warning`), title ("二进制文件，无法预览" / "文件过大 (N MB)，未自动打开"), detail, and a `GlowButton` "在终端打开" → `navigation.navigate('DeviceTerminal', { deviceId, directory: parentPath })`. Placed where the content preview panel currently renders.
- Existing `TRUNCATED` chip stays (now also covers the 128 KB–1 MB text case, communicating "first 128 KB").

### 6.5 Builder updates — `src/store/internals.ts`

- `serverProjectFileToClient`: set `etag` from `${file.size_bytes ?? ''}:${file.modified_at ?? ''}`.
- `serverProjectContentToFileEntry`: set `etag` from `${content.size_bytes ?? ''}:${content.modified_at ?? ''}`.

## 7. Data flow

**Open a file:**
```
screen.handleOpenFile(file)
  → store.loadProjectFileContent(pj, path)               # force=false
    → fileCache.readFile(pj, path, meta, {hasCachedContent})
       ├─ binary/ext or >1MB ──────────────────────► {blocked}  → entry.previewBlocked → screen shows blocked panel
       ├─ content cached & <60s TTL ────────────────► {cache_hit}→ fileCache.touch → screen shows existing preview
       └─ else (dedup) → transport.loadProjectFileContent ──► {fetched} → write content+etag → noteContentLoaded → evict
```

**Refresh a folder:**
```
screen.handleRefresh ─► store.loadProjectFiles(pj, path, {force:true})
  → fileCache.listFiles(pj, path, {force:true}) → transport.loadProjectFiles
  → merge: per entry, if stored content.etag ≠ incoming etag → drop content + invalidateContent
  → write fresh etag on each entry
```

## 8. Configuration / defaults

| Knob | Value | Where |
|---|---|---|
| List TTL | 15 s | `fileCache` const |
| Content TTL | 60 s | `fileCache` const |
| Max content entries | 16 | `fileCache` const |
| Max content bytes | 6 MB | `fileCache` const |
| Large-file threshold | 1 MB | `fileCache` const |
| Server read cap | 128 KB (unchanged) | `api/projects.ts:129` |

All knobs are module-level constants in `fileCache.ts` (easy to tune, no runtime config UI).

## 9. Edge cases

- **Unknown size at open** (Agent `stat` failed → `sizeBytes` undefined): skip the size gate; fetch; rely on server 128 KB cap + `truncated`. Binary detection by extension still applies.
- **Empty etag** (`size_bytes` and `modified_at` both missing → etag `':'`): still a valid, comparable value — two such entries compare equal, so content is preserved across refreshes rather than wrongly invalidated. An entry with undefined size also can't be large-file-gated, which is correct (fall through to fetch).
- **File deleted between list and open**: server/Agent returns an error → existing `error` path (`loadProjectFileContent` catch) surfaces it; `fileCache.invalidateContent` on the read key.
- **Rapid open/close of many files**: LRU evicts oldest content; reopening an evicted file refetches (TTL/etag still apply).
- **`force` refresh of a folder whose entries lost their content (evicted)**: nothing to invalidate; merge simply doesn't restore content (correct — must refetch on open).
- **Same path requested concurrently**: dedup returns one promise; both callers settle together.
- **Binary by extension but small** (e.g. a 200 B `.png`): blocked (no preview) — extension is authoritative; offer terminal. Acceptable: small binaries are still not useful as text.

## 10. Testing plan (`__tests__/fileCache.test.ts`, pure-TS, jest)

`fileCache` takes injectable `transport` + `now()` so tests need no React/RN.

1. **Dedup:** two concurrent `listFiles` same key → transport called once; both await the same result.
2. **List TTL hit/miss/expiry:** within 15 s → no transport call; at 16 s → transport called; `force:true` always calls.
3. **Content TTL:** `cache_hit` within 60 s with `hasCachedContent`; expiry → fetch.
4. **LRU eviction:** insert 17 entries → 1 evicted key returned; insert one huge entry exceeding 6 MB → oldest evicted; evicted keys returned by `noteContentLoaded`.
5. **Etag invalidation (store-level, tested via slice or a thin harness):** stored content with etag A; list returns etag B → content dropped + `invalidateContent` called.
6. **Large-file gate:** `.zip` and 2 MB `.ts` → `{blocked}`; 500 KB `.ts` → fetch; unknown size → fetch.
7. **Blocked → previewBlocked** written; `dropFileContent` clears only content fields.

Existing tests unaffected (no change to transport/store public behavior beyond additive optional params).

## 11. File checklist

- New: `src/services/fileCache.ts`
- New: `__tests__/fileCache.test.ts`
- Modify: `src/store/slices/deviceProjectSlice.ts` (3 actions + 1 new)
- Modify: `src/store/types.ts` (`ProjectFileEntry` + action signatures)
- Modify: `src/store/internals.ts` (etag in 2 builders)
- Modify: `src/screens/projects/FileBrowserScreen.tsx` (force refresh, blocked panel)

## 12. Rollout

Single PR, all in `AliangVibeCodingPhone`. No migration (additive state fields, optional params). Verify via `npx tsc --noEmit`, `npm test`, `npx eslint` on touched files, and a manual smoke of: open folder → open small file → open >1 MB file (blocked) → open binary (blocked) → REFRESH after editing a file on disk (content invalidated & refetched).
