// Task 2 (TDD red→green): the pure-logic layer behind FileEditorScreen.
// The screen itself (load→edit→save→conflict→unsaved-leave) needs the live
// navigation + alert + toast plumbing, so it stays untested (全量基线+类型为闸);
// the contracts that decide UX live in these pure exports and are pinned here:
//   1. TEXT_EDITABLE_EXTENSIONS + isTextEditableFile — the long-press「编辑」
//      entry allowlist (case-insensitive extension match, plus the two
//      extension-less basenames Dockerfile/.gitignore; 无扩展名不编).
//   2. FileEditorDoc transitions — baseline snapshot + optimistic-lock sha
//      chain: create at load, re-snapshot on save success, downgrade to
//      lockless write when the server omits sha256 (old agent, graceful).
//   3. resolveFileEditorError — agentErrorCode → human copy mapping
//      (conflict → Alert; too_large/path_forbidden → toast; 404 old server;
//      everything else → generic toast carrying the error text).
import { ApiResponseError } from '../../../api/client';
import i18n from '../../../i18n';
import type { TFunction } from 'i18next';
import {
  EDITOR_MAX_BYTES,
  TEXT_EDITABLE_EXTENSIONS,
  applySaveSuccess,
  createEditorDoc,
  isEditorDirty,
  isTextEditableFile,
  resolveFileEditorError,
  runLeaveWithSave,
} from '../FileEditorScreen';

// jest.setup.js pins the locale to 'zh'; getFixedT binds the projects
// namespace exactly like the screen's useTranslation('projects') does.
const t = i18n.getFixedT(null, 'projects') as unknown as TFunction;

const makeEntry = (overrides?: {
  kind?: 'file' | 'folder';
  name?: string;
}): { kind: 'file' | 'folder'; name: string } => ({
  kind: 'file',
  name: 'a.ts',
  ...overrides,
});

const apiError = (
  status: number,
  message = 'Request failed',
  agentErrorCode?: string,
) => new ApiResponseError(message, status, message, agentErrorCode);

describe('TEXT_EDITABLE_EXTENSIONS / isTextEditableFile', () => {
  it('contains every extension the plan allowlists', () => {
    const expected = [
      'ts', 'tsx', 'js', 'jsx', 'json', 'md', 'txt', 'py', 'go', 'java', 'kt',
      'swift', 'rb', 'rs', 'c', 'h', 'cpp', 'hpp', 'hh', 'cc', 'css', 'scss',
      'less', 'html', 'htm', 'xml', 'yml', 'yaml', 'toml', 'ini', 'cfg',
      'conf', 'sh', 'bat', 'ps1', 'sql', 'graphql', 'proto', 'vue', 'php',
      'lua', 'dart', 'gradle', 'properties', 'env', 'lock', 'gitignore',
      'dockerfile',
    ];
    expected.forEach(ext => {
      expect(TEXT_EDITABLE_EXTENSIONS.has(ext)).toBe(true);
    });
    expect(TEXT_EDITABLE_EXTENSIONS.size).toBe(expected.length);
  });

  it.each(['a.ts', 'index.tsx', 'app.json', 'README.md', 'main.go', 'run.sh', 'config.env', 'pkg.lock'])(
    'marks %s editable',
    name => {
      expect(isTextEditableFile(makeEntry({ name }))).toBe(true);
    },
  );

  it('matches extensions case-insensitively (APP.TSX)', () => {
    expect(isTextEditableFile(makeEntry({ name: 'APP.TSX' }))).toBe(true);
  });

  it('accepts hidden dotfiles whose suffix is allowlisted (.env / .gitignore)', () => {
    expect(isTextEditableFile(makeEntry({ name: '.env' }))).toBe(true);
    expect(isTextEditableFile(makeEntry({ name: '.gitignore' }))).toBe(true);
  });

  it('accepts the extension-less basenames Dockerfile / Gitignore', () => {
    expect(isTextEditableFile(makeEntry({ name: 'Dockerfile' }))).toBe(true);
    expect(isTextEditableFile(makeEntry({ name: 'gitignore' }))).toBe(true);
  });

  it('rejects directories even with an editable extension', () => {
    expect(isTextEditableFile(makeEntry({ kind: 'folder', name: 'src.ts' }))).toBe(false);
  });

  it('rejects files without an allowlisted extension (无扩展名不编)', () => {
    expect(isTextEditableFile(makeEntry({ name: 'Makefile' }))).toBe(false);
    expect(isTextEditableFile(makeEntry({ name: 'README' }))).toBe(false);
    expect(isTextEditableFile(makeEntry({ name: 'photo.png' }))).toBe(false);
    expect(isTextEditableFile(makeEntry({ name: 'bundle.tar.gz' }))).toBe(false);
  });
});

describe('FileEditorDoc transitions (baseline snapshot + sha lock chain)', () => {
  it('createEditorDoc snapshots the loaded content as the dirty baseline', () => {
    expect(createEditorDoc('hello world', 'abc123')).toEqual({
      content: 'hello world',
      baseline: 'hello world',
      sha256: 'abc123',
    });
  });

  it('createEditorDoc without a server sha256 degrades to a lockless doc', () => {
    expect(createEditorDoc('legacy')).toEqual({
      content: 'legacy',
      baseline: 'legacy',
    });
    expect(createEditorDoc('legacy', undefined).sha256).toBeUndefined();
  });

  it('isEditorDirty is false right after load and true after any edit', () => {
    const doc = createEditorDoc('const a = 1;\n', 'sha-1');
    expect(isEditorDirty(doc)).toBe(false);
    expect(isEditorDirty({ ...doc, content: 'const a = 2;\n' })).toBe(true);
  });

  it('isEditorDirty tolerates a missing doc (still loading)', () => {
    expect(isEditorDirty(null)).toBe(false);
  });

  it('applySaveSuccess re-snapshots the baseline to the sent content and advances the sha chain', () => {
    const edited = {
      ...createEditorDoc('old', 'sha-old'),
      content: 'new body',
    };
    expect(isEditorDirty(edited)).toBe(true);

    const saved = applySaveSuccess(edited, 'new body', 'sha-new');
    expect(saved).toEqual({ content: 'new body', baseline: 'new body', sha256: 'sha-new' });
    expect(isEditorDirty(saved)).toBe(false);
  });

  it('applySaveSuccess without a response sha256 downgrades to lockless (old agent)', () => {
    const saved = applySaveSuccess(
      { ...createEditorDoc('old', 'sha-old'), content: 'next' },
      'next',
      undefined,
    );
    expect(saved.baseline).toBe('next');
    expect(saved.sha256).toBeUndefined();
  });

  it('C1: advances the baseline to the SENT content, so in-flight typing stays dirty', () => {
    // 时序:编辑到 B → 按保存(PUT B 在途)→ 飞行窗口内继续打字到 C → 保存成功
    // (服务端落 B,回 sha(B))。基线必须推进到 B 而不是 resolve 时的 C,否则
    // B→C 段键入被判为「已保存」,返回键无提示离开即永久丢失。
    const sentDoc = createEditorDoc('B', 'sha-old');
    const docAtResolve = { ...sentDoc, content: 'B→C typed' };

    const saved = applySaveSuccess(docAtResolve, sentDoc.content, 'sha-B');

    expect(saved).toEqual({ content: 'B→C typed', baseline: 'B', sha256: 'sha-B' });
    expect(isEditorDirty(saved)).toBe(true);
    // 锁链对应盘上的 B:下次保存 expectedSha256 = sha(B),新键入走增量保存。
    expect(saved.sha256).toBe('sha-B');
  });
});

describe('resolveFileEditorError', () => {
  it('maps agentErrorCode conflict to the reload/keep-editing alert channel', () => {
    const resolution = resolveFileEditorError(apiError(409, 'conflict', 'conflict'), t);

    expect(resolution).toEqual({
      kind: 'conflict',
      message: t('fileEditor.conflictMessage'),
    });
  });

  it('maps too_large to the 512KiB write-limit toast', () => {
    const resolution = resolveFileEditorError(apiError(413, 'too large', 'too_large'), t);

    expect(resolution).toEqual({
      kind: 'toast',
      message: t('fileEditor.tooLargeReadOnly'),
    });
  });

  it('maps path_forbidden to the unwritable-path toast', () => {
    const resolution = resolveFileEditorError(
      apiError(403, 'forbidden', 'path_forbidden'),
      t,
    );

    expect(resolution).toEqual({
      kind: 'toast',
      message: t('fileEditor.pathForbidden'),
    });
  });

  it('maps a bare 404 (old server, no agent code) to the upgrade toast', () => {
    const resolution = resolveFileEditorError(apiError(404, 'Not Found'), t);

    expect(resolution).toEqual({
      kind: 'toast',
      message: t('fileEditor.serverTooOld'),
    });
  });

  it('maps any other ApiResponseError to the generic toast carrying the error text', () => {
    const resolution = resolveFileEditorError(apiError(500, 'device_offline'), t);

    expect(resolution.kind).toBe('toast');
    expect(resolution.message).toContain(t('fileEditor.saveFailed'));
    expect(resolution.message).toContain('device_offline');
  });

  it('falls back to the generic toast for non-ApiResponseError failures', () => {
    const resolution = resolveFileEditorError(new Error('boom'), t);

    expect(resolution.kind).toBe('toast');
    expect(resolution.message).toContain(t('fileEditor.saveFailed'));
    expect(resolution.message).toContain('boom');
  });

  it('prefers the agentErrorCode mapping over the HTTP status', () => {
    // 409 without a conflict code still reads as generic, while a conflict
    // code on any status must win — the code is the agent's ground truth.
    expect(resolveFileEditorError(apiError(409, 'nope'), t).kind).toBe('toast');
    expect(
      resolveFileEditorError(apiError(500, 'conflict', 'conflict'), t).kind,
    ).toBe('conflict');
  });

  it('reports the load cap used by the editor (512KiB)', () => {
    expect(EDITOR_MAX_BYTES).toBe(512 * 1024);
  });
});

describe('runLeaveWithSave (N1: join 分叉续存闸门)', () => {
  it('keeps saving while the doc stays dirty after joining a successful save', async () => {
    // N1 时序:保存 B 在途 → 打字到 C → 「保存并离开」join 到 B 的成功 →
    // 文档仍分叉(C 未落盘)→ 必须续存 C,放行前追平。
    const saves: number[] = [];
    let dirtyContent: string | null = 'C';
    const saved = await runLeaveWithSave(
      Promise.resolve(true),
      () => dirtyContent !== null,
      () => {
        saves.push(saves.length + 1);
        dirtyContent = null; // 续存落盘后干净
        return Promise.resolve(true);
      },
    );

    expect(saved).toBe(true);
    expect(saves).toEqual([1]); // 恰好追平一跳
  });

  it('does not save again when the joined save leaves the doc clean', async () => {
    const save = jest.fn(() => Promise.resolve(true));
    const saved = await runLeaveWithSave(Promise.resolve(true), () => false, save);

    expect(saved).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it('stops and reports failure when a continuation save fails (user stays)', async () => {
    let dirty = true;
    const saved = await runLeaveWithSave(
      Promise.resolve(true),
      () => dirty,
      () => {
        dirty = false; // 冲突/失败路径:基线对齐后 dirty 消失,循环自然终止
        return Promise.resolve(false);
      },
    );

    expect(saved).toBe(false);
  });

  it('stops immediately when the joined save itself failed (no extra save, no leave)', async () => {
    const save = jest.fn(() => Promise.resolve(true));
    const saved = await runLeaveWithSave(Promise.resolve(false), () => true, save);

    expect(saved).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });
});
