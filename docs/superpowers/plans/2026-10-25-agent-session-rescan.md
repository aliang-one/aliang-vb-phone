# 项目会话列表「重扫电脑」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 手机上(项目详情页 + 项目会话列表页)可主动触发电脑端 agent 立即扫描并上报会话列表,轮询确认新会话到达。

**Architecture:** 三端打通的一条轻推链路——手机 POST → server 向 agent WS 写 `agent.inventory.refresh` → agent 立即推全量 `agent.hello`(复用既有幂等 upsert + `ai.sessions.updated` 推送,零改动)→ 手机轮询项目会话接口检测变化。交互为「触发+轮询确认」(~8s 封顶),数据流单源(hook 只管触发/轮询/判定,列表状态仍归 `useProjectSessions`)。

**Tech Stack:** Go (alianggate) / TypeScript + Express + vitest (AliangPhoneServer) / React Native + jest (AliangVibeCodingPhone)

**Spec:** `docs/superpowers/plans/` 同级的 `docs/superpowers/specs/2026-10-25-agent-session-rescan-design.md`(已审阅通过)

---

## 三仓库布局与总纪律

本计划横跨三个本地仓库。**每个 Task 开工前必须重查该仓库的 ref/工作区状态**(有并行会话推进 main 的历史,git 结构操作前当场重查是硬规矩):

| 端 | 仓库路径 | 默认分支 |
| --- | --- | --- |
| agent | `/Users/mac/MyProgram/GoProgram/nursor/alianggate` | `master` |
| server | `/Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangVibeCodingPhone` 旁的 `/Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangPhoneServer` | `main` |
| phone | `/Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangVibeCodingPhone` | `main` |

- 提交信息用中文、一行主题,结尾加:`Co-Authored-By: Claude Code <noreply@anthropic.com>`
- 部署顺序(Task 7 才执行):agent → server → phone。各端向后兼容,单独回滚均安全。

---

### Task 1: agent — `agent.inventory.refresh` 指令(alianggate)

**Files:**
- Modify: `app/http/models/agent_protocol.go`(加事件常量)
- Modify: `app/http/services/agent_remote_ws.go`(`handleRemoteAgentMessage` 加 case,函数在 :643)
- Test: `app/http/services/agent_remote_ws_inventory_refresh_test.go`(新建)

- [ ] **Step 1: 重查仓库状态**

```bash
cd /Users/mac/MyProgram/GoProgram/nursor/alianggate && git status --short --branch && git log -1 --oneline
```

Expected: 在 `master`,工作区无本功能相关的未提交改动(其他 WIP 不动)。

- [ ] **Step 2: 写失败测试**

新建 `app/http/services/agent_remote_ws_inventory_refresh_test.go`(测试骨架照抄 `agent_rename_event_test.go` 的 harness:`t.TempDir()` 当 HOME + `NewAgentService()` + 捕获型 `writeJSON`):

```go
package services

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"aliang.one/nursorgate/app/http/models"
	"aliang.one/nursorgate/common/cache"
)

// TestHandleRemoteInventoryRefreshSendsHello closes the server→agent rescan
// nudge: PhoneServer(手机端「重扫电脑」)publishes agent.inventory.refresh
// and this agent must answer by pushing a full hello immediately instead of
// waiting for the 10s digest tick or the 60s periodic backstop. Read-only,
// so it deliberately sits OUTSIDE the enabled-device gate (same tier as
// hello-class traffic).
func TestHandleRemoteInventoryRefreshSendsHello(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	cache.ResetCacheDirForTest()
	service := NewAgentService()

	var hellos []map[string]interface{}
	writeJSON := func(v interface{}) error {
		if m, ok := v.(map[string]interface{}); ok && m["type"] == models.AgentEventHello {
			hellos = append(hellos, m)
		}
		return nil
	}

	service.handleRemoteAgentMessage(map[string]interface{}{
		"type": models.AgentEventInventoryRefresh,
	}, writeJSON)

	require.Len(t, hellos, 1, "inventory refresh must push exactly one hello")
	// 不在 enabled-device 门控名单:未启用状态下也必须响应(只读动作)。
	assert.False(t, remoteAgentMessageRequiresEnabledDevice(models.AgentEventInventoryRefresh))
}
```

- [ ] **Step 3: 跑测试确认编译失败**

```bash
cd /Users/mac/MyProgram/GoProgram/nursor/alianggate && go test ./app/http/services/ -run TestHandleRemoteInventoryRefresh
```

Expected: FAIL,`undefined: models.AgentEventInventoryRefresh`。

- [ ] **Step 4: 加事件常量**

`app/http/models/agent_protocol.go:10` 附近的 const 块里,按对齐风格加一行:

```go
AgentEventInventoryRefresh        = "agent.inventory.refresh"
```

- [ ] **Step 5: 加处理 case**

`app/http/services/agent_remote_ws.go` 的 `handleRemoteAgentMessage` switch 里(`models.AgentEventDeviceSettings` case 附近)加:

```go
	case models.AgentEventInventoryRefresh:
		// Server 端「重扫电脑」轻推(手机项目会话列表下拉/按钮触发):立即
		// 收集并推送一次全量 hello,不等 10s digest tick / 60s 周期兜底。
		// 只读动作,不进 enabled-device 门控名单(与 hello 类流量一致)。
		// 失败仅记日志:一次失败的推送不得撕断读循环(与 digest 变更分支同语义)。
		s.setRemoteConnectionState(true, "online", "")
		if err := s.sendAgentHello(writeJSON, "server_requested"); err != nil {
			logger.Warn(fmt.Sprintf("[AGENT-BOOT] remote_connection requested_rescan_hello_failed error=%v", err))
		}
```

- [ ] **Step 6: 跑测试确认通过 + 回归**

```bash
cd /Users/mac/MyProgram/GoProgram/nursor/alianggate && go test ./app/http/services/ -run TestHandleRemoteInventoryRefresh -v && go build ./...
```

Expected: 测试 PASS,`go build ./...` 无输出(编译通过)。

- [ ] **Step 7: 提交**

```bash
cd /Users/mac/MyProgram/GoProgram/nursor/alianggate && git add app/http/models/agent_protocol.go app/http/services/agent_remote_ws.go app/http/services/agent_remote_ws_inventory_refresh_test.go && git commit -m "$(cat <<'EOF'
remote ws: 新增 agent.inventory.refresh 指令,server 轻推即全量 hello 上报

手机「重扫电脑」链路的 agent 端:收到指令立即 sendAgentHello(reason=
server_requested),不等 10s digest / 60s 兜底;只读动作不进 enabled
门控,失败仅记日志不断连。

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: server — rescan 路由(AliangPhoneServer)

**Files:**
- Modify: `server/src/modules/routes/projects.ts`(在 `GET /api/projects/:projectId/ai-sessions` 路由 :368 之后插入)
- Test: `server/test/modules/routes/projectAiSessionsRescan.test.ts`(新建)

- [ ] **Step 1: 重查仓库状态**

```bash
cd /Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangPhoneServer && git status --short --branch && git log -1 --oneline
```

- [ ] **Step 2: 写失败测试**

新建 `server/test/modules/routes/projectAiSessionsRescan.test.ts`。req/res mock 与 store 初始化照抄 `server/test/modules/routes/aiSessionsList.test.ts` 的 harness(`req.authUser = { id: 'u1', role: 'user' }`、`resetAppState()+configureStore(...)`、从 `projectsRouter.stack` 里 findHandler);project fixture 照抄 `server/test/modules/project/state.test.ts:41` 的 `projects.set(...)`:

```ts
// POST /api/projects/:projectId/ai-sessions/refresh — 手机端「重扫电脑」。
// 鉴权 → 项目可达 → agent 在线(requireOnlineAgentForPublish 守卫,离线 409 device_offline)→ 向 agent WS
// fire-and-forget 轻推 agent.inventory.refresh;hello 回来后走既有
// upsert + ai.sessions.updated 链路,本路由不等待扫描结果(冷扫描 30s+)。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { projectRouter } from '../../../src/modules/routes/projects.js';
import {
  configureStore,
  devices,
  projects,
  resetAppState,
} from '../../../src/store.js';
import type { Device } from '../../../src/types.js';
import { ApiError } from '../../../src/errors.js';
import { publishToAgent } from '../../../src/shared/realtime/publish.js';
import {
  isAgentConnected,
  requireOnlineAgentForPublish,
} from '../../../src/shared/ws/registry.js';

vi.mock('../../../src/shared/realtime/publish.js', () => ({
  publishToAgent: vi.fn(async () => undefined),
  publishToMobiles: vi.fn(async () => undefined),
  publishPresenceUpdate: vi.fn(async () => undefined),
  publishAiSessionState: vi.fn(),
  initRealtimePublisher: vi.fn(),
}));

// isAgentConnected 读真实 WS 连接表(测试进程永远为空),必须 mock——
// 否则「agent 在线」用例永远走 409,正确实现也会被逼着改坏。
vi.mock('../../../src/shared/ws/registry.js', () => ({
  isAgentConnected: vi.fn(() => false),
  requireOnlineAgentForPublish: vi.fn(),
}));

const findHandler = (
  path: string,
): ((req: Request, res: Response) => Promise<void>) => {
  const layer = projectRouter.stack.find(
    l =>
      l.route?.path === path &&
      l.route.stack.some(h => h.method === 'post'),
  );
  if (!layer) throw new Error(`POST ${path} route not mounted`);
  return layer.route!.stack.find(l => l.method === 'post')!
    .handle as unknown as (req: Request, res: Response) => Promise<void>;
};

const refreshHandler = findHandler(
  '/api/projects/:projectId/ai-sessions/refresh',
);

const device = (id: string): Device =>
  ({
    id,
    userId: 'u1',
    name: id,
    platform: 'darwin-arm64',
    status: 'online',
    capabilities: [],
    tools: [],
    history: [],
    activePorts: [],
    authorizedDirectories: [],
    projectIds: [],
    remoteTerminalEnabled: true,
    aiControlEnabled: true,
    createdAt: '2026-10-01T00:00:00Z',
  }) as unknown as Device;

const runRefresh = async (projectId: string, auth = true) => {
  const req = {
    authUser: auth ? { id: 'u1', role: 'user' } : undefined,
    header: () => undefined,
    params: { projectId },
  } as unknown as Request;
  let statusCode = 0;
  let payload: unknown;
  // 路由是 try/catch + next(e) 形态:必须传捕获型 next,否则错误路径
  // 会以 TypeError(next is not a function)告终,断言不到 ApiError。
  // (照 terminalAttach.test.ts:70 的既有错误路径先例。)
  let nextError: unknown;
  const next: NextFunction = (error?: unknown) => {
    nextError = error;
  };
  const res = {
    status(code: number) {
      statusCode = code;
      return { json(p: unknown) { payload = p; } };
    },
    json(p: unknown) {
      statusCode = statusCode || 200;
      payload = p;
    },
  } as unknown as Response;
  await refreshHandler(req, res, next);
  return { statusCode, payload, thrown: nextError };
};

describe('POST /api/projects/:projectId/ai-sessions/refresh', () => {
  beforeEach(() => {
    // 清调用史(本仓库无全局 clearMocks);注意 clearAllMocks 不清
    // implementation,离线守卫的默认实现在此显式给出,消除用例间顺序耦合。
    vi.clearAllMocks();
    vi.mocked(requireOnlineAgentForPublish).mockImplementation(() => undefined);
    resetAppState();
    configureStore(
      { driver: 'sqlite', dbPath: ':memory:', saveDebounceMs: 1 },
      {
        auditLogLimit: 100,
        terminalCommandRetentionPerSession: 100,
        terminalIdleTimeoutEnabled: false,
        terminalIdleTimeoutMinutes: 30,
        stt: { provider: 'stub', appKey: '', region: 'cn-shanghai' },
      },
    );
    devices.set('dev-a', device('dev-a'));
    projects.set('p1', {
      id: 'p1',
      userId: 'u1',
      deviceId: 'dev-a',
      path: '/repo',
      lastActiveAt: 'old',
      updatedAt: 'old',
    } as never);
  });

  it('agent 在线:轻推 agent.inventory.refresh 并 200 {status:"requested"}', async () => {
    const { statusCode, payload } = await runRefresh('p1');
    expect(statusCode).toBe(200);
    expect(payload).toEqual({ status: 'requested' });
    expect(vi.mocked(publishToAgent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(publishToAgent)).toHaveBeenCalledWith(
      'dev-a',
      { type: 'agent.inventory.refresh' },
      expect.objectContaining({ direction: 'server_to_agent', cache: false }),
    );
  });

  it('agent 离线:409 device_offline,不发轻推', async () => {
    vi.mocked(requireOnlineAgentForPublish).mockImplementation(() => {
      throw new ApiError(409, 'device_offline');
    });
    const { thrown } = await runRefresh('p1');
    expect(thrown).toMatchObject({ status: 409, code: 'device_offline' });
    expect(vi.mocked(publishToAgent)).not.toHaveBeenCalled();
  });

  it('未鉴权:401', async () => {
    const { statusCode, thrown } = await runRefresh('p1', false);
    const err = thrown as { status?: number };
    expect(statusCode === 401 || err.status === 401).toBe(true);
  });

  it('项目不可达:404', async () => {
    const { statusCode, thrown } = await runRefresh('p-missing');
    const err = thrown as { status?: number };
    expect(statusCode === 404 || err.status === 404).toBe(true);
  });
});
```

注意:`getAccessibleProjectOrThrow` 的鉴权细节以 `requireUserId` / `shared/auth/access.js` 实测为准——若 `authUser` mock 不够(比如还要 headers),照抄 `aiSessionsList.test.ts` 里已验证的 mock 形状,断言目标不变。

- [ ] **Step 3: 跑测试确认失败**

```bash
cd /Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangPhoneServer && npx vitest run server/test/modules/routes/projectAiSessionsRescan.test.ts
```

Expected: FAIL,`POST /api/projects/:projectId/ai-sessions/refresh route not mounted`。

- [ ] **Step 4: 实现路由**

`server/src/modules/routes/projects.ts`,紧跟在 `router.get('/api/projects/:projectId/ai-sessions', ...)`(约 :395 结束)之后插入。`requireOnlineAgentForPublish`、`isAgentConnected`、`publishToAgent`、`ApiError`、`requireUserId`、`getAccessibleProjectOrThrow` 该文件均已 import;`rememberAudit` 若未 import 则从 `'../../store.js'` 补:

```ts
// POST /api/projects/:projectId/ai-sessions/refresh — 手机端「重扫电脑」:
// 向项目所属设备的 agent 轻推一条 agent.inventory.refresh,agent 立即收集
// 并推回全量 hello(幂等 upsert + ai.sessions.updated 推手机,既有链路零
// 改动)。Fire-and-forget:不等待 agent 扫描——冷转录扫描实测 30s+
// (alianggate app/http/handlers/agent_handler.go 事故注),到达确认由
// 手机端轮询列表接口完成;轻推本身不进重连缓存(cache:false),agent 重连
// 时本就会自发 hello,重放无意义。离线守卫复用兄弟路由同款
// requireOnlineAgentForPublish(409 device_offline,手机端
// describeDeviceError 已有标准文案)。
router.post('/api/projects/:projectId/ai-sessions/refresh', async (req, res, next) => {
  try {
    requireUserId(req);
    const project = getAccessibleProjectOrThrow(req, req.params.projectId);
    requireOnlineAgentForPublish(project.deviceId);
    await publishToAgent(
      project.deviceId,
      { type: 'agent.inventory.refresh' },
      {
        direction: 'server_to_agent',
        source: { kind: 'http', user_id: project.userId },
        cache: false,
      },
    );
    rememberAudit({
      userId: project.userId,
      deviceId: project.deviceId,
      eventType: 'project.ai_sessions.rescan',
      metadata: { project_id: project.id },
    });
    res.json({ status: 'requested' });
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 5: 跑测试确认通过**

```bash
cd /Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangPhoneServer && npx vitest run server/test/modules/routes/projectAiSessionsRescan.test.ts
```

Expected: PASS(4 用例)。

- [ ] **Step 6: 全量回归 + 类型检查**

```bash
cd /Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangPhoneServer && npm run build && npx vitest run
```

Expected: build 无错,vitest 全绿(存量失败若与本改动无关,记录并跳过,勿顺手修)。

- [ ] **Step 7: 提交**

```bash
cd /Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangPhoneServer && git add server/src/modules/routes/projects.ts server/test/modules/routes/projectAiSessionsRescan.test.ts && git commit -m "$(cat <<'EOF'
projects: 新增 ai-sessions/refresh 重扫路由(轻推 agent.inventory.refresh)

手机「重扫电脑」链路的 server 端:鉴权+项目可达+agent 在线检查(409
device_offline,requireOnlineAgentForPublish),fire-and-forget 轻推后立即 200;不等待冷扫描,到达确认
归手机端轮询。审计 project.ai_sessions.rescan。

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: phone — API 函数 + 轮询判定纯函数

**Files:**
- Modify: `src/api/projects.ts`(文件末尾追加)
- Create: `src/screens/vibecoding/sessionRescan.ts`
- Test: `src/screens/vibecoding/__tests__/sessionRescan.test.ts`(新建)

- [ ] **Step 1: 重查仓库状态**

```bash
git status --short --branch && git log -1 --oneline
```

(在 phone 仓库 `/Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangVibeCodingPhone`。)

- [ ] **Step 2: 写纯函数的失败测试**

新建 `src/screens/vibecoding/__tests__/sessionRescan.test.ts`(风格照 `sessionRefreshDispatch.test.ts`):

```ts
import { resolveRescanTick } from '../sessionRescan';

const base = {
  polledCount: 3,
  polledIds: ['a', 'b', 'c'],
  polledLatestLastActiveAt: '2026-10-25T00:00:00Z',
  baselineCount: 3,
  baselineIds: ['a', 'b', 'c'],
  baselineLatestLastActiveAt: '2026-10-25T00:00:00Z',
  isFinalTick: false,
};

describe('resolveRescanTick — 重扫到达判定', () => {
  it('无变化:继续轮询', () => {
    expect(resolveRescanTick(base)).toBe('keep-polling');
  });

  it('total_count 增大:停表(有变化)', () => {
    expect(resolveRescanTick({ ...base, polledCount: 4 })).toBe('stop-changed');
  });

  it('出现新 session id:停表', () => {
    expect(
      resolveRescanTick({ ...base, polledIds: ['a', 'b', 'c', 'd'] }),
    ).toBe('stop-changed');
  });

  it('last_active_at 变新(新消息落到旧会话):停表', () => {
    expect(
      resolveRescanTick({
        ...base,
        polledLatestLastActiveAt: '2026-10-25T01:00:00Z',
      }),
    ).toBe('stop-changed');
  });

  it('双方都缺 last_active_at:只看 count/ids,不算变化', () => {
    expect(
      resolveRescanTick({
        ...base,
        polledLatestLastActiveAt: undefined,
        baselineLatestLastActiveAt: undefined,
      }),
    ).toBe('keep-polling');
  });

  it('末拍仍无变化:超时停表', () => {
    expect(resolveRescanTick({ ...base, isFinalTick: true })).toBe(
      'stop-timeout',
    );
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
npx jest src/screens/vibecoding/__tests__/sessionRescan.test.ts
```

Expected: FAIL,模块不存在。

- [ ] **Step 4: 实现纯函数**

新建 `src/screens/vibecoding/sessionRescan.ts`:

```ts
/**
 * 重扫轮询判定(纯函数,便于对「重扫电脑」的到达语义钉测试)。
 *
 * 「重扫电脑」触发后,手机轮询 /api/projects/:id/ai-sessions:total_count
 * 增大、出现新 session id、或最新 last_active_at 变新,任一成立即算"到达"
 * (停表)。线字段名必须是 publicAiSessionSummary 下发的 last_active_at
 * ——updated_at 在本仓库特指 agent 文件时钟,server 有意不下发
 * (2026-10-15 时钟污染修复),勿混用。server 侧 upsert 有时钟守卫,
 * 无变化的重复 hello 不会推进 last_active_at,所以超时诚实地等于"没变化"。
 */
export type RescanTickAction = 'stop-changed' | 'keep-polling' | 'stop-timeout';

export function resolveRescanTick(input: {
  polledCount: number;
  polledIds: string[];
  polledLatestLastActiveAt: string | undefined;
  baselineCount: number;
  baselineIds: string[];
  baselineLatestLastActiveAt: string | undefined;
  isFinalTick: boolean;
}): RescanTickAction {
  if (
    input.polledCount > input.baselineCount ||
    input.polledIds.some(id => !input.baselineIds.includes(id)) ||
    (input.polledLatestLastActiveAt !== undefined &&
      input.baselineLatestLastActiveAt !== undefined &&
      input.polledLatestLastActiveAt > input.baselineLatestLastActiveAt)
  ) {
    return 'stop-changed';
  }
  return input.isFinalTick ? 'stop-timeout' : 'keep-polling';
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
npx jest src/screens/vibecoding/__tests__/sessionRescan.test.ts
```

Expected: PASS(6 用例)。

- [ ] **Step 6: 加 API 函数**

`src/api/projects.ts` 末尾追加(`apiPost` 已在该文件 import):

```ts
/**
 * 「重扫电脑」:请 server 轻推项目所属设备的 agent 立即扫描并上报会话列表。
 * Fire-and-forget:server 只 ACK {status:'requested'},新会话是否到达由
 * 调用方轮询 fetchProjectAiSessions 确认。agent 离线时 server 回 409
 * device_offline(ApiResponseError)。
 */
export const refreshProjectAiSessions = (
  projectId: string,
): Promise<{ status: string }> =>
  apiPost<{ status: string }>(
    `/api/projects/${projectId}/ai-sessions/refresh`,
    {},
  );
```

- [ ] **Step 7: 类型检查 + 提交**

```bash
npx tsc --noEmit 2>&1 | grep -v "react-test-renderer\|deprecated" | head -5
```

Expected: 无新增错误(存量 deprecated 告警忽略)。然后:

```bash
git add src/api/projects.ts src/screens/vibecoding/sessionRescan.ts src/screens/vibecoding/__tests__/sessionRescan.test.ts && git commit -m "$(cat <<'EOF'
vibecoding: 重扫到达判定纯函数 + refresh 重扫 API

resolveRescanTick 以 total_count/新 id/last_active_at 三信号判定到达;
线字段名钉死 last_active_at(updated_at 是 agent 文件时钟,勿混用)。

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: phone — useSessionRescan hook

**Files:**
- Create: `src/hooks/useSessionRescan.ts`
- Test: `src/hooks/__tests__/useSessionRescan.test.tsx`(新建)

- [ ] **Step 1: 写失败的 hook 测试**

新建 `src/hooks/__tests__/useSessionRescan.test.tsx`(harness 照 `useIncrementalList.test.tsx`:TestRenderer + Harness 组件 + fake timers):

```tsx
/**
 * useSessionRescan — 触发+轮询确认。锁四件事:变化即停、409 短路不轮询、
 * 进行中去重、超时上限。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ApiResponseError } from '../../api/client';
import { useSessionRescan, type RescanOutcome } from '../useSessionRescan';
import {
  fetchProjectAiSessions,
  refreshProjectAiSessions,
} from '../../api/projects';

jest.mock('../../api/projects');

const mockedFetch =
  fetchProjectAiSessions as jest.MockedFunction<typeof fetchProjectAiSessions>;
const mockedRefresh =
  refreshProjectAiSessions as jest.MockedFunction<typeof refreshProjectAiSessions>;

// fixture 用真实线字段名(session_id / last_active_at),钉住 server 下发形状。
const list = (count: number, latest = '2026-10-25T00:00:00Z') => ({
  sessions: Array.from({ length: count }, (_, i) => ({
    session_id: `s${i + 1}`,
    last_active_at: latest,
  })),
  total_count: count,
});

type Api = { rescanning: boolean; rescan: () => Promise<RescanOutcome> };

const mount = (projectId: string | undefined, onPoll?: () => void) => {
  let api!: Api;
  const Harness: React.FC = () => {
    api = useSessionRescan(projectId, onPoll);
    return null;
  };
  TestRenderer.create(<Harness />);
  return api;
};

const advancePoll = () =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(1200);
  });

describe('useSessionRescan', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('无 projectId:短路 error,不发任何请求', async () => {
    const api = mount(undefined);
    let outcome!: RescanOutcome;
    await act(async () => {
      outcome = await api.rescan();
    });
    expect(outcome).toBe('error');
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('检测到新会话:updated 停表,onPoll 每拍被调', async () => {
    mockedFetch
      .mockResolvedValueOnce(list(3) as never)
      .mockResolvedValue(list(4) as never);
    mockedRefresh.mockResolvedValue({ status: 'requested' });
    let polls = 0;
    const api = mount('p1', () => {
      polls += 1;
    });
    let outcome!: RescanOutcome;
    await act(async () => {
      const pending = api.rescan();
      await jest.advanceTimersByTimeAsync(1200);
      outcome = await pending;
    });
    expect(outcome).toBe('updated');
    expect(polls).toBe(1);
  });

  it('409 device_offline:不轮询,返回 agent-offline', async () => {
    mockedFetch.mockResolvedValue(list(3) as never);
    mockedRefresh.mockRejectedValue(
      new ApiResponseError('device_offline', 409, 'device_offline'),
    );
    const api = mount('p1');
    let outcome!: RescanOutcome;
    await act(async () => {
      outcome = await api.rescan();
    });
    expect(outcome).toBe('agent-offline');
    expect(mockedFetch).toHaveBeenCalledTimes(1); // 仅基线一拍
  });

  it('六拍无变化:timeout,fetch 共 7 次(基线+6)', async () => {
    mockedFetch.mockResolvedValue(list(3) as never);
    mockedRefresh.mockResolvedValue({ status: 'requested' });
    const api = mount('p1');
    let outcome!: RescanOutcome;
    await act(async () => {
      const pending = api.rescan();
      for (let i = 0; i < 6; i += 1) {
        await jest.advanceTimersByTimeAsync(1200);
      }
      outcome = await pending;
    });
    expect(outcome).toBe('timeout');
    expect(mockedFetch).toHaveBeenCalledTimes(7);
  });

  it('进行中去重:第二轮询直接短路', async () => {
    mockedFetch.mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve(list(3) as never), 500)),
    );
    mockedRefresh.mockResolvedValue({ status: 'requested' });
    const api = mount('p1');
    let first!: RescanOutcome;
    let second!: RescanOutcome;
    await act(async () => {
      const p1 = api.rescan();
      second = await api.rescan();
      await jest.advanceTimersByTimeAsync(8000);
      first = await p1;
    });
    expect(second).toBe('error');
    void first;
  });
});
```

若 mock 的返回类型与 `ProjectAiSessionList` 有出入(缺字段),按 `src/api/projects.ts:273` 的 `ProjectAiSessionList` 形状补齐 fixture(`as never` 已兜)。

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest src/hooks/__tests__/useSessionRescan.test.tsx
```

Expected: FAIL,模块不存在。

- [ ] **Step 3: 实现 hook**

新建 `src/hooks/useSessionRescan.ts`:

```ts
import { useCallback, useRef, useState } from 'react';
import { ApiResponseError } from '../api/client';
import {
  fetchProjectAiSessions,
  refreshProjectAiSessions,
  type ProjectAiSessionList,
} from '../api/projects';
import { resolveRescanTick } from '../screens/vibecoding/sessionRescan';

export type RescanOutcome = 'updated' | 'timeout' | 'agent-offline' | 'error';

// 首拍 1.2s × 6 拍 ≈ 8s 封顶(与 ProjectScanScreen 的轮询节奏同族)。
const RESCAN_POLL_MS = 1200;
const RESCAN_MAX_TICKS = 6;

const delay = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * 「重扫电脑」hook:轻推 agent 立即扫描,并轮询项目会话接口直到检测到
 * 变化(新会话/新消息)或 ~8s 超时。
 *
 * 数据流单源:本 hook 不持有第二份会话列表状态——每拍驱动调用方传入的
 * onPoll(即 useProjectSessions.reload)刷新屏幕既有列表,hook 自身的
 * fetch 只服务于变化判定。
 *
 * 并发语义:进行中第二次触发直接返回 'error'(从简,不排队/不合并)。
 * UI 层 RefreshControl refreshing={rescanning} 已抑制重复触发,此路径
 * 实际不可达;系对 spec §6「复用同一轮询」的有意偏差。
 * 线字段:会话 id 是 ServerAiSession 的 session_id(非 id),活跃时间是
 * last_active_at(非 updated_at)——两个字段名都以 server 下发为准。
 */
export function useSessionRescan(
  projectId: string | undefined,
  onPoll?: () => Promise<void> | void,
) {
  const [rescanning, setRescanning] = useState(false);
  const inFlightRef = useRef(false);

  const rescan = useCallback(async (): Promise<RescanOutcome> => {
    // 无项目上下文 / 已在重扫中:幂等短路,不叠加第二轮询。
    if (!projectId || inFlightRef.current) return 'error';
    inFlightRef.current = true;
    setRescanning(true);
    try {
      const baseline = snapshotOf(await fetchProjectAiSessions(projectId));
      try {
        await refreshProjectAiSessions(projectId);
      } catch (error) {
        return outcomeOfError(error);
      }
      for (let tick = 1; tick <= RESCAN_MAX_TICKS; tick += 1) {
        await delay(RESCAN_POLL_MS);
        const polled = await fetchProjectAiSessions(projectId);
        await onPoll?.();
        const action = resolveRescanTick({
          polledCount: polled.total_count,
          polledIds: polled.sessions.map(session => session.session_id),
          polledLatestLastActiveAt: latestLastActiveAt(polled.sessions),
          baselineCount: baseline.count,
          baselineIds: baseline.ids,
          baselineLatestLastActiveAt: baseline.latestLastActiveAt,
          isFinalTick: tick === RESCAN_MAX_TICKS,
        });
        if (action === 'stop-changed') return 'updated';
        if (action === 'stop-timeout') break;
      }
      return 'timeout';
    } catch {
      return 'error';
    } finally {
      inFlightRef.current = false;
      setRescanning(false);
    }
  }, [projectId, onPoll]);

  return { rescanning, rescan };
}

type RescanSnapshot = {
  count: number;
  ids: string[];
  latestLastActiveAt: string | undefined;
};

const snapshotOf = (list: ProjectAiSessionList): RescanSnapshot => ({
  count: list.total_count,
  ids: list.sessions.map(session => session.session_id),
  latestLastActiveAt: latestLastActiveAt(list.sessions),
});

// server 侧按 lastActiveAt 降序返回,但判定不依赖顺序:取 max。
const latestLastActiveAt = (
  sessions: ProjectAiSessionList['sessions'],
): string | undefined =>
  sessions.reduce<string | undefined>(
    (acc, session) =>
      !acc || session.last_active_at > acc ? session.last_active_at : acc,
    undefined,
  );

const outcomeOfError = (error: unknown): RescanOutcome =>
  error instanceof ApiResponseError &&
  (error.status === 409 || error.code === 'device_offline')
    ? 'agent-offline'
    : 'error';
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx jest src/hooks/__tests__/useSessionRescan.test.tsx
```

Expected: PASS(5 用例)。若 fake-timer 与 async 交织出现挂起,用 `await jest.advanceTimersByTimeAsync(...)`(而非 `runAllTimersAsync`)并确认每拍 1200ms 与常量一致。

- [ ] **Step 5: 提交**

```bash
git add src/hooks/useSessionRescan.ts src/hooks/__tests__/useSessionRescan.test.tsx && git commit -m "$(cat <<'EOF'
hooks: useSessionRescan 触发+轮询确认(变化即停/409 短路/去重/8s 上限)

数据流单源:hook 只管触发/轮询/判定,每拍驱动 onPoll(useProjectSessions
.reload)刷新列表,不持有第二份会话状态。

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: phone — AgentSessionsScreen 下拉接线

**Files:**
- Modify: `src/screens/vibecoding/AgentSessionsScreen.tsx`
- Modify: `src/i18n/locales/vibecoding/en.json`、`src/i18n/locales/vibecoding/zh.json`

- [ ] **Step 1: 加 i18n 文案**

`en.json` 的 `agentSessions` 节点(现只有 `messagesCount`)加:

```json
"rescan": {
  "action": "Rescan computer",
  "updated": "Computer scanned — list updated",
  "timeout": "Computer is slow to respond — try again shortly",
  "failed": "Rescan failed"
}
```

`zh.json` 对应:

```json
"rescan": {
  "action": "重扫电脑",
  "updated": "已重扫电脑,列表已更新",
  "timeout": "电脑响应较慢,稍后下拉重试",
  "failed": "重扫失败"
}
```

(离线提示复用 `utils/deviceError.ts` 的 `describeDeviceError(new Error('device_offline'))` 现成文案,与项目扫描屏一致,不加新 key。)

- [ ] **Step 2: 接线 RefreshControl**

`AgentSessionsScreen.tsx` 改动点:

1. import 增补:`RefreshControl`(react-native)、`useCallback`(react,若缺)、`describeDeviceError`(`../../utils/deviceError`)、`useSessionRescan`(`../../hooks/useSessionRescan`)、`useToastStore`(`../../store/toastStore`)
2. 组件体内:

```tsx
const { show } = useToastStore(s => s.show);
// 外层组件目前没有 t(只有 SessionCard 内有):补声明;useTranslation 的
// 文件级 import 已存在,无需新增。
const { t } = useTranslation('vibecoding');
const refreshFromServer = useControlCenterStore(s => s.refreshFromServer);
// projectScoped 已有:const projectScoped = useProjectSessions(...);
const rescanProjectId = route.params?.projectId;
const { rescanning, rescan } = useSessionRescan(
  rescanProjectId,
  rescanProjectId ? projectScoped.reload : undefined,
);
const rescanDevice = useMemo(() => {
  if (route.params?.deviceId) {
    return devices.find(d => d.id === route.params?.deviceId);
  }
  const project = rescanProjectId
    ? projects.find(p => p.id === rescanProjectId)
    : undefined;
  return project
    ? devices.find(d => d.id === project.deviceId)
    : undefined;
}, [route.params?.deviceId, rescanProjectId, devices, projects]);

const handleRefresh = useCallback(async () => {
  // 全局/设备视图(数据源是 store 快照):退化为普通重取,不做重扫(范围外)。
  if (!rescanProjectId) {
    await refreshFromServer();
    return;
  }
  // 设备已知离线(指定 deviceId 或项目反查所得):不发注定失败的请求
  // (照项目扫描屏先例;比 spec 的"仅指定 deviceId"更宽,有意为之,
  // 与 spec 错误表一致,避免一次必败往返)。
  if (rescanDevice?.status === 'offline') {
    show(describeDeviceError(new Error('device_offline')).title, 'error');
    return;
  }
  const outcome = await rescan();
  if (outcome === 'updated') show(t('agentSessions.rescan.updated'), 'success');
  else if (outcome === 'timeout') show(t('agentSessions.rescan.timeout'), 'info');
  else if (outcome === 'agent-offline') {
    show(describeDeviceError(new Error('device_offline')).title, 'error');
  } else if (outcome === 'error') {
    show(t('agentSessions.rescan.failed'), 'error');
  }
}, [rescanProjectId, rescanDevice, rescan, refreshFromServer, show, t]);
```

3. FlatList 加:

```tsx
refreshControl={
  <RefreshControl
    refreshing={rescanning}
    onRefresh={handleRefresh}
    tintColor={theme.colors.primary}
    colors={[theme.colors.primary]}
  />
}
```

- [ ] **Step 3: 类型检查 + 回归**

```bash
npx tsc --noEmit 2>&1 | grep -v "react-test-renderer\|deprecated" | head -5 && npx jest src/screens/vibecoding
```

Expected: 无新增类型错误;vibecoding 相关存量测试全绿。

- [ ] **Step 4: 提交**

```bash
git add src/screens/vibecoding/AgentSessionsScreen.tsx src/i18n/locales/vibecoding/en.json src/i18n/locales/vibecoding/zh.json && git commit -m "$(cat <<'EOF'
AgentSessions: 下拉即重扫电脑(触发+轮询确认,~8s 封顶)

项目 scoped 下拉=轻推 agent 重扫;全局/设备 scoped 保持普通重取。
离线短路灯 + 四态 toast 反馈。

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: phone — ProjectDetailScreen 重扫按钮

**Files:**
- Modify: `src/screens/projects/ProjectDetailScreen.tsx`(HISTORY 区,`SectionLabel` 在 :376)

- [ ] **Step 1: 接线**

1. import 增补:`useSessionRescan`、`describeDeviceError`、`TouchableOpacity`/`ActivityIndicator`(react-native,若缺)、`IconBadge`(若缺)
2. 组件体内(`useProjectSessions` 解构处之后)。注意:`const show = useToastStore(s => s.show)` 该屏 **:60 已有,直接复用,勿重复声明**:

```tsx
const { rescanning: rescanPending, rescan } = useSessionRescan(
  project?.id,
  reload,
);
const handleRescan = useCallback(async () => {
  if (device && device.status === 'offline') {
    show(describeDeviceError(new Error('device_offline')).title, 'error');
    return;
  }
  const outcome = await rescan();
  if (outcome === 'updated') {
    show(t('vibecoding:agentSessions.rescan.updated'), 'success');
  } else if (outcome === 'timeout') {
    show(t('vibecoding:agentSessions.rescan.timeout'), 'info');
  } else if (outcome === 'agent-offline') {
    show(describeDeviceError(new Error('device_offline')).title, 'error');
  } else {
    show(t('vibecoding:agentSessions.rescan.failed'), 'error');
  }
}, [device, rescan, show, t]);
```

(`t` 的 namespace 形态以该屏现有 `useTranslation` 用法为准——若已是多 namespace 联合,直接 `t('agentSessions.rescan.updated')`;若单 namespace,按上面的 `'vibecoding:'` 前缀写。)

3. HISTORY 区(:376 `SectionLabel` 行)改为 label + 右侧重扫按钮的行布局:

```tsx
<View style={styles.historyHeader}>
  <SectionLabel label={t('projectDetail.vibeHistory')} count={totalCount} />
  <TouchableOpacity
    activeOpacity={0.7}
    onPress={handleRescan}
    disabled={rescanPending}
    style={styles.rescanButton}
    accessibilityLabel={t('vibecoding:agentSessions.rescan.action')}>
    {rescanPending ? (
      <ActivityIndicator size="small" color={theme.colors.primary} />
    ) : (
      <IconBadge name="refresh" tone="neutral" size={28} iconSize={15} />
    )}
  </TouchableOpacity>
</View>
```

4. `styles` 加:

```ts
historyHeader: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
},
rescanButton: {
  padding: 4,
},
```

- [ ] **Step 2: 类型检查 + 回归**

```bash
npx tsc --noEmit 2>&1 | grep -v "react-test-renderer\|deprecated" | head -5 && npx jest src/screens/projects src/hooks
```

Expected: 无新增类型错误;相关测试全绿。

- [ ] **Step 3: 提交**

```bash
git add src/screens/projects/ProjectDetailScreen.tsx && git commit -m "$(cat <<'EOF'
ProjectDetail: 会话 HISTORY 区加重扫电脑按钮(同 AgentSessions 触发链路)

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 部署与真机验证(手动,按序)

**Files:** 无代码改动。涉及两台外部环境的操作,参照既有部署配方(memory:`k8s-deploy-recipe-and-pitfalls`、`done-wall-fix-deploy-state`)。

- [ ] **Step 1: 部署 agent 到 liang-dev**

```bash
cd /Users/mac/MyProgram/GoProgram/nursor/alianggate && GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o aliang ./cmd/aliang
```

scp 到 liang-dev 并替换运行中的二进制。**先在 liang-dev 上 `systemctl --user cat aliang-agent.service`(或 sudo 视角)确认 ExecStart 指向的路径再替换**——存量记忆显示该机历史上有用户单元与 `/tmp` 手动替换两种形态,以现场为准;替换后重启对应服务并看日志确认 WS 重连(`sending_hello reason=connect`)。

- [ ] **Step 2: 部署 server 到 k8s**

走既有通道:buildx amd64 构建镜像 → push register.liang.home → 阿良板(`aliangboard` MCP)`update_image` 升 `nursor/aliang-phone-agent-server`(env count 不变,本次无新 env)。验证:pod 就绪后 `POST /api/projects/:id/ai-sessions/refresh` 对离线设备返回 409 `device_offline`。

- [ ] **Step 3: 手机端打包安装**

iPhone 真机走既有配方(memory:`ios-free-team-install-recipe`,必须带 `SWIFT_COMPILATION_MODE=singlefile`)。

- [ ] **Step 4: 真机验证清单**

1. liang-dev TUI 开一个新 claude 会话 → 不等自动同步,直接在手机项目详情页点重扫按钮 → 数秒内新会话卡片出现,toast「已重扫电脑」
2. AgentSessionsScreen 下拉 → 同上,轮询期间 RefreshControl 转圈,到达即停
3. 停掉 liang-dev 的 agent 服务 → 手机下拉 → 离线提示,不转长圈
4. 无新会话时下拉 → ~8s 后 toast「电脑响应较慢」,列表无异常闪动

全绿后:若 iPhone 走发版通道,build 号按仓库惯例递增并单独提交(参照最近 `发版:build 号` 提交)。
