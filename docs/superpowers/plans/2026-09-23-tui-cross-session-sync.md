# TUI 跨会话同步(通知式)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 手机端对共享会话(CC TUI 正开着的那个 Claude session)的回合落地后,由 server→agent→CC cross-session messaging UDS socket 向空闲 TUI 注入一条摘要通知,实现 TUI 显示+模型上下文双同步。

**Architecture:** server 在 ai.done 结算时对带 sourceSessionId 的会话发新下行命令 `ai.tui.sync`(digest 由 server 纯函数生成);agent 端 60s 合并去抖 → 四重门控(记录活+idle+socket 能力+jsonl 增长)→ UDS 写 auth/user 两行帧 → 读回执记日志。全程 best-effort,静默降级。

**Tech Stack:** server: TypeScript/vitest;agent: Go/stdin net(Unix socket,无新依赖);phone: RN/i18next/jest。

**Spec:** `AliangVibeCodingPhone/docs/superpowers/specs/2026-09-23-tui-cross-session-sync-design.md`(已评审 Approved)

**Repo 路径:**
- server: `/Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangPhoneServer`(分支 base: `main`)
- agent: `/Users/mac/MyProgram/GoProgram/nursor/alianggate`(分支 base: `master`;⚠️ 主检出是 `alianggate`,`alianggate-cosdl` 是无关 worktree,勿用)
- phone: `/Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangVibeCodingPhone`(分支 base: `main`)

**Worktree 约定(一律 worktree 分支开发):** 每仓 `git worktree add .worktrees/tui-sync -b <branch> <base>`;分支名 server/phone=`feat/tui-cross-session-sync`,agent=`feat/cc-peer-tui-sync`。commit message 中文,每条 commit 实际执行时带尾行:

```
Co-Authored-By: Claude Code <noreply@anthropic.com>
```

**各仓测试坑(必读):**
- server: tsconfig 在 `server/` 子目录;预存失败=issuePikoTunnelTicket(勿当回归);命令在 worktree 根跑 `npx vitest run <file>`(vitest workspace 从根解析)。
- agent: 必须 `CGO_ENABLED=1 go build`(go-sqlite3);验证三件套 `gofmt -l app/`、`go vet ./app/...`、`go test ./app/http/services/`。
- phone: jest pattern 必须放 flag 前;主树全量 jest 会扫进遗留 worktree(`\.worktrees` 过滤);worktree 内跑定向测试 `npx jest __tests__/<file>` 即可。

---

### Task 0: Spike——本机实测 CC cross-session messaging(手动,无代码,** gating 后续参数)

**Files:** 无(产出=spike 结论,回填到本计划附录 A)。

- [ ] **Step 1: 起隔离测试 TUI**

```bash
mkdir -p /tmp/cc-spike && cd /tmp/cc-spike
tmux new-session -d -s ccspike 'claude'
sleep 8   # 等 TUI 就绪
ls -t ~/.claude/sessions/*.json | head -3
```

- [ ] **Step 2: 读发现信息**——取最新 `<pid>.json`,记下 `sessionId`/`messagingSocketPath`/`status`;取配套 `<pid>.<sha>.key` 里的 `peerToken`:

```bash
cat ~/.claude/sessions/<pid>.json
cat ~/.claude/sessions/<pid>.*.key
```

- [ ] **Step 3: 带 token 注入**(TUI 空闲时)

```bash
{ echo '{"type":"auth","token":"<peerToken>"}'; \
  echo '{"type":"user","message":{"role":"user","content":"spike1: reply with exactly OK-1"}}'; } \
  | socat - UNIX-CONNECT:<messagingSocketPath>
```

观察 tmux:是否自动开新 turn?是否弹审批(gate hold)?socat 是否回打状态帧(抄录原文)?

- [ ] **Step 4: 无 auth 行注入**(验证 mac 是否可省 token)

```bash
echo '{"type":"user","message":{"role":"user","content":"spike2: reply with exactly OK-2"}}' \
  | socat - UNIX-CONNECT:<messagingSocketPath>
```

- [ ] **Step 5: busy 注入**——先在 tmux 里给 TUI 一个长任务(如"数到 60,每秒报一次"),注入进行中消息,记录"工具调用间送达"行为。
- [ ] **Step 6: 记录**——①auth 是否必需 ②空闲自动 turn 延迟 ③gate 默认(accept/hold)④回执帧真实 JSON 原文 ⑤一次注入 turn 的 token 量级(`/cost`)。**结论回填附录 A;若回执帧结构 ≠ 计划假设(见 Task 5 Step 2 注),按实况修正 `ccPeerStatusFromFrame`。**
- [ ] **Step 7: 清理**——tmux 里 `/exit` 退出测试 TUI,`tmux kill-session -t ccspike 2>/dev/null || true`。

---

### Task 1: server——digest 构造纯函数(TDD)

**Files:**
- Create: `server/src/modules/ai/tuiSyncDigest.ts`
- Test: `server/test/modules/ai/tuiSync.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, expect, it } from 'vitest';
import { buildAiTuiSyncDigest } from '../../src/modules/ai/tuiSyncDigest.js';
import type { AiSession } from '../../src/types.js';

function sessionWith(transcript: Array<{ role: string; content: string }>): AiSession {
  return {
    id: 'ai_import_x',
    userId: 'u1',
    deviceId: 'dev1',
    sourceSessionId: 'native-uuid',
    transcript: transcript.map((m, i) => ({
      id: `m${i}`,
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
      timestamp: new Date(2026, 0, 1, 0, 0, i).toISOString(),
    })),
  } as unknown as AiSession;
}

describe('buildAiTuiSyncDigest', () => {
  it('returns undefined without a usable user message', () => {
    expect(buildAiTuiSyncDigest(sessionWith([]))).toBeUndefined();
    expect(
      buildAiTuiSyncDigest(sessionWith([{ role: 'assistant', content: 'hi' }])),
    ).toBeUndefined();
  });

  it('skips hidden and blank user messages, takes the LAST usable one', () => {
    const digest = buildAiTuiSyncDigest(
      sessionWith([
        { role: 'user', content: 'earlier' },
        { role: 'user', content: '   ' },
        { role: 'user', content: '最新一条手机消息' },
      ]),
    );
    expect(digest).toContain('最新一条手机消息');
    expect(digest).not.toContain('earlier');
  });

  it('is a pure notice: contains the no-redo guard, quotes are truncated at 200 chars', () => {
    const digest = buildAiTuiSyncDigest(
      sessionWith([{ role: 'user', content: 'x'.repeat(500) }]),
    );
    expect(digest!).toContain('请勿重做');
    expect(digest!).toContain('…');
    expect(digest!.length).toBeLessThan(600);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangPhoneServer && npx vitest run server/test/modules/ai/tuiSync.test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 最小实现**

> 有意的简化(相对 spec §5):spec 的「续聊了 N 轮」计数与 zh/en 双模板在此合并为**单条双语模板、无 N 计数**——spec 自己已把 N 定性为可接受的修饰性问题,双语一行同时覆盖 TUI 用户(中文)与模型(英文尾注),省掉服务端语言管道(YAGNI)。

```typescript
// server/src/modules/ai/tuiSyncDigest.ts
import type { AiSession } from '../../types.js';

// Spec 2026-09-23-tui-cross-session-sync: the digest injected into the live
// CC TUI must be a PURE context-sync notice — it embeds a quoted excerpt of
// the phone user's message but must never instruct the TUI to redo work (the
// headless run already did it). Bilingual: the TUI user reads Chinese; the
// short English tail disambiguates for the model regardless of locale.
const DIGEST_MAX_QUOTE_CHARS = 200;

export function buildAiTuiSyncDigest(session: AiSession): string | undefined {
  const lastUser = lastUserTranscriptContent(session);
  if (lastUser === undefined) return undefined;
  const quote =
    lastUser.length > DIGEST_MAX_QUOTE_CHARS
      ? `${lastUser.slice(0, DIGEST_MAX_QUOTE_CHARS)}…`
      : lastUser;
  return (
    '[同步通知/Sync notice] 手机端在你离开时向此会话发送了新消息,AI 已回复完毕。' +
    `最新一条:『${quote}』。` +
    '本条仅为上下文同步通知,请勿重做任何任务,等待用户下一步指示。' +
    '(Context sync from the mobile client; do not redo anything — await the user.)'
  );
}

function lastUserTranscriptContent(session: AiSession): string | undefined {
  const transcript = session.transcript ?? [];
  for (let i = transcript.length - 1; i >= 0; i--) {
    const message = transcript[i];
    if (message.role === 'user' && !message.hiddenAt && message.content.trim()) {
      return message.content.trim();
    }
  }
  return undefined;
}
```

- [ ] **Step 4: 跑测试确认通过**(同 Step 2 命令,Expected: PASS)
- [ ] **Step 5: Commit**

```bash
git add server/src/modules/ai/tuiSyncDigest.ts server/test/modules/ai/tuiSync.test.ts
git commit -m "feat(server): TUI 同步 digest 构造纯函数"
```

---

### Task 2: server——payload 构造 + 下行 publish helper + ai.done 触发(TDD)

**Files:**
- Modify: `server/src/modules/ai/agentPublish.ts`(文件末尾追加两个导出)
- Modify: `server/src/modules/agent/handlers/aiRun.ts:682-724`(`if (message.type === 'ai.done')` 块末尾、`refreshAiSessionDetailFromAgent` 之后插入)
- Test: `server/test/modules/ai/tuiSync.test.ts`(追加 describe)

- [ ] **Step 1: 追加失败测试**(同文件)

```typescript
import { aiTuiSyncPayload } from '../../../src/modules/ai/agentPublish.js';

describe('aiTuiSyncPayload', () => {
  it('returns undefined without sourceSessionId or without a user message', () => {
    const noSource = { ...sessionWith([{ role: 'user', content: 'a' }]), sourceSessionId: undefined };
    expect(aiTuiSyncPayload(noSource as AiSession)).toBeUndefined();
    const noTranscript = { ...sessionWith([]) };
    expect(aiTuiSyncPayload(noTranscript)).toBeUndefined();
  });

  it('shapes the ai.tui.sync downlink payload', () => {
    const session = sessionWith([{ role: 'user', content: '帮我跑下测试' }]);
    (session as { projectPath?: string }).projectPath = '/repo';
    const payload = aiTuiSyncPayload(session)!;
    expect(payload.type).toBe('ai.tui.sync');
    expect(payload.session_id).toBe('ai_import_x');
    expect(payload.source_session_id).toBe('native-uuid');
    expect(payload.project_path).toBe('/repo');
    expect(String(payload.digest)).toContain('帮我跑下测试');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**(同 Task 1 命令)
- [ ] **Step 3: 实现**(agentPublish.ts 顶部 import 区加 `import { buildAiTuiSyncDigest } from './tuiSyncDigest.js';`,文件末尾追加):

```typescript
/** Payload for ai.tui.sync (spec 2026-09-23-tui-cross-session-sync): ask the
 * agent to inject a context-sync notice into the live CC TUI that owns the
 * native session. Undefined when the session has no native binding or no
 * usable user message — both make the notice pointless. */
export function aiTuiSyncPayload(
  session: AiSession,
): Record<string, unknown> | undefined {
  if (!session.sourceSessionId) return undefined;
  const digest = buildAiTuiSyncDigest(session);
  if (!digest) return undefined;
  return {
    type: 'ai.tui.sync',
    session_id: session.id,
    source_session_id: session.sourceSessionId,
    digest,
    project_path: session.projectPath,
  };
}

/** Best-effort downlink: the agent gates on TUI liveness/idle/capability and
 * may drop the notice. Never awaited from the ai.done hot path. */
export async function maybePublishAiTuiSync(session: AiSession): Promise<void> {
  const payload = aiTuiSyncPayload(session);
  if (!payload) return;
  await publishToAgent(session.deviceId, payload, {
    sessionId: session.id,
    userId: session.userId,
  });
}
```

- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 接线 aiRun.ts**——`aiRun.ts` 顶部 import 区加:

```typescript
import { maybePublishAiTuiSync } from '../../ai/agentPublish.js';
```

在 `if (message.type === 'ai.done') { ... }` 块内、`refreshAiSessionDetailFromAgent` 调用(:721-723)之后插入:

```typescript
          // Spec 2026-09-23 TUI cross-session sync: a phone-driven turn just
          // landed on a session bound to a native CLI id — ask the agent to
          // inject a context-sync notice into the live CC TUI. Best-effort;
          // agent-side gates (live/idle/capable/grew) may drop it silently.
          // Interrupted turns early-return above and intentionally never sync.
          void maybePublishAiTuiSync(session).catch((error: unknown) => {
            logger.warn('[ai-run] ai.tui.sync publish failed', {
              session_id: session.id,
              error: error instanceof Error ? error.message : String(error),
            });
          });
```

(`logger` 该文件已 import,:454 在用。)

- [ ] **Step 6: 全量验证**

```bash
npx tsc --noEmit -p server/tsconfig.json && npx vitest run server/test/modules/ai/
```

Expected: tsc 0;vitest 目标文件 PASS(全目录如有预存失败对照基线)。

- [ ] **Step 7: Commit**

```bash
git add server/src/modules/ai/agentPublish.ts server/src/modules/agent/handlers/aiRun.ts server/test/modules/ai/tuiSync.test.ts
git commit -m "feat(server): ai.done 后下发 ai.tui.sync 请求 agent 注入 TUI 同步通知"
```

---

### Task 3: agent——pid 记录扩读 messagingSocketPath + 按需读 peerToken(TDD)

**Files:**
- Modify: `app/http/services/agent_inventory.go:825-879`(struct + loader row)
- Create: `app/http/services/cc_peer_messaging.go`(本 Task 先只放 token/key 读取函数)
- Test: `app/http/services/cc_peer_messaging_test.go`

- [ ] **Step 1: 写失败测试**

```go
package services

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadClaudeRenameRecordsCarriesMessagingSocketPath(t *testing.T) {
	home := t.TempDir()
	dir := filepath.Join(home, ".claude", "sessions")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(name, body string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write("101.json", `{"sessionId":"s1","pid":101,"status":"idle","messagingSocketPath":"/tmp/cc-socks/101.sock"}`)
	write("102.json", `{"sessionId":"s2","pid":102,"status":"idle"}`)

	records := loadClaudeRenameRecords(home)
	if got := records["s1"].MessagingSocketPath; got != "/tmp/cc-socks/101.sock" {
		t.Fatalf("s1 socket path = %q, want /tmp/cc-socks/101.sock", got)
	}
	if got := records["s2"].MessagingSocketPath; got != "" {
		t.Fatalf("s2 socket path = %q, want empty (capability gate)", got)
	}
}

func TestLoadClaudePeerToken(t *testing.T) {
	home := t.TempDir()
	dir := filepath.Join(home, ".claude", "sessions")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "101.abc123.key"), []byte(`{"peerToken":"tok123","procStart":"x"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := loadClaudePeerToken(home, 101); got != "tok123" {
		t.Fatalf("token = %q, want tok123", got)
	}
	if got := loadClaudePeerToken(home, 999); got != "" {
		t.Fatalf("missing pid token = %q, want empty", got)
	}
	if got := loadClaudePeerToken("", 101); got != "" {
		t.Fatalf("empty home token = %q, want empty", got)
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/mac/MyProgram/GoProgram/nursor/alianggate && go test ./app/http/services/ -run 'TestLoadClaude' -v`
Expected: FAIL(struct 无该字段 / 函数未定义)

- [ ] **Step 3: 实现**——`agent_inventory.go` struct 与 loader:

```go
type agentRenamePidRecord struct {
	Name      string
	PID       int
	Status    string
	UpdatedAt time.Time
	// MessagingSocketPath is the cross-session messaging UDS socket written by
	// CC >= 2.1.224 (~/.claude/sessions/<pid>.json). Empty on older versions,
	// which is exactly the capability gate for the TUI sync injector.
	MessagingSocketPath string
}
```

loader 的 row struct 加一行 `MessagingSocketPath string \`json:"messagingSocketPath"\``,out 赋值处加 `MessagingSocketPath: strings.TrimSpace(row.MessagingSocketPath),`。

新建 `cc_peer_messaging.go`(本 Task 只含):

```go
package services

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// loadClaudePeerToken reads the peer auth token for a pid from
// ~/.claude/sessions/<pid>.<sha>.key (CC >= 2.1.224). Read on demand ONLY —
// never in the periodic scan. Missing/unreadable is not fatal: macOS/Linux
// accept token-less frames (spike-verified), so callers degrade gracefully.
func loadClaudePeerToken(home string, pid int) string {
	if home = strings.TrimSpace(home); home == "" || pid <= 0 {
		return ""
	}
	files, err := filepath.Glob(filepath.Join(home, ".claude", "sessions", strconv.Itoa(pid)+".*.key"))
	if err != nil || len(files) == 0 {
		return ""
	}
	raw, err := os.ReadFile(files[0])
	if err != nil {
		return ""
	}
	var row struct {
		PeerToken string `json:"peerToken"`
	}
	if err := json.Unmarshal(raw, &row); err != nil {
		return ""
	}
	return strings.TrimSpace(row.PeerToken)
}
```

- [ ] **Step 4: 跑测试确认通过**(同 Step 2 命令)
- [ ] **Step 5: 回归扫描全链路**——`go test ./app/http/services/ -run 'TestLoadClaude|TestClaude|TestRename|TestExternal' -v` 确认既有 rename/status/external 测试零回归。
- [ ] **Step 6: Commit**

```bash
git add app/http/services/agent_inventory.go app/http/services/cc_peer_messaging.go app/http/services/cc_peer_messaging_test.go
git commit -m "feat(agent): pid 记录扩读 messagingSocketPath+按需读 peerToken"
```

---

### Task 4: agent——UDS 注入客户端:帧构造+连接+回执解析(TDD)

**Files:**
- Modify: `app/http/services/cc_peer_messaging.go`(追加)
- Test: `app/http/services/cc_peer_messaging_test.go`(追加)

- [ ] **Step 1: 追加失败测试**——帧为纯函数;连接用真实 `net.Listen("unix", tmp)` 内存 socket 验证:

```go
func TestCcPeerFrames(t *testing.T) {
	auth := ccPeerAuthLine("tok")
	if !strings.Contains(auth, `"type":"auth"`) || !strings.Contains(auth, `"peerToken":"tok"`) {
		t.Fatalf("auth line malformed: %s", auth)
	}
	user := ccPeerUserLine("你好")
	if !strings.Contains(user, `"type":"user"`) || !strings.Contains(user, `"role":"user"`) ||
		!strings.Contains(user, `"msgV":1`) || !strings.Contains(user, `"priority":"next"`) ||
		!strings.Contains(user, "你好") {
		t.Fatalf("user line malformed: %s", user)
	}
	if strings.Contains(ccPeerUserLine("x"), "\n") {
		t.Fatal("frame must be a single line")
	}
	id2 := ccPeerUserLine("y")
	if strings.Contains(id2, `"msg_id":""`) {
		t.Fatal("msg_id must never be empty")
	}
}

// spike 实测(附录 A):普通送达在注入侧 socket 上零回执 → 注入为
// fire-and-forget,成功 = 帧写出,不需要任何回读。
func TestCcPeerInjectWritesFramesFireAndForget(t *testing.T) {
	dir := t.TempDir()
	sock := filepath.Join(dir, "inbox.sock")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	got := make(chan string, 1)
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		buf := make([]byte, 4096)
		n, _ := conn.Read(buf)
		got <- string(buf[:n])
		// 故意不回任何帧:普通送达本就零回执,注入端不得依赖回读。
	}()
	if err := ccPeerInject(sock, "tok", "hello digest"); err != nil {
		t.Fatal(err)
	}
	frames := <-got
	if !strings.Contains(frames, `"peerToken":"tok"`) || !strings.Contains(frames, "hello digest") {
		t.Fatalf("frames not written: %s", frames)
	}
}

func TestCcPeerInjectTokenlessOK(t *testing.T) {
	dir := t.TempDir()
	sock := filepath.Join(dir, "inbox.sock")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	got := make(chan string, 1)
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		buf := make([]byte, 4096)
		n, _ := conn.Read(buf)
		got <- string(buf[:n])
	}()
	if err := ccPeerInject(sock, "", "no-auth digest"); err != nil {
		t.Fatal(err)
	}
	frames := <-got
	if strings.Contains(frames, `"type":"auth"`) {
		t.Fatalf("empty token must omit the auth line, got: %s", frames)
	}
	if !strings.Contains(frames, "no-auth digest") {
		t.Fatalf("user frame missing: %s", frames)
	}
}

func TestCcPeerInjectDialFailure(t *testing.T) {
	if err := ccPeerInject(filepath.Join(t.TempDir(), "missing.sock"), "", "x"); err == nil {
		t.Fatal("expected dial error for missing socket")
	}
}
```

(测试文件 import 区补 `net`、`strings`、`testing`。)

- [ ] **Step 2: 跑测试确认失败**(同 Task 3 命令,-run 'TestCcPeer')
  spike 校准已完成(Task 0/附录 A):peerToken 字段名、零回执 fire-and-forget、msgV/msg_id 帧形态均已灌入本 Task 代码。
- [ ] **Step 3: 实现**(cc_peer_messaging.go 追加):

```go
// 本文件的 import 至此为(在 Task 3 基础上新增 bufio/crypto_rand/fmt/net/time;
// logger Task 5 才用,此处勿引入,否则 imported and not used):
import (
	"bufio"
	crand "crypto/rand"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// 帧形态经 Task 0 spike 实测校准(附录 A):auth 帧字段名是 peerToken(mac 实测可省);
// user 帧实测被接受的形态带 msgV/msg_id/priority。
type ccPeerAuthFrame struct {
	Type      string `json:"type"`
	PeerToken string `json:"peerToken"`
}

type ccPeerUserFrame struct {
	MsgV    int    `json:"msgV"`
	MsgID   string `json:"msg_id"`
	Type    string `json:"type"`
	Message struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	} `json:"message"`
	Priority string `json:"priority"`
}

// ccPeerMsgID mints a uuid4-shaped id for the user frame. Entropy failure
// falls back to a timestamp id — never fail the notice over id randomness.
func ccPeerMsgID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func ccPeerAuthLine(token string) string {
	b, _ := json.Marshal(ccPeerAuthFrame{Type: "auth", PeerToken: token})
	return string(b)
}

func ccPeerUserLine(content string) string {
	var f ccPeerUserFrame
	f.MsgV = 1
	f.MsgID = ccPeerMsgID()
	f.Type = "user"
	f.Message.Role = "user"
	f.Message.Content = content
	f.Priority = "next"
	b, _ := json.Marshal(f)
	return string(b)
}

// ccPeerInject dials the inbox UDS and writes the auth (when known) + user
// frames, fire-and-forget. Spike-verified (Task 0, 附录 A): a normal delivery
// produces NO receipt frame on the injecting socket, so there is nothing to
// read — success means the frames flushed. Non-delivery outcomes surface
// elsewhere: a busy TUI queues the message (delivered after its turn); a
// held/denied inbound gate shows its approval prompt inside the TUI itself.
func ccPeerInject(socketPath, token, digest string) error {
	conn, err := net.DialTimeout("unix", socketPath, 3*time.Second)
	if err != nil {
		return err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	w := bufio.NewWriter(conn)
	if token != "" {
		if _, err := w.WriteString(ccPeerAuthLine(token) + "\n"); err != nil {
			return err
		}
	}
	if _, err := w.WriteString(ccPeerUserLine(digest) + "\n"); err != nil {
		return err
	}
	return w.Flush()
}

// ccPeerSessionJSONL finds the newest transcript jsonl for a native session
// (same scan roots as the detail reader).
func ccPeerSessionJSONL(home, nativeSessionID string) string {
	if home = strings.TrimSpace(home); home == "" || strings.TrimSpace(nativeSessionID) == "" {
		return ""
	}
	files := findRecentAgentFiles(filepath.Join(home, ".claude", "projects"), nativeSessionID+".jsonl", 1)
	if len(files) == 0 {
		return ""
	}
	return files[0]
}

// claudePeerKeyModTime proxies the TUI process start: CC writes the .key file
// once at startup. Zero when unknown (gate then relies on the baseline only).
func claudePeerKeyModTime(home string, pid int) time.Time {
	if home = strings.TrimSpace(home); home == "" || pid <= 0 {
		return time.Time{}
	}
	files, err := filepath.Glob(filepath.Join(home, ".claude", "sessions", strconv.Itoa(pid)+".*.key"))
	if err != nil || len(files) == 0 {
		return time.Time{}
	}
	if info, err := os.Stat(files[0]); err == nil {
		return info.ModTime()
	}
	return time.Time{}
}
```

> 有意的偏离(相对 spec §5):spec 提到 `_unix`/`_other` build-tag 文件;本计划改为**运行时门**(`SocketPath` 必须以 `/` 开头,Windows named pipe 天然被拒)——结果等价(Windows 不支持)、少两个平台文件、测试面更小。若实施时认为 build-tag 更贴仓库惯例,可等价替换,验收不变。

- [ ] **Step 4: 跑测试确认通过**(-run 'TestCcPeer')
- [ ] **Step 5: Commit**

```bash
git add app/http/services/cc_peer_messaging.go app/http/services/cc_peer_messaging_test.go
git commit -m "feat(agent): CC peer messaging UDS 注入客户端(帧/连接/回执)"
```

---

### Task 5: agent——门控纯函数 + 60s 合并 + tuiSync handler + 路由注册(TDD)

**Files:**
- Modify: `app/http/services/cc_peer_messaging.go`(追加 gate/coalesce/handler)
- Modify: `app/http/models/agent_protocol.go:53` 附近(常量)+ `:254` 附近(协议注册表条目)
- Modify: `app/http/services/agent_remote_ws.go:635` 与 `:674-678`(路由)
- Test: `app/http/services/cc_peer_messaging_test.go`(追加)

- [ ] **Step 1: 追加失败测试**

```go
func TestCcPeerSyncShouldInject(t *testing.T) {
	now := time.Now()
	base := ccPeerSyncGateInput{
		RecordLive: true, RecordStatus: "idle", SocketPath: "/tmp/cc-socks/1.sock",
		JSONLSize: 100, JSONLModTime: now, TUIStartProxy: now.Add(-time.Hour),
	}
	if !ccPeerSyncShouldInject(base) {
		t.Fatal("happy path should inject")
	}
	dead := base
	dead.RecordLive = false
	if ccPeerSyncShouldInject(dead) {
		t.Fatal("dead TUI must not inject")
	}
	busy := base
	busy.RecordStatus = "busy"
	if ccPeerSyncShouldInject(busy) {
		t.Fatal("busy TUI must not inject (skip, not interrupt)")
	}
	incapable := base
	incapable.SocketPath = ""
	if ccPeerSyncShouldInject(incapable) {
		t.Fatal("old CC (no socket path) must not inject")
	}
	windowsPipe := base
	windowsPipe.SocketPath = `\\.\pipe\cc-inbox`
	if ccPeerSyncShouldInject(windowsPipe) {
		t.Fatal("non-unix socket path (v1 scope) must not inject")
	}
	stale := base
	stale.JSONLModTime = now.Add(-2 * time.Hour) // TUI opened after last write
	if ccPeerSyncShouldInject(stale) {
		t.Fatal("jsonl older than TUI start: TUI already loaded it, must not inject")
	}
	noGrowth := base
	noGrowth.BaselineKnown = true
	noGrowth.BaselineSize = 100
	if ccPeerSyncShouldInject(noGrowth) {
		t.Fatal("no growth since last injection must not re-inject")
	}
}

func TestCcPeerTuiSyncCoalesces(t *testing.T) {
	origWindow := ccPeerSyncCoalesceWindow
	origDial := ccPeerDialInject
	// liveClaudeTUIRecord 要求 pid 活着且 ps 身份含 claude。用本测试进程自己的
	// pid(必然存活)+ stub 身份匹配器(先例:agent_external_interrupt_test.go
	// 对同款 package var 的替换+恢复写法),否则 gate 永远 drop、测试永远红。
	origMatches := externalInterruptTargetMatches
	externalInterruptTargetMatches = func(int) bool { return true }
	defer func() {
		ccPeerSyncCoalesceWindow = origWindow
		ccPeerDialInject = origDial
		externalInterruptTargetMatches = origMatches
	}()
	ccPeerSyncCoalesceWindow = 30 * time.Millisecond
	pid := os.Getpid()

	home := t.TempDir()
	dir := filepath.Join(home, ".claude", "sessions")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	record := fmt.Sprintf(`{"sessionId":"snat","pid":%d,"status":"idle","messagingSocketPath":"%s"}`, pid, filepath.Join(t.TempDir(), "noop.sock"))
	if err := os.WriteFile(filepath.Join(dir, strconv.Itoa(pid)+".json"), []byte(record), 0o600); err != nil {
		t.Fatal(err)
	}
	var calls int
	var lastDigest string
	var mu sync.Mutex
	ccPeerDialInject = func(_ string, _, digest string) error {
		mu.Lock()
		calls++
		lastDigest = digest
		mu.Unlock()
		return nil
	}
	// jsonl 必须真实存在且 mtime 晚于 TUI 启动代理(.key mtime;此处无 .key →
	// 零值,该门放行),size 基线未知(baseline unknown)→ 门放行。
	proj := filepath.Join(home, ".claude", "projects", "p")
	if err := os.MkdirAll(proj, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(proj, "snat.jsonl"), []byte(`{}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(filepath.Join(proj, "snat.jsonl"), time.Now(), time.Now()); err != nil {
		t.Fatal(err)
	}

	m := &agentAIManager{}
	m.tuiSync(map[string]interface{}{"session_id": "s", "source_session_id": "snat", "digest": "first"}, nil)
	m.tuiSync(map[string]interface{}{"session_id": "s", "source_session_id": "snat", "digest": "second"}, nil)
	time.Sleep(120 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if calls != 1 {
		t.Fatalf("inject calls = %d, want 1 (coalesced)", calls)
	}
	if lastDigest != "second" {
		t.Fatalf("digest = %q, want newest %q", lastDigest, "second")
	}
}
```

(import 区补 `fmt`、`sync`、`time`、`strconv`,以及 `aliang.one/nursorgate/common/logger`——handler 的日志在本 Task 落地,Task 4 时该 import 尚不存在。)

- [ ] **Step 2: 跑测试确认失败**(-run 'TestCcPeerSync')

Run: `go test ./app/http/services/ -run 'TestCcPeerSync' -v`

- [ ] **Step 3: 实现**(cc_peer_messaging.go 追加;import 此时补齐 `fmt`、`sync`、`aliang.one/nursorgate/common/logger`——handler/门控日志在此落地):

```go
// TUI sync coalescing (spec §3): repeated ai.tui.sync for the same native
// session inside the window collapse into ONE injection, newest digest wins.
// Injection fires ccPeerSyncCoalesceWindow after the FIRST sync of a burst,
// so the injected summary covers what landed during the window.
var ccPeerSyncCoalesceWindow = 60 * time.Second

const ccPeerSyncPendingCap = 256

// ccPeerDialInject is swapped in tests to capture frames / control outcomes.
var ccPeerDialInject = ccPeerInject

type ccPeerSyncPending struct {
	digest string
	timer  *time.Timer
}

var (
	ccPeerSyncMu      sync.Mutex
	ccPeerSyncPending = map[string]*ccPeerSyncPending{}
	// ccPeerSyncBaseline: jsonl size at the last successful injection per
	// native session; absent = unknown (agent restart) → gate injects.
	ccPeerSyncBaseline = map[string]int64{}
)

type ccPeerSyncGateInput struct {
	RecordLive    bool
	RecordStatus  string
	SocketPath    string
	BaselineSize  int64
	BaselineKnown bool
	JSONLSize     int64
	JSONLModTime  time.Time
	TUIStartProxy time.Time
}

// ccPeerSyncShouldInject is the pure gate (spec §4). All four spec gates:
// ① live TUI record ② idle (busy → skip, NEVER interrupt) ③ socket capability
// (messagingSocketPath present and unix-style — Windows named pipe is v2) plus
// ④ transcript-moved evidence: jsonl written after the TUI started (key-file
// mtime proxy; handles "TUI opened after the phone turn" — it already loaded
// the history) and grown since our last successful injection (baseline unknown
// after agent restart → inject; worst case one redundant notice).
func ccPeerSyncShouldInject(in ccPeerSyncGateInput) bool {
	if !in.RecordLive {
		return false
	}
	if !strings.EqualFold(strings.TrimSpace(in.RecordStatus), "idle") {
		return false
	}
	if strings.TrimSpace(in.SocketPath) == "" || !strings.HasPrefix(in.SocketPath, "/") {
		return false
	}
	if in.JSONLSize <= 0 {
		return false
	}
	if !in.TUIStartProxy.IsZero() && in.JSONLModTime.Before(in.TUIStartProxy) {
		return false
	}
	if in.BaselineKnown && in.JSONLSize <= in.BaselineSize {
		return false
	}
	return true
}

// ccPeerSyncFire runs after the coalesce window: gate, inject, log. No reply
// is written anywhere — the contract is best-effort with agent-log evidence.
func ccPeerSyncFire(home, nativeSessionID string) {
	ccPeerSyncMu.Lock()
	pending := ccPeerSyncPending[nativeSessionID]
	delete(ccPeerSyncPending, nativeSessionID)
	baseline, baselineKnown := ccPeerSyncBaseline[nativeSessionID]
	ccPeerSyncMu.Unlock()
	if pending == nil || strings.TrimSpace(pending.digest) == "" {
		return
	}
	record, live := liveClaudeTUIRecord(home, nativeSessionID)
	socketPath, tuiStart := "", time.Time{}
	if live {
		socketPath = record.MessagingSocketPath
		tuiStart = claudePeerKeyModTime(home, record.PID)
	}
	size, mod := int64(0), time.Time{}
	if jsonl := ccPeerSessionJSONL(home, nativeSessionID); jsonl != "" {
		if info, err := os.Stat(jsonl); err == nil {
			size, mod = info.Size(), info.ModTime()
		}
	}
	if !ccPeerSyncShouldInject(ccPeerSyncGateInput{
		RecordLive: live, RecordStatus: record.Status, SocketPath: socketPath,
		BaselineSize: baseline, BaselineKnown: baselineKnown,
		JSONLSize: size, JSONLModTime: mod, TUIStartProxy: tuiStart,
	}) {
		logger.Info(fmt.Sprintf("ai.tui.sync: gate dropped home=%q native=%s live=%v status=%q socket=%q", home, nativeSessionID, live, strings.TrimSpace(record.Status), socketPath))
		return
	}
	if err := ccPeerDialInject(socketPath, loadClaudePeerToken(home, record.PID), pending.digest); err != nil {
		logger.Info(fmt.Sprintf("ai.tui.sync: inject failed home=%q native=%s error=%v", home, nativeSessionID, err))
		return
	}
	ccPeerSyncMu.Lock()
	ccPeerSyncBaseline[nativeSessionID] = size
	ccPeerSyncMu.Unlock()
	logger.Info(fmt.Sprintf("ai.tui.sync: frames written home=%q native=%s bytes=%d (no receipt by design, see 附录 A)", home, nativeSessionID, size))
}

// tuiSync handles ai.tui.sync (server → agent, best-effort, no reply).
func (m *agentAIManager) tuiSync(msg map[string]interface{}, _ agentTerminalWriter) {
	sourceSessionID := strings.TrimSpace(remoteString(msg, "source_session_id"))
	digest := strings.TrimSpace(remoteString(msg, "digest"))
	if sourceSessionID == "" || digest == "" {
		return
	}
	home := externalTUIHome()
	ccPeerSyncMu.Lock()
	defer ccPeerSyncMu.Unlock()
	if pending := ccPeerSyncPending[sourceSessionID]; pending != nil {
		pending.digest = digest // coalesce: newest wins
		return
	}
	if len(ccPeerSyncPending) >= ccPeerSyncPendingCap {
		logger.Info("ai.tui.sync: pending cap reached, dropping")
		return
	}
	entry := &ccPeerSyncPending{digest: digest}
	entry.timer = time.AfterFunc(ccPeerSyncCoalesceWindow, func() { ccPeerSyncFire(home, sourceSessionID) })
	ccPeerSyncPending[sourceSessionID] = entry
}
```

**协议常量**(`agent_protocol.go:53` 旁):

```go
AgentEventAITuiSync               = "ai.tui.sync"
```

**协议注册表**(`:254` 旁,保持结构体字面量风格一致):

```go
{Type: AgentEventAITuiSync, Required: []string{"type", "session_id", "source_session_id", "digest"}, Optional: []string{"project_path"}, Emits: nil},
```

**路由**(`agent_remote_ws.go`):外层 case 列表(:635)追加 `models.AgentEventAITuiSync`;内层 switch(:674-678)追加:

```go
		case models.AgentEventAITuiSync:
			s.ai.tuiSync(msg, writeJSON)
```

(不加 aiControlEnabled 门——与 ai.stop 同理,非 AI 控制类。)

- [ ] **Step 4: 跑测试确认通过**:`go test ./app/http/services/ -run 'TestCcPeer' -v` 全 PASS
- [ ] **Step 5: 全包回归 + 三件套**

```bash
gofmt -l app/ && go vet ./app/... && go test ./app/http/services/ && CGO_ENABLED=1 go build ./...
```

Expected: gofmt 空、vet 0、services 全绿、build 成功。

- [ ] **Step 6: Commit**

```bash
git add app/http/services/cc_peer_messaging.go app/http/services/cc_peer_messaging_test.go app/http/models/agent_protocol.go app/http/services/agent_remote_ws.go
git commit -m "feat(agent): ai.tui.sync 合并门控+UDS 注入 TUI 同步通知"
```

---

### Task 6: phone——横幅文案如实改写 + 资源测试(TDD)

**Files:**
- Modify: `src/i18n/locales/vibecoding/zh.json:466`、`src/i18n/locales/vibecoding/en.json:466`
- Test: `__tests__/tuiSharedNotice.test.ts`

- [ ] **Step 1: 改测试(先红)**——断言新文案语义:

```typescript
describe('tuiSharedNotice i18n resources', () => {
  it.each([
    ['en', en],
    ['zh', zh],
  ])('%s locale carries non-empty notice + dismiss copy', (_loc, res) => {
    const session = (res as unknown as { session: Record<string, string> }).session;
    expect(typeof session.tuiSharedNotice).toBe('string');
    expect(session.tuiSharedNotice.length).toBeGreaterThan(10);
    expect(typeof session.tuiSharedNoticeDismiss).toBe('string');
    expect(session.tuiSharedNoticeDismiss.length).toBeGreaterThan(0);
  });

  it('zh copy states auto-sync AND the busy-skip truth (no deferred-until-idle promise)', () => {
    const session = (zh as unknown as { session: Record<string, string> }).session;
    expect(session.tuiSharedNotice).toContain('自动同步');
    expect(session.tuiSharedNotice).toContain('不补发');
    expect(session.tuiSharedNotice).not.toContain('延迟到空闲');
  });

  it('en copy matches the same contract', () => {
    const session = (en as unknown as { session: Record<string, string> }).session;
    expect(session.tuiSharedNotice).toContain('automatically synced');
    expect(session.tuiSharedNotice).toContain('skipped');
    expect(session.tuiSharedNotice).not.toMatch(/will (be )?retried|retry when|later when idle|deferred until/i);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd <phone worktree> && npx jest __tests__/tuiSharedNotice.test.ts`

- [ ] **Step 3: 改两处文案**

zh.json `tuiSharedNotice`:
```
"该对话与桌面终端(TUI)共用:手机上的对话会自动同步进开着此会话的空闲终端;终端忙时本轮不注入、不补发。"
```

en.json `tuiSharedNotice`:
```
"Shared with a terminal TUI — messages sent from the phone are automatically synced into an idle terminal running this session. While the terminal is busy, the notice is skipped (not retried)."
```

- [ ] **Step 4: 跑测试确认通过** + `npx tsc --noEmit`
- [ ] **Step 5: Commit**

```bash
git add src/i18n/locales/vibecoding/zh.json src/i18n/locales/vibecoding/en.json __tests__/tuiSharedNotice.test.ts
git commit -m "feat(phone): TUI 共享横幅文案改为自动同步语义(含 busy 跳过如实说明)"
```

---

### Task 7: 跨仓验证 + 合并回主分支

- [ ] **Step 1: 各仓全量门**

```bash
# server worktree
npx tsc --noEmit -p server/tsconfig.json && npx vitest run   # 预存失败仅 issuePikoTunnelTicket
# agent worktree
gofmt -l app/ && go vet ./app/... && go test ./app/http/services/ && CGO_ENABLED=1 go build ./...
# phone worktree
npx tsc --noEmit && npx jest __tests__/tuiSharedNotice.test.ts
```

- [ ] **Step 2: 合并**(server→main、agent→master、phone→main,`git merge --ff-only` 优先,不行则普通 merge);phone 仓把 spec+plan 两个 docs 文件一并 commit 进分支再合并。
- [ ] **Step 3: 汇报**——三仓 merge 后 commit hash 记录下来;**不 push**(部署另行决策)。

---

### Task 8: 端到端手工验收(部署后;验收标准见 spec §10)

- [ ] 终端开一个 CC TUI 于项目 A,手机对同一共享会话发一条消息;
- [ ] ≤90s 内(回合+60s 合并窗)TUI 出现同步通知,内容含手机消息摘要与「请勿重做」护栏;
- [ ] 在 TUI 里追问「刚才手机端说了什么」——模型能复述(上下文已同步);
- [ ] TUI mid-turn 时手机发消息:回合正常完成、无注入、TUI 不被打断;
- [ ] 退出 TUI 后手机发消息:无报错(agent 侧 gate 日志 drop);
- [ ] 旧版 CC(无 messagingSocketPath)设备:行为与改动前完全一致。

---

## 附录 A:Spike 结论回填区(Task 0 实测,2026-09-23,claude 2.1.280 / darwin)

> 方法备注:本机无 tmux(2006 版 screen 的 `-X` 亦坏),改用 python3 pty 驱动起隔离 TUI(/tmp/cc-spike,cwd 精确匹配 `45416.json`);观察用最小 VT100 重放器。**重跑注意:子进程环境必须清掉全部 `CLAUDE*` 变量**(尤其 `CLAUDE_CODE_MESSAGING_SOCKET`/`CLAUDE_CODE_CHILD_SESSION`),否则 TUI 按嵌套 child 处理、抑制 discovery json 落盘。共 7 次注入,全部只对自建测试 TUI 的 socket,用户其余会话未触碰。

① **auth 行是否必需(mac):不需要。** 不发 auth 行,纯 user 帧照常送达并自动开 turn(连续 5 次验证)。二进制证据:auth 帧真实字段名是 **`peerToken`**(32-hex,zod schema `H`),**不是**计划假设的 `token`;错误 token 是否被拒未测。建议生产代码仍发 auth 行(字段名改正),作前向兼容。

② **空闲自动 turn 延迟:≈0.3–1s。** 注入(inject 开始 1790169976.17)→ TUI 出现新 turn(UserPromptSubmit hook @0s,首条日志 1790169976.49)。整 turn 时长:OK-1 12s(冷 cache,thinking 11s)、OK-2 7s。

③ **inbound gate 默认行为:分两类。**
- 纯文本回复类注入:**无审批**,直接自动跑完;
- 触发工具(如 bash)的注入:manual mode 下弹权限框,turn **hold**(discovery json status 变 `waiting`),用户批准后继续。TUI 自动给注入消息加"Another Claude session sent a message"护栏 preamble(防权限提升声明)。
- busy 中注入:**不打断当前回合**,排队显示在 composer 区,当前回合结束后**自动开新 turn**(与用户排队输入同语义)。工具调用间不插队。

④ **回执帧原文:外部 listener 无法捕获(live 零回执)。** 7 次注入中,带 `from`(自建 /tmp/cc-socks/99999.sock listener)与不带的、delivered 与 gate-held 场景,listener 均零连接零帧——回执寻址疑似要求对端是已注册 CC 会话身份(裸 socket 被静默忽略,模型回复原文佐证:"the ping had no identifiable `from` address")。**权威帧结构改取自 cli 二进制内嵌 JS(收发两侧一致)**:
```json
{"type":"control","action":"peer_message_status","status":"held|denied|expired|delivered|refused|dropped","reason":"...","from":"<发送方地址>","orig_msg_id":"<入帧msg_id,字符串时才有>","status_detail":"refused(仅 expired+refused 时)","drop_reason":"...","dropped_msg_ids":[...]}
```
status 全集 {held,denied,expired,delivered,refused,dropped};`expired`+`status_detail:"refused"` 按 refused 处理;**普通送达不产生任何回执帧**(delivered 只在 wasHeld 相关路径出现)。注入侧 user 帧实测可用形态:
```json
{"msgV":1,"msg_id":"<uuid4>","type":"user","message":{"role":"user","content":"Reply with exactly OK-1"},"priority":"next"}
```
`from` 可省(送达不受影响,只是无法收到回执/无法被回信)。

⑤ **单次注入 token 量级(transcript usage 实测):** 热 cache 下一次极短注入 turn ≈ **200–1,000 fresh input + 15–250 output tokens**(OK-2: 216 in+87.9k cache_read/14 out;OK-3: 805 in+95.5k cache_read/239 out);冷启动首轮 76k fresh input 属会话初始化非注入成本。/cost 全程(4 注入 turn+1 计数任务):$0.65,85.3k input/1.3k output/378.2k cache read,prompt cache 82% 命中(5m TTL)。

**对 Task 4/5 代码的修正要求(回执帧结构与计划假设对照):**
1. **auth 字段名**:`ccPeerAuthLine`/`TestCcPeerFrames` 里的 `"token":"tok"` 改为 **`"peerToken":"tok"`**;建议追加"可整体省略 auth 行"的开关(mac 实测非必需)。
2. **送达判定不能依赖回执**:Task 5 `TestCcPeerInjectWritesFramesAndReadsStatus` 假设 TUI 在同一连接回 `{"...","status":"delivered"}` ——实测同连接永远零回执。`ccPeerInject` 应改为 **fire-and-forget**(写完两行即成功),送达验证改读 discovery json 的 `status` 字段(实测 idle/busy/waiting 三态 ≤1s 实时刷新;注入后 status 从 idle 翻 busy 即为"已被消费")。
3. `ccPeerStatusFromFrame` 探测 struct 方向正确,但 status 枚举应含全部 6 态,并处理 `status_detail:"refused"`(expired 特例);其余可选字段(reason/from/orig_msg_id/drop_reason/dropped_msg_ids)解析时容忍缺省。

## 附录 B:部署序(合并后,另行决策)

server 先(旧 agent 忽略未知命令,无害)→ agent CGO 重编换装(install 不触发重启须显式 restart,build 带 ldflags 版本注入)→ phone 文案随下次 APK。与现有未部署批次(tui-stop/横幅等)同车。
