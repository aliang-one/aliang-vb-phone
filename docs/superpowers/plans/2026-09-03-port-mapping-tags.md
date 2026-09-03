# 端口公网映射标签（设备/项目）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给端口公网映射打设备/项目标签：修创建页置灰 bug（P1）、server 标注层（P2）、项目详情「公网端口」区块与共享卡片（P3）。

**Architecture:** 映射真相在隧道网关（零改动）；server 侧新增 `port_mapping_tags` 注解表（1:1，只存项目标与来源），三个打标点（POST 路由 / preview 自动映射 / 项目删除级联），GET 列表 join 网关在线列表并惰性清理孤儿标注。手机端复用共享 `PortMappingCard`，项目详情新增区块（列表+detectedPorts 快选新建+撤销）。设备标签由 `device_id` 推导，不存储。

**Tech Stack:** React Native + jest（phone）；Express + zod + better-sqlite3/pg + vitest（server）。

**Spec:** `docs/superpowers/specs/2026-09-03-port-mapping-tags-design.md`（同分支）

**仓库与工作区：**

| 阶段 | 仓库 | 工作目录 |
|---|---|---|
| P1/P3 | AliangVibeCodingPhone | `/Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangVibeCodingPhone/.worktrees/port-mapping-tags`（已建，分支 `feat/port-mapping-tags`，下文简称 `$PHONE`） |
| P2 | AliangPhoneServer | 先按 Task 3 创建 `.worktrees/port-mapping-tags`（分支同名，简称 `$SERVER`）；npm install 在**仓库根**跑（`server/` 子目录无 package.json） |

**已知基线：** phone `tsc --noEmit` EXIT=0（worktree 已验证）；phone 全量 jest 有 ~3 个 terminal 域已知 flake；server vitest 有 `tunnel tickets`（issuePikoTunnelTicket）1 个**预存失败**（main 上就有，勿当回归）。commit message 一律中文。

---

## Phase P1 · 创建页修复（$PHONE，纯 bug fix + 样式）

### Task 1: mapper 贯通 `tunnelAvailable`（置灰根因）

**Files:**
- Modify: `src/store/internals.ts:321`（`platformDeviceToClient` 返回对象）
- Create: `__tests__/internals.deviceMapper.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `__tests__/internals.deviceMapper.test.ts`：

```ts
import { platformDeviceToClient } from '../src/store/internals';
import type { PlatformDeviceSnapshot } from '../src/services/platformTransport';

// Minimal valid snapshot; only the fields the mapper reads are populated.
const snapshot = (
  overrides: Partial<PlatformDeviceSnapshot> = {},
): PlatformDeviceSnapshot =>
  ({
    id: 'dev-1',
    deviceId: 'dev-1',
    userId: 'user-1',
    name: 'MacBook',
    platform: 'darwin',
    status: 'online',
    capabilities: ['http_tunnel_v1', 'websocket_tunnel_v1'],
    tools: [],
    history: [],
    remoteTerminalEnabled: true,
    aiControlEnabled: true,
    activePorts: [],
    authorizedDirectories: [],
    projectIds: [],
    raw: {} as PlatformDeviceSnapshot['raw'],
    ...overrides,
  }) as PlatformDeviceSnapshot;

describe('platformDeviceToClient tunnel gating fields', () => {
  it('passes tunnelAvailable=true through to the client Device', () => {
    const device = platformDeviceToClient(snapshot({ tunnelAvailable: true }));
    expect(device.tunnelAvailable).toBe(true);
  });

  it('passes tunnelAvailable=false through (not undefined)', () => {
    const device = platformDeviceToClient(snapshot({ tunnelAvailable: false }));
    expect(device.tunnelAvailable).toBe(false);
  });

  it('leaves tunnelAvailable undefined when the snapshot omits it', () => {
    const device = platformDeviceToClient(snapshot());
    expect(device.tunnelAvailable).toBeUndefined();
  });

  it('still copies capabilities (regression guard)', () => {
    const device = platformDeviceToClient(snapshot());
    expect(device.capabilities).toEqual(['http_tunnel_v1', 'websocket_tunnel_v1']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd $PHONE && npx jest __tests__/internals.deviceMapper.test.ts`
Expected: FAIL — `device.tunnelAvailable` 为 `undefined`（期望 true/false 的两条断言红）。

- [ ] **Step 3: 最小实现**

`src/store/internals.ts` `platformDeviceToClient` 返回对象中，`capabilities: sd.capabilities,`（:321）后补一行：

```ts
    capabilities: sd.capabilities,
    tunnelAvailable: sd.tunnelAvailable,
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest __tests__/internals.deviceMapper.test.ts`
Expected: PASS（4 条全绿）。

- [ ] **Step 5: 提交**

```bash
cd $PHONE && git add src/store/internals.ts __tests__/internals.deviceMapper.test.ts
git commit -m "fix: platformDeviceToClient 漏拷 tunnelAvailable——创建页端口开关永久置灰根因"
```

### Task 2: 创建页端口开关样式与文案修复

**Files:**
- Modify: `src/screens/vibecoding/CreateVibeCodingScreen.tsx:141-147, 773-808, 853-873`
- Modify: `src/i18n/locales/vibecoding/en.json:96-102`、`src/i18n/locales/vibecoding/zh.json:96-102`
- Modify: `__tests__/CreateVibeCodingScreen.test.tsx`（:244-273 两条用例的期望 + 新增 1 条）

- [ ] **Step 1: 更新 i18n（两语言同构，node 内键替换）**

`vibecoding/en.json` 的 `portMapping` 节点改为：

```json
      "portMapping": {
        "title": "Expose preview ports as public links",
        "on": "ON",
        "off": "OFF",
        "blockerOffline": "Offline",
        "blockerUnsupported": "Update agent",
        "blockerTunnel": "No tunnel",
        "onHint": "Preview ports started by the AI get a public URL automatically (valid for 24 hours)",
        "offHint": "Turn on to generate public URLs for preview ports automatically",
        "disabledHint": "Device is offline or tunnel unavailable"
      }
```

`zh.json` 同位置：

```json
      "portMapping": {
        "title": "将预览端口暴露为公网短链",
        "on": "开",
        "off": "关",
        "blockerOffline": "设备离线",
        "blockerUnsupported": "需升级 Agent",
        "blockerTunnel": "隧道未配置",
        "onHint": "AI 起的预览端口自动生成公网地址(24小时有效)",
        "offHint": "开启后自动为预览端口生成公网地址",
        "disabledHint": "设备不在线或隧道不可用"
      }
```

（删除 `comingSoon`。）

- [ ] **Step 2: 先改测试（TDD：让测试描述新行为）**

`__tests__/CreateVibeCodingScreen.test.tsx`：

1. 用例 `port-mapping toggle renders disabled with 即将支持 label...`（:244）：mock 设备 online 但无 capabilities → 新期望 chip 显示 `需升级`（blockerUnsupported）。改断言：`expect(textUnder(portToggle!)).toContain('需升级');`，用例名改为 `renders disabled with blocker chip when device lacks tunnel capabilities`。
2. 用例 `disabled when device lacks tunnel capabilities (disabledHint shown)`（:255）：caps=[] + tunnelAvailable=true → 期望 chip `需升级` 且 disabled；保留 disabledHint 文本断言不变。
3. 新增用例：caps 齐全但 `tunnelAvailable=false` → disabled + chip `隧道未配置`：

```tsx
  it('disabled with tunnel blocker chip when server tunnel is not configured', async () => {
    mockDevices[0].capabilities = ['http_tunnel_v1', 'websocket_tunnel_v1'];
    mockDevices[0].tunnelAvailable = false;
    root = await wrap(<CreateVibeCodingScreen />);
    const portToggle = touchByTestID(root.root, 'port-mapping-toggle');
    expect(portToggle?.props.disabled).toBe(true);
    expect(textUnder(portToggle!)).toContain('隧道未配置');
  });
```

4. 用例 `tunnel-capable device: toggle flips ON...`（:275）中的 `'OFF'`/`'ON'` 断言改 `'关'`/`'开'`（zh locale 下 i18n 后的值；`before` 断言 `toContain('关')`，`after` 断言 `toContain('开')`）。

- [ ] **Step 3: 跑测试确认失败**

Run: `npx jest __tests__/CreateVibeCodingScreen.test.tsx`
Expected: FAIL（实现未改，comingSoon/ON/OFF 仍在）。

- [ ] **Step 4: 实现**

`CreateVibeCodingScreen.tsx`：

1. `:141-147` 门控改为 blocker 判定（语义不变，可诊断）：

```ts
  const [exposePreviewPort, setExposePreviewPort] = useState(false);
  // Why the port-mapping toggle is unavailable (null = available). Ordered by
  // specificity: offline → agent lacks the tunnel capabilities → server-side
  // tunnel not configured. surfacing the real reason replaces the stale
  // "Coming soon" chip (the feature has shipped).
  const tunnelBlocker =
    !device || device.status !== 'online'
      ? 'offline'
      : !device.capabilities?.includes('http_tunnel_v1') ||
        !device.capabilities?.includes('websocket_tunnel_v1')
      ? 'unsupported'
      : !device.tunnelAvailable
      ? 'tunnel'
      : null;
  const tunnelCapable = tunnelBlocker === null;
```

2. `:773-808` 开关 JSX：chip label 改为三态、置灰 dim 上移到整面板、hint 加内边距：

```tsx
        {/* Port mapping: auto-expose agent-reported preview ports as public links. */}
        <GlassPanel
          style={[
            styles.optionPanel,
            { marginTop: 10 },
            !tunnelCapable ? styles.optionPanelDisabled : null,
          ]}>
          <TouchableOpacity
            testID="port-mapping-toggle"
            disabled={!tunnelCapable}
            onPress={() => setExposePreviewPort(v => !v)}>
            <View style={styles.optionRow}>
              <Text
                style={[
                  theme.typography.bodyMd,
                  styles.optionText,
                  { color: theme.colors.onSurface },
                ]}>
                {t('createScreen.permissions.portMapping.title')}
              </Text>
              <StatusChip
                label={
                  tunnelBlocker === 'offline'
                    ? t('createScreen.permissions.portMapping.blockerOffline')
                    : tunnelBlocker === 'unsupported'
                    ? t('createScreen.permissions.portMapping.blockerUnsupported')
                    : tunnelBlocker === 'tunnel'
                    ? t('createScreen.permissions.portMapping.blockerTunnel')
                    : exposePreviewPort
                    ? t('createScreen.permissions.portMapping.on')
                    : t('createScreen.permissions.portMapping.off')
                }
                type={!tunnelCapable ? 'neutral' : exposePreviewPort ? 'success' : 'neutral'}
              />
            </View>
          </TouchableOpacity>
          <Text
            style={[
              theme.typography.bodySm,
              styles.optionHint,
              { color: theme.colors.onSurfaceVariant },
            ]}>
            {t(
              !tunnelCapable
                ? 'createScreen.permissions.portMapping.disabledHint'
                : exposePreviewPort
                  ? 'createScreen.permissions.portMapping.onHint'
                  : 'createScreen.permissions.portMapping.offHint',
            )}
          </Text>
        </GlassPanel>
```

3. styles（:853-873）：`optionPanel` 真内边距、新增 disabled/hint 样式、divider 主题化：

```ts
  optionPanel: {
    padding: 12,
  },
  optionPanelDisabled: {
    opacity: 0.45,
  },
  optionHint: {
    paddingHorizontal: 12,
    paddingBottom: 2,
  },
```

（`optionRow` 保持原样；删除原 `optionPanel: { padding: 0 }`。）

4. `:767` divider 引用处与能力行共用样式块——把 `divider` 样式改为渲染处主题化。在组件内（`tunnelBlocker` 附近）加：

```ts
  const dividerStyle = [
    styles.divider,
    {
      backgroundColor: isDark
        ? 'rgba(255,255,255,0.04)'
        : theme.colors.outlineVariant,
    },
  ];
```

`:767` 的 `<View style={styles.divider} />` 改为 `<View style={dividerStyle} />`；styles 中 `divider` 删掉 `backgroundColor` 行（保留 `height: 1, marginHorizontal: 12`）。若组件未解构 `isDark`，从 `useTheme()` 取（`const { theme, isDark } = useTheme();`）。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx jest __tests__/CreateVibeCodingScreen.test.tsx __tests__/internals.deviceMapper.test.ts`
Expected: PASS。

- [ ] **Step 6: tsc + 提交**

```bash
cd $PHONE && npx tsc --noEmit && git add -A src/screens/vibecoding/CreateVibeCodingScreen.tsx src/i18n/locales/vibecoding __tests__/CreateVibeCodingScreen.test.tsx
git commit -m "fix: 创建页端口开关样式/文案—— Coming soon 改真实阻断原因,面板统一置灰,内边距/分隔线/i18n 修复"
```

---

## Phase P2 · server 标注层（$SERVER，先建 worktree）

### Task 3: 建 server worktree + 基线

- [ ] **Step 1: 创建 worktree**

```bash
cd /Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangPhoneServer
git status -sb   # 确认当前 main 干净
git worktree add .worktrees/port-mapping-tags -b feat/port-mapping-tags
```

（`.worktrees/` 已在 server 的 .gitignore 中，提交 0d95b73。）

- [ ] **Step 2: 安装依赖 + 基线**

```bash
cd .worktrees/port-mapping-tags && npm install --no-audit --no-fund
npm run typecheck   # 期望 EXIT=0
npm test            # vitest 全量;预期除预存 tunnel-tickets 失败外全绿
```

记下基线失败清单（应只有 issuePikoTunnelTicket 相关）；后续任务不得新增失败。

### Task 4: `port_mapping_tags` 持久层（dao + 两库建表 + delegates）

**Files:**
- Create: `server/src/db/portMappingTags.ts`
- Modify: `server/src/types.ts`（PreviewLink 类型附近，~:713 后）
- Modify: `server/src/database.ts`（建表 ~:713 后、索引 ~:878 后、delegates ~:2680 后、import ~:20）
- Modify: `server/src/postgresDatabase.ts`（建表 ~:612 后、索引 ~:757 后、delegates ~:2843 后、import ~:32）
- Test: `server/test/portMappingTags.db.test.ts`（照 `server/test/previewMapping.db.test.ts` 的 `new SQLiteDatabase(':memory:')` 模式）

- [ ] **Step 1: 类型进 `types.ts`**

```ts
export type PortMappingTagSource = 'device_manual' | 'project_manual' | 'session_preview';

/**
 * Server-side annotation for a gateway port mapping (the mapping itself lives
 * in the tunnel gateway; this row carries app-level attribution: which project
 * it belongs to and how it was created). Device attribution is inherent in the
 * mapping's device_id and is deliberately NOT stored here. One mapping has at
 * most one tag (PK = mapping_id).
 */
export type PortMappingTag = {
  mappingId: string;
  userId: string;
  deviceId: string;
  projectId?: string;
  /** Snapshot at tag time — survives project deletion for device-view display. */
  projectName?: string;
  projectPath?: string;
  source: PortMappingTagSource;
  sessionId?: string;
  createdAt: string;
};
```

- [ ] **Step 2: 写失败 db 测试**

`server/test/portMappingTags.db.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { SQLiteDatabase } from '../src/database.js';
import type { PortMappingTag } from '../src/types.js';

const tag = (overrides: Partial<PortMappingTag> = {}): PortMappingTag => ({
  mappingId: 'pm_1',
  userId: 'u1',
  deviceId: 'd1',
  projectId: 'p1',
  projectName: 'Vibe Phone',
  projectPath: '~/vibe_on_phone',
  source: 'project_manual',
  createdAt: '2026-09-03T00:00:00.000Z',
  ...overrides,
});

describe('port_mapping_tags persistence', () => {
  it('round-trips a tag with project fields', () => {
    const db = new SQLiteDatabase(':memory:');
    db.upsertPortMappingTag(tag());
    expect(db.getPortMappingTagsByUser('u1')).toEqual([tag()]);
    db.close();
  });

  it('upsert on the same mapping_id overwrites (last writer wins)', () => {
    const db = new SQLiteDatabase(':memory:');
    db.upsertPortMappingTag(tag());
    db.upsertPortMappingTag(tag({ source: 'session_preview', sessionId: 'ai_1' }));
    const rows = db.getPortMappingTagsByUser('u1');
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('session_preview');
    expect(rows[0].sessionId).toBe('ai_1');
    db.close();
  });

  it('device-only tag keeps nullable project fields undefined', () => {
    const db = new SQLiteDatabase(':memory:');
    db.upsertPortMappingTag(tag({ projectId: undefined, projectName: undefined, projectPath: undefined, source: 'device_manual' }));
    const row = db.getPortMappingTagsByUser('u1')[0];
    expect(row.projectId).toBeUndefined();
    expect(row.projectName).toBeUndefined();
    expect(row.source).toBe('device_manual');
    db.close();
  });

  it('deleteByProject removes only that project tags', () => {
    const db = new SQLiteDatabase(':memory:');
    db.upsertPortMappingTag(tag());
    db.upsertPortMappingTag(tag({ mappingId: 'pm_2', projectId: 'p2' }));
    db.deletePortMappingTagsByProject('p1');
    const rows = db.getPortMappingTagsByUser('u1');
    expect(rows.map(r => r.mappingId)).toEqual(['pm_2']);
    db.close();
  });

  it('deleteNotIn prunes orphan tags for the user (empty list prunes all)', () => {
    const db = new SQLiteDatabase(':memory:');
    db.upsertPortMappingTag(tag());
    db.upsertPortMappingTag(tag({ mappingId: 'pm_2', projectId: 'p2' }));
    db.deletePortMappingTagsNotIn('u1', ['pm_1']);
    expect(db.getPortMappingTagsByUser('u1').map(r => r.mappingId)).toEqual(['pm_1']);
    db.deletePortMappingTagsNotIn('u1', []);
    expect(db.getPortMappingTagsByUser('u1')).toEqual([]);
    db.close();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd $SERVER && npx vitest run server/test/portMappingTags.db.test.ts`
Expected: FAIL — `upsertPortMappingTag is not a function`。

- [ ] **Step 4: 实现 dao `server/src/db/portMappingTags.ts`**

```ts
// Port-mapping tag persistence — extracted per the database-split pattern
// (see db/previewLinks.ts). Tags are app-level annotations (project/source)
// for mappings that physically live in the tunnel gateway; the list route
// joins gateway rows with these rows, so tags whose mapping the gateway no
// longer returns simply stop surfacing and are pruned lazily (deleteNotIn).
import type { PortMappingTag } from '../types.js';
import { asRow } from './codecs.js';
import type { SqlitePrepare, PgAll, PgExec } from './primitives.js';

export function rowToPortMappingTag(raw: unknown): PortMappingTag {
  const row = asRow(raw);
  return {
    mappingId: row.mapping_id as string,
    userId: row.user_id as string,
    deviceId: row.device_id as string,
    projectId: (row.project_id as string) || undefined,
    projectName: (row.project_name as string) || undefined,
    projectPath: (row.project_path as string) || undefined,
    source: row.source as PortMappingTag['source'],
    sessionId: (row.session_id as string) || undefined,
    createdAt: row.created_at as string,
  };
}

const UPSERT_SQL = `INSERT INTO port_mapping_tags (mapping_id, user_id, device_id, project_id, project_name, project_path, source, session_id, created_at)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
 ON CONFLICT(mapping_id) DO UPDATE SET project_id=excluded.project_id, project_name=excluded.project_name, project_path=excluded.project_path, source=excluded.source, session_id=excluded.session_id`;

function tagParams(tag: PortMappingTag): unknown[] {
  return [
    tag.mappingId,
    tag.userId,
    tag.deviceId,
    tag.projectId ?? null,
    tag.projectName ?? null,
    tag.projectPath ?? null,
    tag.source,
    tag.sessionId ?? null,
    tag.createdAt,
  ];
}

export const portMappingTagsSqlite = {
  getByUser(prepare: SqlitePrepare, userId: string): PortMappingTag[] {
    return prepare('SELECT * FROM port_mapping_tags WHERE user_id = ?')
      .all(userId)
      .map(rowToPortMappingTag);
  },
  upsert(prepare: SqlitePrepare, tag: PortMappingTag): void {
    prepare(UPSERT_SQL).run(...tagParams(tag));
  },
  deleteByProject(prepare: SqlitePrepare, projectId: string): void {
    prepare('DELETE FROM port_mapping_tags WHERE project_id = ?').run(projectId);
  },
  deleteNotIn(prepare: SqlitePrepare, userId: string, mappingIds: string[]): void {
    if (mappingIds.length === 0) {
      prepare('DELETE FROM port_mapping_tags WHERE user_id = ?').run(userId);
      return;
    }
    const placeholders = mappingIds.map(() => '?').join(', ');
    prepare(
      `DELETE FROM port_mapping_tags WHERE user_id = ? AND mapping_id NOT IN (${placeholders})`,
    ).run(userId, ...mappingIds);
  },
};

export const portMappingTagsPostgres = {
  getByUser(all: PgAll, userId: string): Promise<PortMappingTag[]> {
    return all(rowToPortMappingTag, 'SELECT * FROM port_mapping_tags WHERE user_id = ?', [userId]);
  },
  upsert(exec: PgExec, tag: PortMappingTag): Promise<void> {
    return exec(UPSERT_SQL, tagParams(tag));
  },
  deleteByProject(exec: PgExec, projectId: string): Promise<void> {
    return exec('DELETE FROM port_mapping_tags WHERE project_id = ?', [projectId]);
  },
  deleteNotIn(exec: PgExec, userId: string, mappingIds: string[]): Promise<void> {
    if (mappingIds.length === 0) {
      return exec('DELETE FROM port_mapping_tags WHERE user_id = ?', [userId]);
    }
    const placeholders = mappingIds.map(() => '?').join(', ');
    return exec(
      `DELETE FROM port_mapping_tags WHERE user_id = ? AND mapping_id NOT IN (${placeholders})`,
      [userId, ...mappingIds],
    );
  },
};
```

- [ ] **Step 5: 两库建表 + delegates**

`database.ts`（sqlite）：

1. `preview_links` 建表块（:701-713，同一个大 exec 区域内）之后加：

```ts
      CREATE TABLE IF NOT EXISTS port_mapping_tags (
        mapping_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        project_id TEXT,
        project_name TEXT,
        project_path TEXT,
        source TEXT NOT NULL,
        session_id TEXT,
        created_at TEXT NOT NULL
      );
```

2. 索引区（`idx_preview_links_user_id` 所在的 exec，~:878）加：

```ts
      CREATE INDEX IF NOT EXISTS idx_port_mapping_tags_user_project ON port_mapping_tags(user_id, project_id);
```

3. class 内 preview links delegates 块（:2664-2680）后加：

```ts
  // --- Port Mapping Tags ---

  getPortMappingTagsByUser(userId: string): PortMappingTag[] {
    return portMappingTagsSqlite.getByUser(this.prepare.bind(this), userId);
  }
  upsertPortMappingTag(tag: PortMappingTag): void {
    portMappingTagsSqlite.upsert(this.prepare.bind(this), tag);
  }
  deletePortMappingTagsByProject(projectId: string): void {
    portMappingTagsSqlite.deleteByProject(this.prepare.bind(this), projectId);
  }
  deletePortMappingTagsNotIn(userId: string, mappingIds: string[]): void {
    portMappingTagsSqlite.deleteNotIn(this.prepare.bind(this), userId, mappingIds);
  }
```

4. import（:20 旁）：`import { portMappingTagsSqlite } from './db/portMappingTags.js';` + `PortMappingTag` 加入 `./types.js` 的既有 type import。

`postgresDatabase.ts`（pg）镜像：

1. 建表数组（preview_links 所在数组，:600-612）后加同结构表项（反引号字符串、无分号结尾）。
2. 索引数组（:757）加 `` `CREATE INDEX IF NOT EXISTS idx_port_mapping_tags_user_project ON port_mapping_tags(user_id, project_id)` ``。
3. delegates（:2827-2843 后）：

```ts
  // --- Port Mapping Tags ---

  getPortMappingTagsByUser(userId: string): Promise<PortMappingTag[]> {
    return portMappingTagsPostgres.getByUser(this.all.bind(this), userId);
  }
  upsertPortMappingTag(tag: PortMappingTag): Promise<void> {
    return portMappingTagsPostgres.upsert(this.exec.bind(this), tag);
  }
  deletePortMappingTagsByProject(projectId: string): Promise<void> {
    return portMappingTagsPostgres.deleteByProject(this.exec.bind(this), projectId);
  }
  deletePortMappingTagsNotIn(userId: string, mappingIds: string[]): Promise<void> {
    return portMappingTagsPostgres.deleteNotIn(this.exec.bind(this), userId, mappingIds);
  }
```

4. import（:32 旁）同 sqlite。**两库方法签名必须一致**（`_assertPostgresSatisfiesStore` 会强制，漏一个直接编译红）。

- [ ] **Step 6: 跑测试 + typecheck**

```bash
cd $SERVER && npx vitest run server/test/portMappingTags.db.test.ts && npm run typecheck
```
Expected: 5 条 PASS；typecheck EXIT=0。

- [ ] **Step 7: 提交**

```bash
git add server/src/db/portMappingTags.ts server/src/types.ts server/src/database.ts server/src/postgresDatabase.ts server/test/portMappingTags.db.test.ts
git commit -m "feat: port_mapping_tags 标注表(dao+双库建表+delegates)——映射的设备/项目标签持久层"
```

### Task 5: 打标写入 helper（best-effort 语义）

**Files:**
- Create: `server/src/modules/tunnel/portMappingTags.ts`
- Test: `server/test/modules/tunnel/portMappingTags.test.ts`

- [ ] **Step 1: 写失败测试**

`server/test/modules/tunnel/portMappingTags.test.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUpsert, mockDb } = vi.hoisted(() => {
  const mockUpsert = vi.fn();
  return { mockUpsert, mockDb: { upsertPortMappingTag: mockUpsert } as unknown };
});
vi.mock('../../../src/store.js', () => ({
  getDatabase: vi.fn(() => mockDb),
  __esModule: true,
}));
vi.mock('../../../src/shared/logging.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  __esModule: true,
}));

import { persistPortMappingTag, prunePortMappingTags } from '../../../src/modules/tunnel/portMappingTags.js';
import { getDatabase } from '../../../src/store.js';
import { logger } from '../../../src/shared/logging.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('persistPortMappingTag', () => {
  it('upserts through the database and stamps createdAt when missing', () => {
    persistPortMappingTag({
      mappingId: 'pm_1',
      userId: 'u1',
      deviceId: 'd1',
      source: 'device_manual',
    });
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const arg = mockUpsert.mock.calls[0][0];
    expect(arg.createdAt).toEqual(expect.any(String));
    expect(arg.source).toBe('device_manual');
  });

  it('respects an explicit createdAt (deterministic tests/exports)', () => {
    persistPortMappingTag({
      mappingId: 'pm_1',
      userId: 'u1',
      deviceId: 'd1',
      source: 'session_preview',
      createdAt: '2026-09-03T01:00:00.000Z',
    });
    expect(mockUpsert.mock.calls[0][0].createdAt).toBe('2026-09-03T01:00:00.000Z');
  });

  it('never throws when the database write throws (sqlite path)', () => {
    mockUpsert.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() =>
      persistPortMappingTag({ mappingId: 'pm_1', userId: 'u1', deviceId: 'd1', source: 'device_manual' }),
    ).not.toThrow();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('swallows rejected promises (pg path)', async () => {
    mockUpsert.mockReturnValue(Promise.reject(new Error('boom')));
    persistPortMappingTag({ mappingId: 'pm_1', userId: 'u1', deviceId: 'd1', source: 'device_manual' });
    await new Promise(resolve => setImmediate(resolve));
    expect(logger.warn).toHaveBeenCalled();
  });

  it('no-ops when no database is configured', () => {
    vi.mocked(getDatabase).mockReturnValue(undefined);
    expect(() =>
      persistPortMappingTag({ mappingId: 'pm_1', userId: 'u1', deviceId: 'd1', source: 'device_manual' }),
    ).not.toThrow();
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe('prunePortMappingTags', () => {
  it('delegates to deletePortMappingTagsNotIn and never throws', () => {
    mockDb.deletePortMappingTagsNotIn = vi.fn();
    expect(() => prunePortMappingTags('u1', ['pm_1'])).not.toThrow();
    expect(mockDb.deletePortMappingTagsNotIn).toHaveBeenCalledWith('u1', ['pm_1']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run server/test/modules/tunnel/portMappingTags.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现 `server/src/modules/tunnel/portMappingTags.ts`**

```ts
// Best-effort write helpers for port_mapping_tags. Mapping creation must
// NEVER fail because tagging failed (device attribution is inherent in the
// mapping itself), so every write is swallowed-and-logged on both the sync
// (SQLite) and async (Postgres) paths.
import type { PortMappingTag } from '../../types.js';
import { now } from '../../infra/clock.js';
import { getDatabase } from '../../store.js';
import { logger } from '../../shared/logging.js';

export type PortMappingTagInput = Omit<PortMappingTag, 'createdAt'> & {
  createdAt?: string;
};

function runQuietly(what: string, write: () => void | Promise<void>): void {
  try {
    void Promise.resolve(write()).catch(error => {
      logger.warn('[tunnel] port-mapping tag write failed', { what, error: String(error) });
    });
  } catch (error) {
    logger.warn('[tunnel] port-mapping tag write failed', { what, error: String(error) });
  }
}

export function persistPortMappingTag(tag: PortMappingTagInput): void {
  const full: PortMappingTag = { ...tag, createdAt: tag.createdAt ?? now() };
  runQuietly(`upsert ${full.mappingId}`, () =>
    getDatabase()?.upsertPortMappingTag(full),
  );
}

export function prunePortMappingTags(userId: string, mappingIds: string[]): void {
  runQuietly(`prune ${userId}`, () =>
    getDatabase()?.deletePortMappingTagsNotIn(userId, mappingIds),
  );
}
```

- [ ] **Step 4: 跑测试 + 提交**

```bash
npx vitest run server/test/modules/tunnel/portMappingTags.test.ts   # PASS
git add server/src/modules/tunnel/portMappingTags.ts server/test/modules/tunnel/portMappingTags.test.ts
git commit -m "feat: 端口标签 best-effort 写入 helper——打标失败不阻塞映射创建"
```

### Task 6: POST 路由打标（可选 `project_id` + 归属校验）

**Files:**
- Modify: `server/src/modules/routes/portMappings.ts`（createSchema :29-42、POST handler :44-76）
- Modify: `server/src/shared/serializers.ts`（`publicPreviewLink` 旁）
- Test: `server/test/routes/portMappings.test.ts`（扩展；先读全文再动，其 store mock 只含 `rememberAudit`，**需补 `getDatabase`**）

- [ ] **Step 1: serializer**

`shared/serializers.ts` 加（`publicPreviewLink` 旁）：

```ts
/** Wire shape for a port-mapping tag (attached to GET /api/port-mappings rows). */
export function publicPortMappingTag(tag: PortMappingTag) {
  return {
    project_id: tag.projectId,
    project_name: tag.projectName,
    project_path: tag.projectPath,
    source: tag.source,
    session_id: tag.sessionId,
    created_at: tag.createdAt,
  };
}
```

（`PortMappingTag` 加入该文件的 types import。）

- [ ] **Step 2: 先写失败路由测试**

`server/test/routes/portMappings.test.ts` 扩展（沿用现有 `findHandler`/`runHandler` 模式）：

1. store mock（:22-25）替换为：

```ts
const { mockDb } = vi.hoisted(() => {
  const mockDb: Record<string, ReturnType<typeof vi.fn>> = {
    upsertPortMappingTag: vi.fn(),
    getPortMappingTagsByUser: vi.fn(() => []),
    deletePortMappingTagsNotIn: vi.fn(),
  };
  return { mockDb };
});
vi.mock('../../src/store', () => ({
  rememberAudit: vi.fn(),
  getDatabase: vi.fn(() => mockDb),
  __esModule: true,
}));
```

2. projects mock（新增；`getAccessibleProjectOrThrow` 走 `projects` Map + requireResourceAccess——直接 mock access 层更稳）：

```ts
vi.mock('../../src/shared/auth/access', () => ({
  getAccessibleDeviceOrThrow: vi.fn((req, deviceId) => {
    if (deviceId === 'nope') throw Object.assign(new Error('device_not_found'), { status: 404 });
    return { id: deviceId, userId: 'user-1' };
  }),
  getAccessibleProjectOrThrow: vi.fn((req, projectId) => {
    if (projectId === 'foreign') throw Object.assign(new Error('project_not_found'), { status: 404 });
    return { id: projectId, userId: 'user-1', deviceId: 'device-1', name: 'P', path: '~/p' };
  }),
  __esModule: true,
}));
```

（注意：mock access 后 `requireResourceAccess`/`requireUserId` 仍来自真实 `guards.js`，`authUser` 由 runHandler 提供——保持现状。）

3. **先扩展 `runHandler` 捕获 `next(error)`**（现版传 no-op next，路由抛错会被吞、`status` 停在 0——错误路径用例全部依赖此改动；照仓内先例 `goalRecover.test.ts:63-71`）：

```ts
  let nextError: unknown;
  await handler(req, res, (e?: unknown) => {
    nextError = e;
  });
  return { status, jsonBody, nextError };
```

4. 新 describe（POST handler 用 `findHandler('/api/port-mappings', 'post')` 取，`createPortMapping` mock 返回 `baseMapping()`）：

```ts
describe('POST /api/port-mappings tagging', () => {
  const postHandler = findHandler('/api/port-mappings', 'post');
  const body = {
    device_id: 'device-1',
    target_host: '127.0.0.1',
    target_port: 3000,
  };

  it('tags device_manual when no project_id is sent', async () => {
    const { status } = await runHandler(postHandler, { body });
    expect(status).toBe(201);
    expect(mockDb.upsertPortMappingTag).toHaveBeenCalledWith(
      expect.objectContaining({ mappingId: 'pm_1', source: 'device_manual', userId: 'user-1', deviceId: 'device-1' }),
    );
  });

  it('tags project_manual with project snapshot when project_id matches the device', async () => {
    const { status } = await runHandler(postHandler, { body: { ...body, project_id: 'p1' } });
    expect(status).toBe(201);
    expect(mockDb.upsertPortMappingTag).toHaveBeenCalledWith(
      expect.objectContaining({
        mappingId: 'pm_1',
        source: 'project_manual',
        projectId: 'p1',
        projectName: 'P',
        projectPath: '~/p',
      }),
    );
  });

  it('rejects a project bound to another device with 403 (route-level check)', async () => {
    // Access mock returns the project fine; the ROUTE's own deviceId check
    // must throw — that's the code under test.
    const { getAccessibleProjectOrThrow } = await import('../../src/shared/auth/access.js');
    vi.mocked(getAccessibleProjectOrThrow).mockImplementationOnce((() => ({
      id: 'p1',
      userId: 'user-1',
      deviceId: 'device-other',
      name: 'P',
      path: '~/p',
    })) as never);
    const { nextError } = await runHandler(postHandler, { body: { ...body, project_id: 'p1' } });
    expect(nextError).toMatchObject({ status: 403, message: 'project_device_mismatch' });
    expect(mockDb.upsertPortMappingTag).not.toHaveBeenCalled();
  });

  it('rejects an inaccessible project with 404 (access layer)', async () => {
    const { nextError } = await runHandler(postHandler, { body: { ...body, project_id: 'foreign' } });
    expect(nextError).toMatchObject({ status: 404 });
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run server/test/routes/portMappings.test.ts`
Expected: FAIL — 新用例红（实现未打标）。

- [ ] **Step 4: 实现**

`portMappings.ts`：

1. import 增补：

```ts
import { getAccessibleDeviceOrThrow, getAccessibleProjectOrThrow } from '../../shared/auth/access.js';
import { rememberAudit, getDatabase } from '../../store.js';
import { now } from '../../infra/clock.js';
import { persistPortMappingTag } from '../tunnel/portMappingTags.js';
```

（`getDatabase` 并入既有 store import；`optionalString` 保留。）

2. createSchema 尾部加：

```ts
  // Project attribution: when present, the created mapping is tagged
  // device+project (GET list exposes it as `tag`); absent = device-level tag.
  project_id: z.string().trim().min(1).optional(),
```

3. POST handler：`getAccessibleDeviceOrThrow` 之后、`ensureAgentTunnel` 之前插：

```ts
    const project = input.project_id
      ? getAccessibleProjectOrThrow(req, input.project_id)
      : undefined;
    if (project && project.deviceId !== device.id) {
      throw new ApiError(403, 'project_device_mismatch');
    }
```

4. `rememberAudit` 之后、`res.status(201)` 之前插：

```ts
    persistPortMappingTag({
      mappingId: mapping.id,
      userId: device.userId,
      deviceId: device.id,
      projectId: project?.id,
      projectName: project?.name,
      projectPath: project?.path,
      source: project ? 'project_manual' : 'device_manual',
      createdAt: now(),
    });
```

- [ ] **Step 5: 跑测试 + typecheck + 提交**

```bash
npx vitest run server/test/routes/portMappings.test.ts && npm run typecheck
git add server/src/modules/routes/portMappings.ts server/src/shared/serializers.ts server/test/routes/portMappings.test.ts
git commit -m "feat: POST /api/port-mappings 支持 project_id 打标(归属校验+best-effort 写入)"
```

### Task 7: GET 路由 join 标签 + `?project_id=` 过滤 + 孤儿惰性清理

**Files:**
- Modify: `server/src/modules/routes/portMappings.ts`（GET handler :78-102）
- Test: `server/test/routes/portMappings.test.ts`（扩展）

- [ ] **Step 1: 先写失败测试**

追加 describe：

```ts
describe('GET /api/port-mappings tag join + project filter', () => {
  it('attaches the tag to matching mappings and null to untagged ones', async () => {
    mockDb.getPortMappingTagsByUser.mockReturnValue([
      { mappingId: 'pm_1', userId: 'user-1', deviceId: 'device-1', projectId: 'p1', projectName: 'P', source: 'project_manual', createdAt: '2026-09-03T00:00:00.000Z' },
    ]);
    vi.mocked(listPortMappings).mockResolvedValue([baseMapping(), baseMapping({ id: 'pm_2', slug: 'slug2' })]);
    vi.mocked(tunnelStatus).mockReturnValue(undefined);

    const { jsonBody } = await runHandler(listHandler, { query: {} });

    const mappings = (jsonBody as { mappings: Array<Json & { tag: Json | null }> }).mappings;
    expect(mappings[0].tag).toMatchObject({ project_id: 'p1', source: 'project_manual' });
    expect(mappings[1].tag).toBeNull();
  });

  it('?project_id= filters to mappings tagged with that project (ANDs with device_id)', async () => {
    mockDb.getPortMappingTagsByUser.mockReturnValue([
      { mappingId: 'pm_1', userId: 'user-1', deviceId: 'device-1', projectId: 'p1', source: 'session_preview', createdAt: '2026-09-03T00:00:00.000Z' },
      { mappingId: 'pm_2', userId: 'user-1', deviceId: 'device-1', projectId: 'p2', source: 'device_manual', createdAt: '2026-09-03T00:00:00.000Z' },
    ]);
    vi.mocked(listPortMappings).mockResolvedValue([baseMapping(), baseMapping({ id: 'pm_2', slug: 'slug2' })]);

    const { jsonBody } = await runHandler(listHandler, { query: { project_id: 'p1' } });

    const mappings = (jsonBody as { mappings: Json[] }).mappings;
    expect(mappings).toHaveLength(1);
    expect((mappings[0] as Json).id).toBe('pm_1');
  });

  it('prunes tags whose mappings the gateway no longer lists', async () => {
    mockDb.getPortMappingTagsByUser.mockReturnValue([
      { mappingId: 'pm_dead', userId: 'user-1', deviceId: 'device-1', source: 'device_manual', createdAt: '2026-09-03T00:00:00.000Z' },
    ]);
    vi.mocked(listPortMappings).mockResolvedValue([baseMapping()]);

    await runHandler(listHandler, { query: {} });

    expect(mockDb.deletePortMappingTagsNotIn).toHaveBeenCalledWith('user-1', ['pm_1']);
  });
});
```

（`mockDb` 各 fn 在 `beforeEach` 的 `vi.clearAllMocks()` 后需重设默认返回——在 describe 内或 beforeEach 里补 `mockDb.getPortMappingTagsByUser.mockReturnValue([])`。注意 Task 6 已把 `getAccessibleProjectOrThrow` mock 掉，`?project_id=` 归属校验经它生效。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run server/test/routes/portMappings.test.ts`
Expected: 新 3 条 FAIL。

- [ ] **Step 3: 实现**

GET handler 整体替换为：

```ts
router.get('/api/port-mappings', async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const deviceId = optionalString(req.query.device_id);
    const projectId = optionalString(req.query.project_id);
    if (projectId) {
      // Project-scoped list: enforce project-level access before filtering.
      getAccessibleProjectOrThrow(req, projectId);
    }
    let mappings = await listPortMappings(resolveTunnelConfig(), userId);
    // Device-scoped list: enforce device-level access, then filter to that
    // device so the client never sees another device's mappings. Without a
    // device_id the route keeps returning all of the user's mappings.
    if (deviceId) {
      getAccessibleDeviceOrThrow(req, deviceId);
      mappings = mappings.filter(mapping => mapping.device_id === deviceId);
    }
    // Join app-level tags (project attribution / creation source). Tags live
    // in the server DB while mappings live in the gateway, so a tag whose
    // mapping is gone simply stops surfacing; those orphan rows are pruned
    // lazily below. project_id + device_id AND together.
    const database = getDatabase();
    const tags = (await database?.getPortMappingTagsByUser(userId)) ?? [];
    const tagByMappingId = new Map(tags.map(tag => [tag.mappingId, tag]));
    if (projectId) {
      mappings = mappings.filter(
        mapping => tagByMappingId.get(mapping.id)?.projectId === projectId,
      );
    }
    prunePortMappingTags(
      userId,
      mappings.map(mapping => mapping.id),
    );
    // 注：spec 提到的批量上限（≤200/次）是示例值——每用户标注行数受网关在线
    // 映射数约束（几十量级），单条 DELETE 即可；在 PR 描述注明此取舍。
    // Attach the device's live tunnel status so the phone can show tunnel
    // health next to mappings — a mapping can be 'active' while the device's
    // Piko data channel is down (public URL would 502 with no visible cause).
    res.json({
      mappings: mappings.map(mapping => ({
        ...mapping,
        tunnel_status: tunnelStatus(mapping.device_id),
        tag: tagByMappingId.has(mapping.id)
          ? publicPortMappingTag(tagByMappingId.get(mapping.id)!)
          : null,
      })),
    });
  } catch (error) {
    next(error);
  }
});
```

import 增补：`publicPortMappingTag`（serializers）、`prunePortMappingTags`（tunnel/portMappingTags.js）。

- [ ] **Step 4: 跑测试 + typecheck + 提交**

```bash
npx vitest run server/test/routes/portMappings.test.ts && npm run typecheck
git add server/src/modules/routes/portMappings.ts server/test/routes/portMappings.test.ts
git commit -m "feat: GET /api/port-mappings join 标签+project_id 过滤+孤儿标注惰性清理"
```

### Task 8: 三元组 helper 抽取 + 会话自动映射打标

**Files:**
- Create: `server/src/modules/projects/lookup.ts`
- Modify: `server/src/modules/routes/ai.ts`（inline triple-find `let project = inputProject;` 块，~:310-318，换 helper，行为 1:1 等价）
- Modify: `server/src/modules/tunnel/previewMapping.ts`（两个 mapped commit 点打标）
- Test: `server/test/modules/tunnel/previewMapping.test.ts`（扩展，照其既有 vi.mock 模式）

- [ ] **Step 1: helper（无新测试——它是 ai.ts 内联逻辑的 1:1 提取，行为由既有 session 创建测试守护）**

`server/src/modules/projects/lookup.ts`：

```ts
// Project lookup shared by session-scoped features. Extracted from the
// inline triple-find in routes/ai.ts (POST /api/ai/sessions) so the
// preview auto-mapping tags against the SAME project resolution.
import { projects } from '../../store.js';
import type { Project } from '../../types.js';

export function findProjectByTriple(
  userId: string,
  deviceId: string,
  projectPath: string | undefined,
): Project | undefined {
  if (!projectPath) return undefined;
  return Array.from(projects.values()).find(
    candidate =>
      candidate.userId === userId &&
      candidate.deviceId === deviceId &&
      candidate.path === projectPath,
  );
}
```

`ai.ts` 的 `if (!project) { project = Array.from(projects.values()).find(...) }` 整块替换为：

```ts
    if (!project) {
      project = findProjectByTriple(userId, device.id, projectPath);
    }
```

（import `findProjectByTriple`；**不要删**后续的 `upsertManualProject` 占位分支。跑 `npx vitest run server/test/routes` 回归确认会话创建路径不破。）

- [ ] **Step 2: 先写失败测试（previewMapping 扩展）**

读 `server/test/modules/tunnel/previewMapping.test.ts` 全文，按其既有模式追加两条（该文件已 mock devices/previewLinks/publish/gatewayClient；需**补 mock**：`store.js` 的 mock 对象加 `getDatabase: vi.fn(() => undefined)`，新增 mock `../../../src/modules/projects/lookup.js` 的 `findProjectByTriple`）：

```ts
  it('tags the mapping session_preview with project snapshot after a fresh map', async () => {
    vi.mocked(findProjectByTriple).mockReturnValue(
      { id: 'p1', name: 'P', path: '~/p' } as never,
    );
    vi.mocked(createPortMapping).mockResolvedValue(baseMapping('pm_new'));
    await autoMapPreviewPort(session(), makeLink());

    expect(persistPortMappingTag).toHaveBeenCalledWith(
      expect.objectContaining({
        mappingId: 'pm_new',
        source: 'session_preview',
        sessionId: 'ai_s1',
        projectId: 'p1',
        projectName: 'P',
      }),
    );
  });

  it('tags without project fields when no project resolves', async () => {
    vi.mocked(findProjectByTriple).mockReturnValue(undefined);
    vi.mocked(createPortMapping).mockResolvedValue(baseMapping('pm_new'));
    await autoMapPreviewPort(session(), makeLink());

    expect(persistPortMappingTag).toHaveBeenCalledWith(
      expect.objectContaining({ mappingId: 'pm_new', source: 'session_preview', projectId: undefined }),
    );
  });
```

（`baseMapping`/`session`/`makeLink` 工厂照该文件既有定义；session 工厂需带 `projectPath: '~/p'`——若无则在该测试内展开对象补字段。`persistPortMappingTag` 需 mock：`vi.mock('../../../src/modules/tunnel/portMappingTags.js', () => ({ persistPortMappingTag: vi.fn(), prunePortMappingTags: vi.fn(), __esModule: true }))`。）

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run server/test/modules/tunnel/previewMapping.test.ts`
Expected: 新 2 条 FAIL（未打标）。

- [ ] **Step 4: 实现**

`previewMapping.ts`：

1. import 增补：

```ts
import { findProjectByTriple } from '../projects/lookup.js';
import { persistPortMappingTag } from './portMappingTags.js';
import { now } from '../../infra/clock.js';
```

2. 模块内（`commit` 旁）加：

```ts
/**
 * Session-sourced mappings carry the device+project tag: resolve the project
 * with the SAME (user, device, path) triple the session was created against.
 * Fire-and-forget — tagging failure must not fail the mapping.
 */
function tagSessionMapping(session: AiSession, mappingId: string): void {
  const project = findProjectByTriple(
    session.userId,
    session.deviceId,
    session.projectPath,
  );
  persistPortMappingTag({
    mappingId,
    userId: session.userId,
    deviceId: session.deviceId,
    projectId: project?.id,
    projectName: project?.name,
    projectPath: project?.path,
    source: 'session_preview',
    sessionId: session.id,
    createdAt: now(),
  });
}
```

3. 两个 mapped commit 点打标：
   - 复用路径是 **`return commit(link, 'mapped');`**（`if (existing...mappingStillAlive)` 块内）——改三行：

     ```ts
     commit(link, 'mapped');
     tagSessionMapping(session, existing.portMappingId);
     return;
     ```

   - 新建路径（`link.portMappingId = mapping.id;` 之后的裸 `commit(link, 'mapped');`）：其后加 `tagSessionMapping(session, mapping.id);`

- [ ] **Step 5: 跑测试 + typecheck + 提交**

```bash
npx vitest run server/test/modules/tunnel server/test/routes && npm run typecheck
git add server/src/modules/projects/lookup.ts server/src/modules/routes/ai.ts server/src/modules/tunnel/previewMapping.ts server/test/modules/tunnel/previewMapping.test.ts
git commit -m "feat: 会话自动映射打 session_preview 标——复用 ai.ts 项目三元组解析(抽 lookup helper)"
```

### Task 9: 项目删除级联清标

**Files:**
- Modify: `server/src/modules/routes/projects.ts`（delete 路由内 `getDatabase()?.deleteProject(project.id);` 一行，~:318 旁，以 grep 锚点定位）
- Test: `server/test/routes/projects.delete.test.ts` 若已存在则扩展；否则新建（先 `ls server/test/routes | grep project` 确认；照 portMappings.test.ts 的 handler 直取模式，mock `store.js` 的 `getDatabase` + `ProjectRepository` 所在模块）

- [ ] **Step 1: 写失败测试**（断言 delete 路由调用了 `deletePortMappingTagsByProject('p1')`；测试骨架照同目录既有 projects 路由测试的 mock 集合——缺该测试文件则按 handler 直取模式自建，mock：`store.js`（aiSessions/devices/projects/getDatabase/rememberAudit/scheduleStateSave）、`shared/auth/access.js`（getAccessibleProjectOrThrow 返回 `{ id:'p1', userId:'user-1', deviceId:'d1', path:'~/p' }`））

- [ ] **Step 2: 跑测试确认失败**（`deletePortMappingTagsByProject` 未被调用）

- [ ] **Step 3: 实现**

delete 路由内 `getDatabase()?.deleteProject(project.id);` 的下一行加：

```ts
    // Cascade: a deleted project leaves orphan tags behind; drop them so the
    // device view cannot keep advertising a dead project name.
    getDatabase()?.deletePortMappingTagsByProject(project.id);
```

（照 surrounding 代码的 floating-call 风格，不 await；与 `deleteProject` 同款。）

- [ ] **Step 4: 跑测试 + typecheck + 提交**

```bash
npx vitest run server/test/routes && npm run typecheck
git add server/src/modules/routes/projects.ts server/test/routes/
git commit -m "feat: 项目删除级联清理 port_mapping_tags"
```

---

## Phase P3 · 手机端项目区块与共享卡片（$PHONE）

### Task 10: api client 扩展（tag 类型 + projectId + 参数对象化）

**Files:**
- Modify: `src/api/portMappings.ts`
- Modify: `src/screens/devices/PortMappingsScreen.tsx:124`（`fetchPortMappings` 调用点换参）
- Test: Create `__tests__/portMappingsApi.test.ts`

- [ ] **Step 1: 写失败测试**

`__tests__/portMappingsApi.test.ts`：

```ts
import { fetchPortMappings, createPortMapping } from '../src/api/portMappings';
import { apiGet, apiPost } from '../src/api/client';

jest.mock('../src/api/client', () => ({
  apiGet: jest.fn().mockResolvedValue({ mappings: [] }),
  apiPost: jest.fn().mockResolvedValue({}),
  apiDelete: jest.fn(),
}));

describe('portMappings api', () => {
  it('builds device_id and project_id query params together', async () => {
    await fetchPortMappings({ deviceId: 'd1', projectId: 'p1' });
    expect(apiGet).toHaveBeenCalledWith('/api/port-mappings?device_id=d1&project_id=p1');
  });

  it('requests the bare path without params', async () => {
    await fetchPortMappings();
    expect(apiGet).toHaveBeenCalledWith('/api/port-mappings');
  });

  it('forwards project_id on create', async () => {
    await createPortMapping({
      deviceId: 'd1',
      targetHost: '127.0.0.1',
      targetPort: 3000,
      expiresInSeconds: 3600,
      projectId: 'p1',
    });
    expect(apiPost).toHaveBeenCalledWith(
      '/api/port-mappings',
      expect.objectContaining({ device_id: 'd1', project_id: 'p1' }),
      expect.anything(),
    );
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest __tests__/portMappingsApi.test.ts`
Expected: FAIL（签名/参数不符）。

- [ ] **Step 3: 实现**

`src/api/portMappings.ts`：

1. 类型新增（`PortMapping` 前）：

```ts
export type PortMappingTagSource = 'device_manual' | 'project_manual' | 'session_preview';

/** App-level attribution the server attaches to a mapping (project / source). */
export interface PortMappingTag {
  project_id?: string;
  project_name?: string;
  project_path?: string;
  source: PortMappingTagSource;
  session_id?: string;
  created_at: string;
}
```

2. `PortMapping` 加字段：`tunnel_status?: TunnelStatusInfo;` 后：

```ts
  /** Server-side tag (project attribution). null = untagged (older server). */
  tag?: PortMappingTag | null;
```

3. `CreatePortMappingInput` 加 `projectId?: string;`（注释：`/** When set, the mapping is tagged device+project. */`）。
4. `fetchPortMappings` 换参数对象（保持兼容调用方同步改，Step 4）：

```ts
export const fetchPortMappings = async (
  params: { deviceId?: string; projectId?: string } = {},
): Promise<PortMapping[]> => {
  const search = new URLSearchParams();
  if (params.deviceId) search.set('device_id', params.deviceId);
  if (params.projectId) search.set('project_id', params.projectId);
  const query = search.toString();
  const response = await apiGet<{ mappings: PortMapping[] }>(
    query ? `/api/port-mappings?${query}` : '/api/port-mappings',
  );
  return response.mappings;
};
```

5. `createPortMapping` body 加 `...(input.projectId ? { project_id: input.projectId } : {}),`。

- [ ] **Step 4: 更新调用方 + 跑测试**

`PortMappingsScreen.tsx:124`：`fetchPortMappings(route.params.deviceId)` → `fetchPortMappings({ deviceId: route.params.deviceId })`。

Run: `npx jest __tests__/portMappingsApi.test.ts && npx tsc --noEmit`
Expected: PASS / EXIT=0。

- [ ] **Step 5: 提交**

```bash
git add src/api/portMappings.ts src/screens/devices/PortMappingsScreen.tsx __tests__/portMappingsApi.test.ts
git commit -m "feat: 端口映射 api 客户端贯通 tag/project_id(参数对象化)"
```

### Task 11: 抽共享 `PortMappingCard`（含项目 chip）

**Files:**
- Create: `src/components/devices/PortMappingCard.tsx`
- Create: `src/utils/portInput.ts`
- Modify: `src/screens/devices/PortMappingsScreen.tsx`（删本地 MappingCard/IconAction/effectiveStatus/parsePort/isAllowedTargetHost 与卡片 styles，改 import）
- Modify: `src/i18n/locales/devices/{en,zh}.json`（portMappings 节点加 source 键）
- Test: Create `__tests__/portInput.test.ts`、`__tests__/PortMappingCard.test.tsx`

- [ ] **Step 1: 迁移纯函数到 `src/utils/portInput.ts`（原样搬运 + 测试）**

```ts
// Shared port-mapping input validation (device + project create forms).
export const isAllowedTargetHost = (input: string) => {
  const host = input.trim().toLowerCase();
  if (host === 'localhost' || host === '::1') return true;
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part))) {
    return false;
  }
  const octets = parts.map(Number);
  if (octets.some(octet => octet < 0 || octet > 255)) return false;
  if (octets[0] === 127 || octets[0] === 10) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  return octets[0] === 192 && octets[1] === 168;
};

export const parsePort = (input: string) => {
  if (!/^\d+$/.test(input.trim())) return null;
  const port = Number(input);
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null;
};
```

`__tests__/portInput.test.ts`：localhost/::1/127.x/10.x/172.16-31/192.168 通过，公网 IP/缺位/越界端口拒绝，parsePort 边界（1/65535/0/65536/非数字）。

- [ ] **Step 2: 写卡片失败测试 `__tests__/PortMappingCard.test.tsx`**

渲染断言（用 `react-test-renderer` + ThemeContext.Provider，模板照 `__tests__/ProjectDetailScreen.test.tsx` 的 Provider 包装；卡片内部 `useTranslation('devices')` 用 jest.setup 锁定的 zh）：
1. 有 `tag.project_name` → 树内出现项目名 Text + 来源小标文本 `会话自动`；
2. 无 tag → 不出现来源行；
3. `status: 'active'` → 出现 `使用中` chip 文本；`target_host:port` 文本渲染。
4. onCopy/onOpen/onRevoke 通过 TouchableOpacity onPress 触发（卡片 actions 行的按钮依次调用）。

mock：`../../src/api/portMappings` 不需要（卡片只吃 props + 类型）。

- [ ] **Step 3: 跑测试确认失败**（组件不存在）

- [ ] **Step 4: 实现组件**

`src/components/devices/PortMappingCard.tsx`：把 `PortMappingsScreen.tsx` 的 `effectiveStatus`（:69-75）、`MappingCardProps`/`MappingCard`（:562-666）、`IconAction`（:668-717）、styles 的 `mappingCard/mappingHeader/mappingTarget/mappingTargetCopy/urlRow/url/mappingActions/actionSpacer/iconAction/iconBadgeBorderless`（:799-852）**原样搬入**并做两点增强：

1. 导出改名：`export const PortMappingCard`，props 接口 `PortMappingCardProps`。
2. header 行（`</View>` of mappingHeader 之后、urlRow 之前）插入 tag 行：

```tsx
      {mapping.tag?.project_name ? (
        <View style={styles.tagRow}>
          <StatusChip label={mapping.tag.project_name} type="info" />
          <Text
            style={[
              theme.typography.labelSm,
              { color: theme.colors.onSurfaceVariant },
            ]}>
            {t(
              mapping.tag.source === 'session_preview'
                ? 'portMappings.sourceSessionPreview'
                : mapping.tag.source === 'project_manual'
                ? 'portMappings.sourceProjectManual'
                : 'portMappings.sourceDeviceManual',
            )}
          </Text>
        </View>
      ) : null}
```

```ts
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
```

imports：`PortMapping, PortMappingTagSource` 类型、`effectiveStatus` 本地实现、GlassPanel/StatusChip/IconBadge/useTheme/useTranslation。

i18n `devices/{en,zh}.json` portMappings 节点尾部（`"serviceUnavailable"` 后）加：

```json
    "sourceSessionPreview": "Auto (session)" / "会话自动",
    "sourceProjectManual": "Manual (project)" / "项目内新建",
    "sourceDeviceManual": "Manual" / "手动新建"
```

- [ ] **Step 5: PortMappingsScreen 换用共享卡片**

删除本地 `effectiveStatus`/`parsePort`/`isAllowedTargetHost`/`MappingCard`/`IconAction` 及已搬走的 styles；`parsePort`/`isAllowedTargetHost` 改从 `../../utils/portInput` import；`MappingCard` 改 `PortMappingCard`（import 自 `../../components/devices/PortMappingCard`）；`parsePort` 调用点签名不变。**逐字搬移不改逻辑**——这一步是纯机械迁移 + chip 增强。

- [ ] **Step 6: 跑测试 + tsc + 提交**

```bash
npx jest __tests__/PortMappingCard.test.tsx __tests__/portInput.test.ts && npx tsc --noEmit
git add src/components/devices/PortMappingCard.tsx src/utils/portInput.ts src/screens/devices/PortMappingsScreen.tsx src/i18n/locales/devices __tests__/PortMappingCard.test.tsx __tests__/portInput.test.ts
git commit -m "refactor: MappingCard 抽共享 PortMappingCard 并支持项目标签 chip"
```

### Task 12: `ProjectPortMappingsSection` 组件（列表+新建+撤销）

**Files:**
- Create: `src/components/projects/ProjectPortMappingsSection.tsx`
- Modify: `src/i18n/locales/projects/{en,zh}.json`（顶层加 `portMappings` 节点）
- Test: Create `__tests__/ProjectPortMappingsSection.test.tsx`

- [ ] **Step 1: i18n（先写，测试断言依赖）**

`projects/en.json` 顶层加：

```json
  "portMappings": {
    "section": "PUBLIC PORTS",
    "createSection": "NEW PUBLIC URL",
    "emptyTitle": "No public ports",
    "emptyBody": "Expose from a vibe session (auto, 24h) or create one below.",
    "readOnlyNoDevice": "Bind a device to this project to manage public ports."
  },
```

`projects/zh.json`：

```json
  "portMappings": {
    "section": "公网端口",
    "createSection": "新建公网地址",
    "emptyTitle": "暂无公网端口",
    "emptyBody": "可由 vibe 会话自动暴露(24小时有效)，或在下方手动创建。",
    "readOnlyNoDevice": "给项目绑定设备后即可管理公网端口。"
  },
```

- [ ] **Step 2: 写失败测试**

`__tests__/ProjectPortMappingsSection.test.tsx`（Provider 包装照 ProjectDetailScreen 测试；mock `../src/api/portMappings`）：

```tsx
jest.mock('../src/api/portMappings', () => ({
  fetchPortMappings: jest.fn().mockResolvedValue([]),
  createPortMapping: jest.fn(),
  revokePortMapping: jest.fn(),
}));
```

用例：
1. **列表渲染**：`fetchPortMappings` mock 返回带 `tag: { project_name: 'X' }` 的映射 → 卡片出现（`target_host:port` 文本）；并断言 `fetchPortMappings` 被以 `{ projectId: 'project-1' }` 调用。
2. **新建带 project_id**：输入端口 `3000`（TextInput changeText），tap 创建按钮 → `createPortMapping` 以 `expect.objectContaining({ projectId: 'project-1', targetHost: '127.0.0.1', targetPort: 3000 })` 调用。
3. **撤销**：列表一条 active 映射，触发卡片撤销 onPress → `Alert.alert` 被调（mock `react-native` 的 Alert——本仓 preset 允许；见 memory：**勿 mock 整个 react-native**，用 `jest.spyOn(Alert, 'alert')`），确认回调里 `revokePortMapping` 被调用。
4. **无设备只读**：`device` prop 传 undefined → 不渲染创建表单（`port-input` testID 不存在），显示 `readOnlyNoDevice` 文本。
5. **空态**：fetch 返回 [] → `emptyTitle` 文本出现。

- [ ] **Step 3: 跑测试确认失败**

- [ ] **Step 4: 实现组件**

`src/components/projects/ProjectPortMappingsSection.tsx` 结构（自包含 header，仿 ProjectDetailScreen 的 SectionLabel 标记样式）：

```tsx
interface ProjectPortMappingsSectionProps {
  project: Project;
  device?: Device;
}

export const ProjectPortMappingsSection: React.FC<ProjectPortMappingsSectionProps> = ({
  project,
  device,
}) => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('projects');   // section/empty 串
  const { t: td } = useTranslation('devices'); // 复用 devices.portMappings.*（expiry/offline/unsupported/invalidPort/create 等）
  const [mappings, setMappings] = useState<PortMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [targetPort, setTargetPort] = useState('');
  const [expiresInSeconds, setExpiresInSeconds] = useState(28_800);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  // EXPIRY_OPTIONS 复用 devices 屏的同一组值(1h/8h/24h/7d)，labelKey 用 td。

  // 门控与设备屏一致：online + 两个隧道 capability + tunnelAvailable
  const tunnelBlocker = /* 与 Task 2 相同的三态判定（offline/unsupported/tunnel/null） */;
  const canCreate = Boolean(device && tunnelBlocker === null && parsePort(targetPort));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchPortMappings({ projectId: project.id });
      if (!mountedRef.current) return;
      setMappings([...result].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
    } catch {
      if (mountedRef.current) setError(td('portMappings.loadFailed'));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [project.id, td]);

  useEffect(() => { load(); return () => { mountedRef.current = false; }; }, [load]);
  // 注意 mountedRef 置 false 的 cleanup 只挂一次（空依赖 effect），勿随 load 重建——照 PortMappingsScreen.tsx:111-117 的双 effect 模式。

  const handleCreate = async () => { /* createPortMapping({ deviceId: device.id, targetHost: '127.0.0.1', targetPort: parsePort(targetPort)!, expiresInSeconds, projectId: project.id }) → unshift + 清空端口输入；错误走 mappingErrorKey 同款逻辑（把该 helper 一并搬进本组件或提为 utils——两处用，提到 src/utils/portInput.ts 一并导出） */ };
  const performRevoke = async (mapping: PortMapping) => { /* 照 PortMappingsScreen:217-232 */ };

  // 渲染：SectionHeader(t('portMappings.section')) → 无 device 时 readOnly 提示 →
  //   列表（loading 态 / 空态 emptyTitle+emptyBody / PortMappingCard 列表）→
  //   device 且 tunnelBlocker===null 时创建表单（端口 TextInput testID="port-input" +
  //   detectedPorts 快选 chips + 有效期 chips + GlowButton td('portMappings.create')）；
  //   tunnelBlocker 非 null 时显示 td(offline/unsupported 对应文案) 的 Notice。
};
```

完整代码由实现者按上述骨架 + `PortMappingsScreen.tsx` 对应片段逐字拼装（`handleCreate`/`performRevoke`/表单 chips 的 JSX 形状照抄 :175-198、:217-249、:300-500 区间的对应块，仅把 `t(...)` 换成 `td(...)`、deviceId/projectId 换 props）。**不新增样式族**——复用卡片组件 + 局部 styles（header/section 间距仿 ProjectDetailScreen.styles.sectionLabel）。

- [ ] **Step 5: 跑测试 + tsc + 提交**

```bash
npx jest __tests__/ProjectPortMappingsSection.test.tsx && npx tsc --noEmit
git add src/components/projects/ProjectPortMappingsSection.tsx src/i18n/locales/projects __tests__/ProjectPortMappingsSection.test.tsx src/utils/portInput.ts
git commit -m "feat: 项目公网端口区块组件——列表/detectedPorts 快选新建(自动带项目标签)/撤销"
```

### Task 13: ProjectDetailScreen 挂载区块 + 收尾回归

**Files:**
- Modify: `src/screens/projects/ProjectDetailScreen.tsx`（QUICK ACTIONS 与 HISTORY 之间插一行）
- Test: `__tests__/ProjectDetailScreen.test.tsx`（补 api mock）

- [ ] **Step 1: 更新既有测试（防网络泄漏）**

`__tests__/ProjectDetailScreen.test.tsx` 头部加：

```ts
jest.mock('../src/api/portMappings', () => ({
  fetchPortMappings: jest.fn().mockResolvedValue([]),
  createPortMapping: jest.fn(),
  revokePortMapping: jest.fn(),
}));
```

- [ ] **Step 2: 实现挂载**

`ProjectDetailScreen.tsx`：import `ProjectPortMappingsSection`；在 QUICK ACTIONS 的 grid 闭合（~:316）与 HISTORY 的 `<SectionLabel label={t('projectDetail.vibeHistory')} ...>`（~:319）之间插：

```tsx
        {/* ── PUBLIC PORTS · project-tagged mappings ────────────────── */}
        <ProjectPortMappingsSection project={project} device={device} />
```

- [ ] **Step 3: 跑测试确认通过 + 全量回归**

```bash
cd $PHONE
npx jest __tests__/ProjectDetailScreen.test.tsx
npx tsc --noEmit
npm test   # 全量;对比 Task 前基线,除已知 terminal flake 外零新增失败
```

- [ ] **Step 4: 提交**

```bash
git add src/screens/projects/ProjectDetailScreen.tsx __tests__/ProjectDetailScreen.test.tsx
git commit -m "feat: 项目详情页挂载公网端口区块"
```

---

## 收尾

- [ ] 两仓分支各自全量回归（phone `npm test` + `tsc`；server `npm test` + `npm run typecheck`），对照基线仅剩已知失败。
- [ ] 用 superpowers:finishing-a-development-branch 决定合并/PR；**未经用户确认不合回 main**。
- [ ] 部署提示（写入 PR 描述）：server 需重启生效（新表 `CREATE TABLE IF NOT EXISTS` 自建）；phone 需 rebuild APK；网关/agent 零改动。
