# 终端 AI 建议命令行（语音直通悬浮钮 + 多条建议契约 + 键盘开关）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 终端底部改为 AI 建议命令行——右侧常驻悬浮语音钮（点按=录音→STT→直通生成→1~3 条建议 chips，长按=可编辑文本输入），server 返回多条建议（JSON 契约+回退），"KB" 改为键盘图标切换键盘。

**Architecture:** 跨两仓。Server（AliangPhoneServer）扩展现有 commandGen：SKILL.md 输出契约改 JSON 数组、orchestrator 解析回退、GenResult 加法字段。Phone（AliangVibeCodingPhone）新增 1 个逻辑 hook + 3 个表现组件，`DeviceTerminalScreen` 底部控制区重构；`VoiceToBashModal` 的 live 入口移除（initial 模式保留）。Go agent **零改动**。

**Tech Stack:** Phone: React Native + zustand + react-test-renderer（jest，i18n 钉中文）。Server: Express + vitest。规格：`docs/superpowers/specs/2026-09-21-terminal-ai-suggest-bar-design.md`（已批准）。

**仓库/路径约定（全程使用）:**

```
P=<手机 worktree>  /Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangVibeCodingPhone/.worktrees/terminal-voice-suggest-bar   (分支 feat/terminal-voice-suggest-bar，已建，spec 已提交)
S=<server worktree> /Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangPhoneServer-ai-suggest-bar                            (分支 feat/commandgen-multi-suggestions，Task 0 建)
```

**关键仓库事实（执行前必读）:**

1. **jest 在 worktree 里必须 pattern 在前 + 显式 ignore override**（`jest.config.js` 的 `testPathIgnorePatterns` 含 `\.worktrees`，不 override 会"0 tests"）：
   - 定向：`npx jest <pattern> --testPathIgnorePatterns="/node_modules/"`
   - 全量：`npx jest --testPathIgnorePatterns="/node_modules/"`
   - `npx jest` 裸跑会静默匹配零测试——这不是通过！
2. **jest.setup.js 把 i18n 钉在中文**：组件测试断言**中文字符串**。
3. **测试范式**：`react-test-renderer` + `act`，外包 `ThemeContext.Provider(utilityMinimalist)` + `SafeAreaProvider(390x844)`（见 `__tests__/DeviceTerminal.voiceFab.test.tsx` 既有写法）；Animated.loop 组件必须 `jest.useFakeTimers()` 且 afterEach unmount（OOM 防线）。
4. **worktree 无 node_modules**：Task 0 建软链。既有 worktree 范式：`node_modules -> 主仓 node_modules`。
5. **TDD**：每任务先写失败测试→跑红→实现→跑绿→中文 commit message。技能参考：@superpowers:test-driven-development。

---

## Task 0: 环境准备 + 基线

**Files:** 无代码文件（软链 + 基线记录）。

- [ ] **Step 0.1: phone worktree 补 node_modules 软链**

```bash
cd /Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangVibeCodingPhone/.worktrees/terminal-voice-suggest-bar
ln -s ../../node_modules node_modules
ls -la node_modules/ | head -3   # 应列出包目录
```

- [ ] **Step 0.2: 建 server worktree（兄弟目录约定，照 `-cosdl`/`-fix-system`）**

```bash
cd /Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangPhoneServer
git worktree add ../AliangPhoneServer-ai-suggest-bar -b feat/commandgen-multi-suggestions main
cd ../AliangPhoneServer-ai-suggest-bar
ln -s ../AliangPhoneServer/node_modules node_modules   # ⚠ 必须指向 server 仓的 node_modules（../node_modules 是 vibe_on_phone/ 的，里面没有依赖）
node -e "require('vitest/package.json'); console.log('deps-OK')"
git status -sb   # 应显示 ## feat/commandgen-multi-suggestions
```

- [ ] **Step 0.3: 记录两仓测试基线（改码前）**

```bash
cd "$P" && npx jest --testPathIgnorePatterns="/node_modules/" 2>&1 | tail -15
cd "$S" && npm run test:server 2>&1 | tail -8
```

预期：phone 全量应基本绿（历史基线 ~3 个 terminal flake——**记下当前具体失败清单**，后续回归以「不新增失败」为标准）。server 侧有**已知预存失败** `issuePikoTunnelTicket`（main 上长期存在，见项目记忆 tunnel-tickets-test-preexisting-failure）——不算回归，除此之外应全绿；若出现**其他**意外失败先停下来报告，不要带病开工。

---

# Part 1 — Server（多建议契约）

## Task 1: `parseFinalCommands` 纯函数（TDD）

**Files:**
- Modify: `server/src/commandGen/orchestrator.ts`（文件顶部区域加函数）
- Test: `server/test/commandGen/parseFinalCommands.test.ts`（新建）

- [ ] **Step 1.1: 写失败测试**

```ts
// server/test/commandGen/parseFinalCommands.test.ts
import { describe, it, expect } from 'vitest';
import { parseFinalCommands } from '../../src/commandGen/orchestrator';

describe('parseFinalCommands', () => {
  it('parses a JSON object with a single command', () => {
    expect(parseFinalCommands('{"commands": ["git status --short"]}')).toEqual([
      'git status --short',
    ]);
  });

  it('parses 2-3 commands preserving order', () => {
    expect(
      parseFinalCommands(
        '{"commands": ["git status --short", "git diff --stat", "git log --oneline -5"]}',
      ),
    ).toEqual(['git status --short', 'git diff --stat', 'git log --oneline -5']);
  });

  it('caps at 3 commands', () => {
    expect(
      parseFinalCommands('{"commands": ["a", "b", "c", "d", "e"]}'),
    ).toEqual(['a', 'b', 'c']);
  });

  it('trims entries and drops empty / non-string entries', () => {
    expect(
      parseFinalCommands('{"commands": ["  ls -la  ", "", 42, null, "pwd"]}'),
    ).toEqual(['ls -la', 'pwd']);
  });

  it('strips one wrapping code fence before parsing', () => {
    expect(parseFinalCommands('```json\n{"commands": ["pwd"]}\n```')).toEqual(['pwd']);
    expect(parseFinalCommands('```\n{"commands": ["pwd"]}\n```')).toEqual(['pwd']);
  });

  it('falls back to the whole trimmed text as ONE command when not JSON', () => {
    expect(parseFinalCommands('git status --short')).toEqual(['git status --short']);
  });

  it('falls back when JSON lacks a commands array', () => {
    expect(parseFinalCommands('{"cmd": ["pwd"]}')).toEqual(['{"cmd": ["pwd"]}']);
  });

  it('falls back when commands is empty or all-empty', () => {
    expect(parseFinalCommands('{"commands": []}')).toEqual(['{"commands": []}']);
    expect(parseFinalCommands('{"commands": ["", "   "]}')).toEqual([
      '{"commands": ["", "   "]}',
    ]);
  });

  it('returns [] for empty input (caller substitutes its echo fallback)', () => {
    expect(parseFinalCommands('   ')).toEqual([]);
  });
});
```

- [ ] **Step 1.2: 跑红**

```bash
cd "$S" && npx vitest run test/commandGen/parseFinalCommands.test.ts
```
预期：FAIL（`parseFinalCommands` 未导出）。

- [ ] **Step 1.3: 实现**——在 `server/src/commandGen/orchestrator.ts` 的 `applyDialectGuard` 函数之后加：

```ts
export const MAX_SUGGESTED_COMMANDS = 3;

/**
 * Parse the LLM final message into up to 3 candidate shell commands.
 * Preferred contract (SKILL.md): {"commands": ["cmd1", "cmd2"]}. ANY failure —
 * non-JSON output, missing/non-array commands, zero usable entries — degrades
 * to treating the whole trimmed text as ONE raw command, so older/looser
 * models can't break the flow. Empty input yields [] (the caller substitutes
 * its echo fallback).
 */
export function parseFinalCommands(rawText: string): string[] {
  let text = rawText.trim();
  if (!text) return [];
  const fenced = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n?\s*```$/);
  if (fenced) text = fenced[1].trim();
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as { commands?: unknown };
      if (Array.isArray(parsed.commands)) {
        const commands = parsed.commands
          .filter((c): c is string => typeof c === 'string')
          .map(c => c.trim())
          .filter(c => c.length > 0)
          .slice(0, MAX_SUGGESTED_COMMANDS);
        if (commands.length > 0) return commands;
      }
    } catch {
      // fall through: treat as a single raw command
    }
  }
  return [text];
}
```

- [ ] **Step 1.4: 跑绿**

```bash
cd "$S" && npx vitest run test/commandGen/parseFinalCommands.test.ts
```
预期：9 PASS。

- [ ] **Step 1.5: Commit**

```bash
cd "$S" && git add server/src/commandGen/orchestrator.ts server/test/commandGen/parseFinalCommands.test.ts
git commit -m "feat(commandGen): parseFinalCommands 解析 1-3 条建议命令,非 JSON 回退单条"
```

## Task 2: orchestrator 返回多条建议（TDD）

**Files:**
- Modify: `server/src/commandGen/orchestrator.ts`（GenResult 类型 + 两个收敛分支）
- Modify: `server/src/commandGen/events.ts`（runFinished 变体加可选字段——**放在本任务**，否则 Task 2 与 Task 3 之间仓库过不了 tsc）
- Test: `server/test/commandGen/orchestrator.test.ts`（追加 describe）

- [ ] **Step 2.1: 写失败测试**——在 `orchestrator.test.ts` 末尾追加（复用文件里既有 `baseInput()` 工厂）：

```ts
describe('multi-suggestion results', () => {
  it('returns multiple commands from a JSON final, command = first', async () => {
    (callLlm as any).mockResolvedValueOnce({
      kind: 'final',
      text: '{"commands": ["git status --short", "git diff --stat"]}',
    });
    const r = await generateCommand(baseInput());
    expect(r.commands).toEqual(['git status --short', 'git diff --stat']);
    expect(r.command).toBe('git status --short');
    expect(r.dangerous).toBe(false);
    expect(r.dangerousFlags).toEqual([false, false]);
  });

  it('maps a plain-text final to a single-command result (back-compat)', async () => {
    (callLlm as any).mockResolvedValueOnce({ kind: 'final', text: 'git status --short' });
    const r = await generateCommand(baseInput());
    expect(r.commands).toEqual(['git status --short']);
    expect(r.dangerousFlags).toEqual([false]);
  });

  it('flags each command individually and aggregates dangerous', async () => {
    // ⚠ 先确认 tools.ts 的 isDangerousCommand 确实命中该样例（读 server/src/commandGen/tools.ts
    //   的 DANGEROUS 正则，按需换成它必中的破坏性样例，如 sudo rm / shutdown 类）。
    (callLlm as any).mockResolvedValueOnce({
      kind: 'final',
      text: '{"commands": ["git status --short", "rm -rf /tmp/vibe-test"]}',
    });
    const r = await generateCommand(baseInput());
    expect(r.dangerousFlags).toEqual([false, true]);
    expect(r.dangerous).toBe(true);
  });

  it('applies the dialect guard per command', async () => {
    (callLlm as any).mockResolvedValueOnce({
      kind: 'final',
      text: '{"commands": ["ls -la", "dir"]}',
    });
    // ⚠ 必须给 shell —— validateCommandDialect(text, undefined) 是 no-op（family 'unknown'），
    //   不给 shell 断言永远不会触发降级（与既有 dialect 用例同款写法）。
    const r = await generateCommand(baseInput({ os: 'win32', shell: 'cmd.exe', mode: 'live', sessionId: 's1' }));
    // bash-isms 在 cmd 目标上被降级为 echo 提示；dir 是合法 cmd 命令原样保留。
    expect(r.commands[0]).toContain('dialect mismatch');
    expect(r.commands[1]).toBe('dir');
  });

  it('non-converged fallback also yields a commands array', async () => {
    (callLlm as any)
      .mockResolvedValue({ kind: 'tool_calls', calls: [{ id: 'c', name: 'env_info', args: {} }] });
    (requestAgentPayload as any).mockResolvedValue({ os: 'darwin' });
    const r = await generateCommand(baseInput({ maxToolCalls: 1, timeoutMs: 25000 }));
    expect(Array.isArray(r.commands)).toBe(true);
    expect(r.commands.length).toBeGreaterThanOrEqual(1);
    expect(r.command).toBe(r.commands[0]);
  });
});
```

- [ ] **Step 2.2: 跑红**

```bash
cd "$S" && npx vitest run test/commandGen/orchestrator.test.ts
```
预期：新 describe 的用例 FAIL（响应缺 `commands`/`dangerousFlags`）。

- [ ] **Step 2.3: 实现**——`orchestrator.ts`：

① GenResult 类型替换为：

```ts
export type GenResult = {
  /** Primary (= commands[0]). Kept for existing consumers (modal initial mode). */
  command: string;
  /** 1..3 candidate commands, best first. */
  commands: string[];
  /** Aggregate: any command dangerous. */
  dangerous: boolean;
  /** Per-command danger, same length as commands. */
  dangerousFlags: boolean[];
  runId: string;
  deviceId: string;
  deviceName?: string;
  cwd: string;
};
```

② `res.kind === 'final'` 分支（`generateCommand` 内）替换为：

```ts
      if (res.kind === 'final') {
        const parsed = parseFinalCommands(res.text);
        const commands = (parsed.length > 0
          ? parsed
          : ['echo "command generation did not converge"']
        ).map(text => applyDialectGuard(text, input.shell));
        const dangerousFlags = commands.map(isDangerousCommand);
        const dangerous = dangerousFlags.some(Boolean);
        rememberAudit({ userId: input.userId, deviceId: input.deviceId, sessionId: input.sessionId, eventType: 'command_gen.final', metadata: { dangerous, count: commands.length } });
        const fseq = seq++;
        const snippet = commands.join('\n');
        await publishCommandGenEvent(target, { type: 'commandGen.step', runId, seq: fseq, kind: 'final', snippet, durationMs: 0, ts: now() });
        await addStep(db, { runId, seq: fseq, kind: 'final', resultSnippet: snippet, durationMs: 0, now });
        // final_command 列只存首条 —— 无 schema 迁移；全量仍在 steps 里可考。
        await finishRun(db, { runId, status: 'converged', finalCommand: commands[0], dangerous, stepCount: seq, now });
        await publishCommandGenEvent(target, { type: 'commandGen.runFinished', runId, status: 'converged', finalCommand: commands[0], dangerous, commands, dangerousFlags, ts: now() });
        await pruneCommandGenRuns(db, input.userId);
        return { command: commands[0], commands, dangerous, dangerousFlags, runId, deviceId: deviceTarget.deviceId, deviceName: deviceTarget.name, cwd: deviceTarget.cwd };
      }
```

③ 不收敛兜底分支：`// Did not converge` 下的 `messages.push({ role: 'user', content: 'Produce the single shell command now. No tools.' })` nudge 行**保留不动**，其后的 `const fin = await callLlm(...)` 起至 `return {...}` 改为：

```ts
    const fin = await callLlm({ protocol: input.protocol, baseUrl: input.baseUrl, apiKey: input.apiKey, model: input.model, messages, tools: [], timeoutMs: PER_CALL_LLM_TIMEOUT_MS });
    const parsed = parseFinalCommands(fin.kind === 'final' ? fin.text : '');
    const commands = (parsed.length > 0
      ? parsed
      : ['echo "command generation did not converge"']
    ).map(text => applyDialectGuard(text, input.shell));
    const dangerousFlags = commands.map(isDangerousCommand);
    const dangerous = dangerousFlags.some(Boolean);
    await finishRun(db, { runId, status: 'converged', finalCommand: commands[0], dangerous, stepCount: seq, now });
    await publishCommandGenEvent(target, { type: 'commandGen.runFinished', runId, status: 'converged', finalCommand: commands[0], dangerous, commands, dangerousFlags, ts: now() });
    await pruneCommandGenRuns(db, input.userId);
    return { command: commands[0], commands, dangerous, dangerousFlags, runId, deviceId: deviceTarget.deviceId, deviceName: deviceTarget.name, cwd: deviceTarget.cwd };
```

- [ ] **Step 2.4: 跑绿 + 回归既有命令生成套件**

```bash
cd "$S" && npx vitest run test/commandGen/orchestrator.test.ts test/commandGen/parseFinalCommands.test.ts
```
预期：全 PASS（既有用例 `r.command` 断言不受影响）。

- [ ] **Step 2.5: events.ts 补字段**——打开 `server/src/commandGen/events.ts`，找到 `commandGen.runFinished` 的事件类型定义（union 变体），加两个可选字段（若该文件用宽类型 `Record<string, unknown>` 则无需改动，读后判断）：

```ts
commands?: string[];
dangerousFlags?: boolean[];
```

- [ ] **Step 2.6: Commit**

```bash
cd "$S" && git add server/src/commandGen/orchestrator.ts server/src/commandGen/events.ts server/test/commandGen/orchestrator.test.ts
git commit -m "feat(commandGen): orchestrator 返回 1-3 条建议命令(commands/dangerousFlags),final_command 存首条"
```

## Task 3: SKILL.md 契约 + 事件字段 + 全量回归

**Files:**
- Modify: `server/skills/terminal-command-composer/SKILL.md`

- [ ] **Step 3.1: SKILL.md 修改**（⚠ 对 spec §2.1「其余章节不动」的一处**必要偏差**：Termination 节的措辞必须跟随输出契约从"单条命令"改为"JSON 输出"，否则模型收到矛盾指令；spec 意图是工具/方言/安全规则不动，本编辑符合意图）

① frontmatter `description:` 改为：
```
description: Turn a spoken request into 1-3 safe shell command candidates for an interactive terminal (bash on macOS/Linux, cmd or PowerShell on Windows), inspecting the environment first with read-only tools.
```

② 开头第二段 `Turn a spoken request into exactly ONE safe, useful shell command` 改为 `Turn a spoken request into 1-3 safe, useful shell command candidates`。

③ **Termination** 节第一句改为：
```
- The instant you have enough information, STOP calling tools and return the final JSON output with NO tool call. That final message is the loop-exit signal.
```

④ **Output contract** 整节替换为：
```markdown
## Output contract (IMPORTANT)
- Return ONLY a JSON object: {"commands": ["<cmd1>", "<cmd2>", "<cmd3>"]}
- 1 to 3 commands, best candidate first. Each entry is a single-line raw shell
  command (bash for unix, cmd/PowerShell for windows) — no fences, labels,
  bullets, comments, or explanations.
- The entries are ALTERNATIVE candidates answering the same request (best +
  fallbacks), NOT sequential steps. Chain steps that must run together inside
  ONE entry with && (unix) or ; (windows).
- If the request is unsafe or unclear: a single safe echo alternative,
  e.g. {"commands": ["echo \"...\""]}.
```

- [ ] **Step 3.2: 全量 server 测试 + typecheck**

```bash
cd "$S" && npm run test:server 2>&1 | tail -8
cd "$S" && npx tsc -p server/tsconfig.json && echo TS-OK
```
预期：全绿（已知预存失败 `issuePikoTunnelTicket` 除外）。**三处既有可能被 SKILL.md/响应改动波及的断言**：
- `orchestrator.test.ts:52` 断言 SKILL.md 正文含 `'Return ONLY the raw shell command'` —— 本任务删掉了这句话，**把断言更新为新契约文案**（如 `'Return ONLY a JSON object'`）。
- `route.test.ts`/`route.r2/r3.test.ts` 若对响应体严格 `toEqual`：给期望对象补 `commands`/`dangerousFlags`（加法字段导致的不匹配是预期改动，不是回归）。
- `skillLoader.test.ts` 若断言 SKILL.md 其他具体文案：同步更新。
另注：`modelConfig.ts:181-202` 内嵌的 fallback prompt 仍写着 "exactly ONE"——**有意不动**（admin 未配置 promptTemplate 时经 `parseFinalCommands` 原文回退仍正确），不要去"修"它。

- [ ] **Step 3.3: Commit**

```bash
cd "$S" && git add -A server/skills server/src/commandGen server/test
git commit -m "feat(commandGen): SKILL.md 输出契约改 1-3 条 JSON 建议"
```

---

# Part 2 — Phone（新模块，先立后破）

## Task 4: `commandGenErrorText` 抽到独立模块

**Files:**
- Create: `src/utils/commandGenErrorText.ts`
- Modify: `src/components/terminal/VoiceToBashModal.tsx`（删本地定义，改 re-export）
- Test: `__tests__/utils/commandGenErrorText.test.ts`（新建）

- [ ] **Step 4.1: 写失败测试**——`ApiResponseError` 构造签名是 `constructor(message, status, code?)`（`src/api/client.ts:16-26`，第三个参才是错误码）：

```ts
// __tests__/utils/commandGenErrorText.test.ts
import { commandGenErrorText } from '../../src/utils/commandGenErrorText';
import { ApiResponseError } from '../../src/api/client';

const t = (key: string) => key;

describe('commandGenErrorText', () => {
  it('maps known llm_* codes to localized keys', () => {
    expect(commandGenErrorText(new ApiResponseError('gateway timeout', 504, 'llm_timeout'), t)).toBe(
      'voiceBash.error.llmTimeout',
    );
  });

  it('passes through an Error message verbatim', () => {
    expect(commandGenErrorText(new Error('boom'), t)).toBe('boom');
  });

  it('falls back for non-Error values', () => {
    expect(commandGenErrorText('nope', t)).toBe('voiceBash.error.generateFallback');
  });
});
```

- [ ] **Step 4.2: 跑红** `cd "$P" && npx jest commandGenErrorText --testPathIgnorePatterns="/node_modules/"` → FAIL（模块不存在）。

- [ ] **Step 4.3: 实现**——新建 `src/utils/commandGenErrorText.ts`（内容 = 从 `VoiceToBashModal.tsx:99-119` 原样搬运 `COMMAND_GEN_ERROR_KEYS` + `commandGenErrorText`，头注替换为）：

```ts
import { ApiResponseError } from '../api/client';

// Upstream commandGen failures arrive as ApiResponseError whose code is one of
// the server's dedicated llm_* codes (server/src/commandGen/llmErrors.ts). The
// error text is rendered verbatim, so known codes map to actionable localized
// copy; unknown codes keep the raw message. Moved here from VoiceToBashModal so
// the terminal AI-suggest bar can reuse it (the modal re-exports for compat).
const COMMAND_GEN_ERROR_KEYS: Record<string, string> = {
  llm_model_not_found: 'voiceBash.error.llmModelNotFound',
  llm_auth_failed: 'voiceBash.error.llmAuthFailed',
  llm_rate_limited: 'voiceBash.error.llmRateLimited',
  llm_timeout: 'voiceBash.error.llmTimeout',
  llm_unreachable: 'voiceBash.error.llmUnreachable',
  llm_upstream_error: 'voiceBash.error.llmUpstreamError',
};

export const commandGenErrorText = (
  e: unknown,
  t: (key: string) => string,
): string => {
  const code = e instanceof ApiResponseError ? e.code : undefined;
  if (code && COMMAND_GEN_ERROR_KEYS[code]) return t(COMMAND_GEN_ERROR_KEYS[code]);
  return e instanceof Error && e.message
    ? e.message
    : t('voiceBash.error.generateFallback');
};
```

`VoiceToBashModal.tsx`：删除本地 `COMMAND_GEN_ERROR_KEYS` 常量与 `commandGenErrorText` 函数（99-119 行附近），原位放 **import + re-export 两行**（⚠ 单行 `export { x } from ...` 不产生本地绑定，而 modal 内部 323 行还在调用它——必须两行）：

```ts
import { commandGenErrorText } from '../../utils/commandGenErrorText';

export { commandGenErrorText };
```

- [ ] **Step 4.4: 跑绿 + modal 回归**

```bash
cd "$P" && npx jest commandGenErrorText --testPathIgnorePatterns="/node_modules/" && npx jest VoiceToBashModal --testPathIgnorePatterns="/node_modules/"
```
预期：全部 PASS（modal 行为零变化）。

- [ ] **Step 4.5: Commit**

```bash
cd "$P" && git add src/utils/commandGenErrorText.ts src/components/terminal/VoiceToBashModal.tsx __tests__/utils/commandGenErrorText.test.ts
git commit -m "refactor(终端): commandGenErrorText 抽到独立 util,modal 改 re-export"
```

## Task 5: i18n 新键（terminal namespace `aiSuggest` 组）

**Files:**
- Modify: `src/i18n/locales/terminal/en.json`、`src/i18n/locales/terminal/zh.json`

（只加键。旧键 `devices:terminal.voice` 的删除放在 Task 12——Task 11 之前旧 FAB chip 还在用。）

- [ ] **Step 5.1: en.json**——顶层（与 `"voiceBash"` 平级）加：

```json
"aiSuggest": {
  "emptyHint": "Tap the mic and speak a command — long-press to type it instead",
  "listening": "Listening…",
  "generating": "Generating suggestions…",
  "chipArm": "Tap again to run",
  "textPlaceholder": "Describe the command to run",
  "textSend": "Send",
  "textCancel": "Cancel",
  "voiceFabLabel": "Voice command",
  "keyboardToggleLabel": "Toggle keyboard",
  "errorRetry": "Retry",
  "errorVoice": "Voice recognition failed, please retry",
  "a11yRun": "Run suggested command {{command}}",
  "a11yArm": "Tap again to run {{command}}"
}
```

- [ ] **Step 5.2: zh.json**——同位置加：

```json
"aiSuggest": {
  "emptyHint": "点右侧麦克风说出命令，长按可输入文字",
  "listening": "正在聆听…",
  "generating": "正在生成建议…",
  "chipArm": "再点确认执行",
  "textPlaceholder": "描述你想执行的命令",
  "textSend": "发送",
  "textCancel": "取消",
  "voiceFabLabel": "语音命令",
  "keyboardToggleLabel": "切换键盘",
  "errorRetry": "重试",
  "errorVoice": "语音识别失败，请重试",
  "a11yRun": "执行建议命令 {{command}}",
  "a11yArm": "再点一次确认执行 {{command}}"
}
```

- [ ] **Step 5.3: 验证 JSON 合法 + Commit**

```bash
cd "$P" && node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/terminal/en.json')); JSON.parse(require('fs').readFileSync('src/i18n/locales/terminal/zh.json')); console.log('JSON-OK')"
git add src/i18n/locales/terminal && git commit -m "feat(终端): i18n 新增 aiSuggest 键组(语音建议条/空态/危险确认/键盘开关)"
```

## Task 6: `utils/aiSuggestions.ts` 纯函数 + `CommandGenResult` 类型扩展（TDD）

**Files:**
- Modify: `src/api/commandGen.ts`（`CommandGenResult` 加可选字段）
- Create: `src/utils/aiSuggestions.ts`
- Test: `__tests__/utils/aiSuggestions.test.ts`（新建）

- [ ] **Step 6.1: 先扩 `src/api/commandGen.ts` 的 `CommandGenResult`**（加法、向后兼容）：

```ts
export interface CommandGenResult {
  command: string;
  /** 1-3 candidate commands (new server). Absent on older servers. */
  commands?: string[];
  dangerous: boolean;
  /** Per-command danger aligned with `commands`. Absent on older servers. */
  dangerousFlags?: boolean[];
  runId: string;
  /** The device the AI chose (defaults to the request's device if it never called select_device). */
  deviceId?: string;
  deviceName?: string;
  /** The cwd on the chosen device. */
  cwd?: string;
}
```

- [ ] **Step 6.2: 写失败测试** `__tests__/utils/aiSuggestions.test.ts`：

```ts
import {
  MAX_AI_SUGGESTION_CHIPS,
  chipsFromCommandGenResult,
  mergeAiSuggestions,
  type AiSuggestionChip,
} from '../../src/utils/aiSuggestions';

describe('chipsFromCommandGenResult', () => {
  it('maps the new commands/dangerousFlags shape per command', () => {
    expect(
      chipsFromCommandGenResult({
        command: 'a',
        commands: ['a', 'b'],
        dangerous: false,
        dangerousFlags: [false, true],
      }),
    ).toEqual([
      { command: 'a', dangerous: false },
      { command: 'b', dangerous: true },
    ]);
  });

  it('falls back to [command] when commands is absent (old server)', () => {
    expect(
      chipsFromCommandGenResult({ command: 'git status --short', dangerous: false }),
    ).toEqual([{ command: 'git status --short', dangerous: false }]);
    // 旧服务器无逐条 flags：聚合 dangerous 施加于每条。
    expect(
      chipsFromCommandGenResult({ command: 'x', dangerous: true }),
    ).toEqual([{ command: 'x', dangerous: true }]);
  });

  it('ORs in the local isUnsafeSuggestion check', () => {
    expect(
      chipsFromCommandGenResult({
        commands: ['rm -rf /tmp/vibe-test'],
        dangerous: false,
        dangerousFlags: [false],
      }),
    ).toEqual([{ command: 'rm -rf /tmp/vibe-test', dangerous: true }]);
  });

  it('returns [] for an empty result', () => {
    expect(chipsFromCommandGenResult({})).toEqual([]);
  });
});

describe('mergeAiSuggestions', () => {
  const chip = (command: string, dangerous = false): AiSuggestionChip => ({ command, dangerous });

  it('puts the incoming batch first, then previous chips', () => {
    expect(mergeAiSuggestions([chip('old1'), chip('old2')], [chip('new1')])).toEqual([
      chip('new1'),
      chip('old1'),
      chip('old2'),
    ]);
  });

  it('dedupes case-insensitively and trims', () => {
    expect(mergeAiSuggestions([chip('LS -LA')], [chip('  ls -la ')]).map(c => c.command)).toEqual([
      'ls -la',
    ]);
  });

  it('caps the total at MAX_AI_SUGGESTION_CHIPS (6), newest wins', () => {
    const prev = Array.from({ length: 6 }, (_, i) => chip(`old${i}`));
    const merged = mergeAiSuggestions(prev, [chip('fresh')]);
    expect(merged.length).toBe(MAX_AI_SUGGESTION_CHIPS);
    expect(merged[0].command).toBe('fresh');
    expect(merged.map(c => c.command)).not.toContain('old5');
  });

  it('drops empty commands', () => {
    expect(mergeAiSuggestions([], [chip('  '), chip('ok')])).toEqual([chip('ok')]);
  });
});
```

- [ ] **Step 6.3: 跑红** `cd "$P" && npx jest aiSuggestions --testPathIgnorePatterns="/node_modules/"` → FAIL。

- [ ] **Step 6.4: 实现** `src/utils/aiSuggestions.ts`：

```ts
import { isUnsafeSuggestion } from './terminalSuggestions';

export interface AiSuggestionChip {
  command: string;
  dangerous: boolean;
}

export const MAX_AI_SUGGESTION_CHIPS = 6;

/** Both old ({command, dangerous}) and new ({commands, dangerousFlags}) server
 *  responses satisfy this; mirrors src/api/commandGen.ts CommandGenResult. */
export interface CommandGenResultLike {
  command?: string;
  commands?: string[];
  dangerous?: boolean;
  dangerousFlags?: boolean[];
}

/** Map a commandGen response into chips. Per-command flags when present;
 *  otherwise the aggregate `dangerous` applies to every entry (old-server
 *  compat). The local isUnsafeSuggestion check always ORs in — the phone's
 *  interactive/danger/secret filters catch what the server's filter misses. */
export function chipsFromCommandGenResult(
  result: CommandGenResultLike,
): AiSuggestionChip[] {
  const commands =
    result.commands && result.commands.length > 0
      ? result.commands
      : result.command
        ? [result.command]
        : [];
  return commands.map((command, index) => ({
    command,
    dangerous:
      isUnsafeSuggestion(command) ||
      (result.dangerousFlags
        ? Boolean(result.dangerousFlags[index])
        : Boolean(result.dangerous)),
  }));
}

/** Merge a fresh batch (FIRST in the result) above the existing chips: newest
 *  batch first, case-insensitive dedupe by command, hard cap. */
export function mergeAiSuggestions(
  prev: AiSuggestionChip[],
  incoming: AiSuggestionChip[],
  max: number = MAX_AI_SUGGESTION_CHIPS,
): AiSuggestionChip[] {
  const merged: AiSuggestionChip[] = [];
  const seen = new Set<string>();
  for (const chip of [...incoming, ...prev]) {
    const key = chip.command.trim();
    if (!key) continue;
    const dedupeKey = key.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    merged.push({ command: key, dangerous: chip.dangerous });
    if (merged.length >= max) break;
  }
  return merged;
}
```

- [ ] **Step 6.5: 跑绿 + Commit**

```bash
cd "$P" && npx jest aiSuggestions --testPathIgnorePatterns="/node_modules/"
git add src/api/commandGen.ts src/utils/aiSuggestions.ts __tests__/utils/aiSuggestions.test.ts
git commit -m "feat(终端): aiSuggestions 纯函数(响应→chips/置顶去重合并)+CommandGenResult 扩展多建议字段"
```

## Task 7: `useAiCommandSuggestions` hook（TDD）

**Files:**
- Create: `src/hooks/useAiCommandSuggestions.ts`
- Test: `__tests__/useAiCommandSuggestions.test.tsx`（新建）

- [ ] **Step 7.1: 写失败测试**（照 `__tests__/useVoiceStt.test.tsx` 的 Probe 范式）：

```tsx
// __tests__/useAiCommandSuggestions.test.tsx
import React from 'react';
import { Keyboard, Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import {
  useAiCommandSuggestions,
  type UseAiCommandSuggestionsResult,
} from '../src/hooks/useAiCommandSuggestions';
import type { UseVoiceSttResult, VoiceSttStatus } from '../src/hooks/useVoiceStt';

jest.useFakeTimers();

// --- controllable mocks (factory-defined arrows read at call time; no TDZ) ---
const mockVoiceSttState: {
  status: VoiceSttStatus;
  liveCaption: string;
  errorMessage: string;
} = { status: 'idle', liveCaption: '', errorMessage: '' };
const mockStart = jest.fn();
const mockStop = jest.fn();
const mockCancel = jest.fn();

jest.mock('../src/hooks/useVoiceStt', () => ({
  useVoiceStt: (): UseVoiceSttResult => ({
    status: mockVoiceSttState.status,
    liveCaption: mockVoiceSttState.liveCaption,
    errorMessage: mockVoiceSttState.errorMessage,
    start: mockStart,
    stop: mockStop,
    cancel: mockCancel,
  }),
}));

const mockGenerateCommand = jest.fn();
jest.mock('../src/api/commandGen', () => ({
  generateCommand: (...args: unknown[]) => mockGenerateCommand(...args),
}));

const mockUnsubscribe = jest.fn();
let mockCommandGenListener: ((e: unknown) => void) | null = null;
jest.mock('../src/services/commandGenEvents', () => ({
  subscribeCommandGenEvents: (listener: (e: unknown) => void) => {
    mockCommandGenListener = listener;
    return mockUnsubscribe;
  },
}));

let latest: UseAiCommandSuggestionsResult;

const Probe = () => {
  latest = useAiCommandSuggestions({
    deviceId: 'device-1',
    cwd: '~/project',
    sessionId: 'term-1',
  });
  return <Text>{latest.phase}</Text>;
};

const mount = async () => {
  await act(async () => {
    screen = ReactTestRenderer.create(<Probe />);
  });
};
let screen: ReactTestRenderer.ReactTestRenderer | null = null;

const opts = () => mockStart.mock.calls.at(-1)?.[0] as
  | { onComplete: (t: string) => void }
  | undefined;

beforeEach(() => {
  screen = null;
  mockCommandGenListener = null;
  mockVoiceSttState.status = 'idle';
  mockVoiceSttState.liveCaption = '';
  mockVoiceSttState.errorMessage = '';
  jest.clearAllMocks();
  jest.spyOn(Keyboard, 'dismiss').mockImplementation();
});

afterEach(() => act(async () => { screen?.unmount(); }));

describe('useAiCommandSuggestions', () => {
  it('starts idle with no chips', async () => {
    await mount();
    expect(latest.phase).toBe('idle');
    expect(latest.chips).toEqual([]);
  });

  it('submitText → generating → chips land, unsubscribes after resolve', async () => {
    mockGenerateCommand.mockResolvedValue({
      command: 'git status --short',
      commands: ['git status --short', 'git diff --stat'],
      dangerous: false,
      dangerousFlags: [false, false],
    });
    await mount();
    await act(async () => { latest.submitText('看看状态'); await Promise.resolve(); });
    expect(latest.chips).toEqual([
      { command: 'git status --short', dangerous: false },
      { command: 'git diff --stat', dangerous: false },
    ]);
    expect(latest.phase).toBe('idle');
    expect(mockUnsubscribe).toHaveBeenCalled();
    expect(mockGenerateCommand).toHaveBeenCalledWith(
      expect.objectContaining({ text: '看看状态', mode: 'live', sessionId: 'term-1' }),
    );
  });

  it('old-server response (no commands field) yields a single chip', async () => {
    mockGenerateCommand.mockResolvedValue({ command: 'pwd', dangerous: false });
    await mount();
    await act(async () => { latest.submitText('在哪'); await Promise.resolve(); });
    expect(latest.chips).toEqual([{ command: 'pwd', dangerous: false }]);
  });

  it('maps failures to error phase with text; retry() resends the same text', async () => {
    mockGenerateCommand.mockRejectedValueOnce(new Error('llm_timeout'));
    await mount();
    await act(async () => { latest.submitText('看看状态'); await Promise.resolve(); });
    expect(latest.phase).toBe('error');
    expect(latest.errorText).toBe('llm_timeout');
    mockGenerateCommand.mockResolvedValueOnce({
      command: 'git status --short', commands: ['git status --short'], dangerous: false, dangerousFlags: [false],
    });
    await act(async () => { latest.retry(); await Promise.resolve(); });
    expect(latest.phase).toBe('idle');
    expect(mockGenerateCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: '看看状态' }),
    );
  });

  it('startVoice dismisses the keyboard then starts STT; onComplete generates', async () => {
    mockGenerateCommand.mockResolvedValue({
      command: 'git status', commands: ['git status'], dangerous: false, dangerousFlags: [false],
    });
    await mount();
    act(() => { latest.startVoice(); });
    expect(Keyboard.dismiss).toHaveBeenCalled();
    expect(latest.phase).toBe('recording');
    const startOpts = opts();
    expect(startOpts?.onComplete).toBeInstanceOf(Function);
    await act(async () => { startOpts!.onComplete('看看 git 状态'); await Promise.resolve(); });
    expect(mockGenerateCommand).toHaveBeenCalledWith(
      expect.objectContaining({ text: '看看 git 状态' }),
    );
  });

  it('stopVoice only acts while recording', async () => {
    await mount();
    act(() => { latest.stopVoice(); });
    expect(mockStop).not.toHaveBeenCalled(); // idle 态 no-op
    act(() => { latest.startVoice(); });
    act(() => { latest.stopVoice(); });
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('generating ignores re-entry (no second POST, no stt.start)', async () => {
    mockGenerateCommand.mockImplementation(() => new Promise(() => undefined)); // 悬挂
    await mount();
    await act(async () => { latest.submitText('first'); });
    expect(latest.phase).toBe('generating');
    const callsBefore = mockGenerateCommand.mock.calls.length;
    const startCallsBefore = mockStart.mock.calls.length;
    act(() => { latest.submitText('ignored'); });
    act(() => { latest.startVoice(); });
    expect(mockGenerateCommand.mock.calls.length).toBe(callsBefore);
    expect(mockStart).toHaveBeenCalledTimes(startCallsBefore); // startVoice 在 generating 被忽略
  });

  it('voiceStt error during recording surfaces the error phase', async () => {
    await mount();
    act(() => { latest.startVoice(); });
    mockVoiceSttState.status = 'error';
    mockVoiceSttState.errorMessage = '语音识别失败，请重试';
    await act(async () => { screen!.update(<Probe />); });
    expect(latest.phase).toBe('error');
    expect(latest.errorText).toBe('语音识别失败，请重试');
  });

  it('reset() clears chips/phase/lastText and cancels STT', async () => {
    mockGenerateCommand.mockResolvedValue({
      command: 'pwd', commands: ['pwd'], dangerous: false, dangerousFlags: [false],
    });
    await mount();
    await act(async () => { latest.submitText('x'); await Promise.resolve(); });
    await act(async () => { latest.reset(); });
    expect(latest.chips).toEqual([]);
    expect(latest.phase).toBe('idle');
    expect(mockCancel).toHaveBeenCalled();
  });

  it('liveStatus tracks commandGen.step tool_call events', async () => {
    mockGenerateCommand.mockImplementation(() => new Promise(() => undefined));
    await mount();
    await act(async () => { latest.submitText('slow'); });
    expect(mockCommandGenListener).not.toBeNull();
    act(() => {
      mockCommandGenListener!({ type: 'commandGen.step', runId: 'r1', seq: 1, kind: 'tool_call', toolName: 'list_dir' });
    });
    expect(latest.liveStatus).toBe('list_dir');
  });

  it('a response landing after reset() is dropped (terminal-switch guard)', async () => {
    mockGenerateCommand.mockImplementation(() => new Promise(() => undefined));
    await mount();
    await act(async () => { latest.submitText('slow'); });
    await act(async () => { latest.reset(); });
    expect(latest.phase).toBe('idle');
  });

  it('openTextInput only from idle; closeTextInput resets', async () => {
    await mount();
    act(() => { latest.openTextInput(); });
    expect(latest.textMode).toBe(true);
    act(() => { latest.closeTextInput(); });
    expect(latest.textMode).toBe(false);
  });
});
```

（若「generating 忽略再进入」一条在悬挂 promise 下计时器/卸载有麻烦，可拆成两条更小的用例：`submitText during generating does not fire a second POST`、`startVoice during generating does not call stt.start`——语义等价即可。）

- [ ] **Step 7.2: 跑红** `cd "$P" && npx jest useAiCommandSuggestions --testPathIgnorePatterns="/node_modules/"` → FAIL（hook 不存在）。

- [ ] **Step 7.3: 实现** `src/hooks/useAiCommandSuggestions.ts`：

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useVoiceStt, type VoiceSttStatus } from './useVoiceStt';
import { generateCommand } from '../api/commandGen';
import { subscribeCommandGenEvents } from '../services/commandGenEvents';
import { commandGenErrorText } from '../utils/commandGenErrorText';
import {
  chipsFromCommandGenResult,
  mergeAiSuggestions,
  type AiSuggestionChip,
} from '../utils/aiSuggestions';

export type AiSuggestPhase = 'idle' | 'recording' | 'generating' | 'error';

export interface UseAiCommandSuggestionsOptions {
  deviceId: string;
  cwd: string;
  sessionId?: string;
  projectId?: string;
}

export interface UseAiCommandSuggestionsResult {
  phase: AiSuggestPhase;
  chips: AiSuggestionChip[];
  liveCaption: string;
  liveStatus: string;
  errorText: string;
  textMode: boolean;
  voiceStatus: VoiceSttStatus;
  startVoice: () => void;
  stopVoice: () => void;
  submitText: (text: string) => void;
  retry: () => void;
  clearChips: () => void;
  dismissError: () => void;
  openTextInput: () => void;
  closeTextInput: () => void;
  reset: () => void;
}

/**
 * Terminal AI-suggest flow (spec 2026-09-21): tap the FAB to record → STT →
 * straight into commandGen (no review step; editing belongs to the long-press
 * text path) → 1-3 suggestion chips. Live commandGen.step events feed
 * `liveStatus` while generating. reset() must be invoked when the terminal
 * session changes — stale chips must never execute in a different pty.
 */
export function useAiCommandSuggestions(
  options: UseAiCommandSuggestionsOptions,
): UseAiCommandSuggestionsResult {
  const { t } = useTranslation('terminal');
  const voiceStt = useVoiceStt();
  const [phase, setPhase] = useState<AiSuggestPhase>('idle');
  const [chips, setChips] = useState<AiSuggestionChip[]>([]);
  const [liveStatus, setLiveStatus] = useState('');
  const [errorText, setErrorText] = useState('');
  const [textMode, setTextMode] = useState(false);

  // Latest props/handlers in refs so STT's long-lived onComplete closure and
  // the unmount cleanup never go stale (same discipline as VoiceToBashModal).
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const cancelRef = useRef(voiceStt.cancel);
  cancelRef.current = voiceStt.cancel;
  const lastTextRef = useRef('');
  // Bumped on reset() so a response landing after a terminal switch is dropped
  // instead of merging the old terminal's chips into the new one.
  const generationTokenRef = useRef(0);

  const generate = useCallback(
    async (text: string) => {
      const opts = optionsRef.current;
      const trimmed = text.trim();
      if (!trimmed || !opts.deviceId) return;
      lastTextRef.current = trimmed;
      setTextMode(false);
      setLiveStatus('');
      setPhase('generating');
      const token = ++generationTokenRef.current;
      // Subscribe BEFORE firing the POST so the early commandGen.runStarted
      // (carrying the runId) can't be missed — same ordering as the modal.
      let activeRunId: string | null = null;
      const unsubscribe = subscribeCommandGenEvents(event => {
        if (activeRunId === null) {
          if ('runId' in event && event.runId) activeRunId = event.runId;
          else return;
        } else if ('runId' in event && event.runId && event.runId !== activeRunId) {
          return;
        }
        if (
          event.type === 'commandGen.step' &&
          event.kind === 'tool_call' &&
          event.toolName
        ) {
          setLiveStatus(event.toolName);
        }
      });
      try {
        const result = await generateCommand({
          text: trimmed,
          deviceId: opts.deviceId,
          cwd: opts.cwd,
          mode: 'live',
          sessionId: opts.sessionId,
          projectId: opts.projectId,
        });
        if (token !== generationTokenRef.current) return;
        setChips(prev => mergeAiSuggestions(prev, chipsFromCommandGenResult(result)));
        setPhase('idle');
      } catch (e) {
        if (token !== generationTokenRef.current) return;
        setErrorText(commandGenErrorText(e, t));
        setPhase('error');
      } finally {
        unsubscribe();
      }
    },
    [t],
  );

  const startVoice = useCallback(() => {
    if (phase === 'recording' || phase === 'generating') return;
    Keyboard.dismiss();
    setErrorText('');
    setPhase('recording');
    void voiceStt.start({
      onComplete: text => {
        void generate(text);
      },
      sessionId: optionsRef.current.sessionId,
      projectPath: optionsRef.current.cwd,
      deviceId: optionsRef.current.deviceId,
    });
  }, [phase, voiceStt, generate]);

  const stopVoice = useCallback(() => {
    if (phase !== 'recording') return;
    void voiceStt.stop();
  }, [phase, voiceStt]);

  // A recording that ends in failure (permission drop, socket close with no
  // transcript, …) never fires onComplete — surface it instead of sitting in
  // `recording` forever.
  useEffect(() => {
    if (phase !== 'recording') return;
    if (voiceStt.status !== 'error') return;
    setErrorText(voiceStt.errorMessage || t('aiSuggest.errorVoice'));
    setPhase('error');
  }, [phase, voiceStt.status, voiceStt.errorMessage, t]);

  const submitText = useCallback(
    (text: string) => {
      if (phase === 'generating') return;
      void generate(text);
    },
    [phase, generate],
  );

  const retry = useCallback(() => {
    if (phase === 'generating' || !lastTextRef.current) return;
    void generate(lastTextRef.current);
  }, [phase, generate]);

  const clearChips = useCallback(() => setChips([]), []);
  const dismissError = useCallback(() => {
    setErrorText('');
    setPhase(prev => (prev === 'error' ? 'idle' : prev));
  }, []);
  const openTextInput = useCallback(() => {
    if (phase !== 'idle') return;
    setTextMode(true);
  }, [phase]);
  const closeTextInput = useCallback(() => setTextMode(false), []);

  const reset = useCallback(() => {
    generationTokenRef.current += 1;
    cancelRef.current();
    lastTextRef.current = '';
    setChips([]);
    setLiveStatus('');
    setErrorText('');
    setTextMode(false);
    setPhase('idle');
  }, []);

  // Unmount: kill any in-flight recording (a late stt.completed must not
  // resurrect state after the screen is gone).
  useEffect(() => () => cancelRef.current(), []);

  return {
    phase,
    chips,
    liveCaption: voiceStt.liveCaption,
    liveStatus,
    errorText,
    textMode,
    voiceStatus: voiceStt.status,
    startVoice,
    stopVoice,
    submitText,
    retry,
    clearChips,
    dismissError,
    openTextInput,
    closeTextInput,
    reset,
  };
}
```

- [ ] **Step 7.4: 跑绿**（预期全部 PASS；「stopVoice only while recording」若因 phase 时序抖动，改用两次独立 mount 各断言一次）+ **Commit**

```bash
cd "$P" && npx jest useAiCommandSuggestions --testPathIgnorePatterns="/node_modules/"
git add src/hooks/useAiCommandSuggestions.ts __tests__/useAiCommandSuggestions.test.tsx
git commit -m "feat(终端): useAiCommandSuggestions hook——语音直通/文本双路生成建议 chips,换会话 reset 防串终端"
```

## Task 8: `TerminalSuggestionRow` 组件（TDD）

**Files:**
- Create: `src/components/terminal/TerminalSuggestionRow.tsx`
- Test: `__tests__/TerminalSuggestionRow.test.tsx`（新建）

- [ ] **Step 8.1: 写失败测试**（房屋范式：ThemeContext+SafeArea 包裹、断言中文）：

```tsx
// __tests__/TerminalSuggestionRow.test.tsx
import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { TerminalSuggestionRow } from '../src/components/terminal/TerminalSuggestionRow';
import type { AiSuggestionChip } from '../src/utils/aiSuggestions';

jest.useFakeTimers();

const wrap = (ui: React.ReactElement) => (
  <ThemeContext.Provider value={{ theme: utilityMinimalist, mode: 'light', setMode: jest.fn(), isDark: false }}>
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, right: 0, bottom: 0, left: 0 } }}>
      {ui}
    </SafeAreaProvider>
  </ThemeContext.Provider>
);

const chip = (command: string, dangerous = false): AiSuggestionChip => ({ command, dangerous });
let screen: ReactTestRenderer.ReactTestRenderer;
const onExecute = jest.fn();

const renderRow = async (props: {
  chips: AiSuggestionChip[];
  disabled?: boolean;
}) => {
  await act(async () => {
    screen = ReactTestRenderer.create(
      wrap(
        <TerminalSuggestionRow
          chips={props.chips}
          disabled={props.disabled ?? false}
          onExecute={onExecute}
        />,
      ),
    );
  });
};
const byTestID = (id: string) => screen.root.findByProps({ testID: id });
const press = (id: string) => act(() => { byTestID(id).props.onPress(); });

beforeEach(() => { jest.clearAllMocks(); });
afterEach(() => act(async () => { screen.unmount(); }));

describe('TerminalSuggestionRow', () => {
  it('shows the empty hint when there are no chips', async () => {
    await renderRow({ chips: [] });
    expect(byTestID('terminal-suggestion-empty')).toBeTruthy();
    expect(
      screen.root.findAllByType(Text).some(n => n.props.children === '点右侧麦克风说出命令，长按可输入文字'),
    ).toBe(true);
  });

  it('renders chips with slugged testIDs and executes a safe chip on tap', async () => {
    await renderRow({ chips: [chip('git status --short')] });
    expect(byTestID('terminal-suggestion-git-status-short')).toBeTruthy();
    press('terminal-suggestion-git-status-short');
    expect(onExecute).toHaveBeenCalledWith('git status --short');
  });

  it('dangerous chip: first tap arms (shows 再点确认执行), second tap executes', async () => {
    await renderRow({ chips: [chip('rm -rf /tmp/vibe-test', true)] });
    press('terminal-suggestion-rm-rf-tmp-vibe-test');
    expect(onExecute).not.toHaveBeenCalled();
    expect(
      screen.root.findAllByType(Text).some(n => n.props.children === '再点确认执行'),
    ).toBe(true);
    press('terminal-suggestion-rm-rf-tmp-vibe-test');
    expect(onExecute).toHaveBeenCalledWith('rm -rf /tmp/vibe-test');
  });

  it('armed state auto-resets after 3s', async () => {
    await renderRow({ chips: [chip('rm -rf /tmp/vibe-test', true)] });
    const id = 'terminal-suggestion-rm-rf-tmp-vibe-test';
    press(id);
    act(() => { jest.advanceTimersByTime(3000); });
    expect(
      screen.root.findAllByType(Text).some(n => n.props.children === '再点确认执行'),
    ).toBe(false);
    press(id); // 复位后再点 = 重新武装,不执行
    expect(onExecute).not.toHaveBeenCalled();
  });

  it('disabled chips never execute', async () => {
    await renderRow({ chips: [chip('pwd')], disabled: true });
    press('terminal-suggestion-pwd');
    expect(onExecute).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 8.2: 跑红** `cd "$P" && npx jest TerminalSuggestionRow --testPathIgnorePatterns="/node_modules/"` → FAIL。

- [ ] **Step 8.3: 实现** `src/components/terminal/TerminalSuggestionRow.tsx`：

```tsx
// AI-suggested command chips for the terminal bottom bar (spec 2026-09-21).
// Replaces the old history/fallback suggestion row: chips come exclusively
// from the useAiCommandSuggestions hook (server commandGen output). A
// dangerous chip (server flag OR local isUnsafeSuggestion) uses a two-tap
// arm/confirm instead of a modal — same safety semantics as VoiceToBashModal's
// second confirm, zero extra surface.
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import type { AiSuggestionChip } from '../../utils/aiSuggestions';

const testIdSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const ARM_RESET_MS = 3000;

export interface TerminalSuggestionRowProps {
  chips: AiSuggestionChip[];
  disabled: boolean;
  onExecute: (command: string) => void;
}

export const TerminalSuggestionRow: React.FC<TerminalSuggestionRowProps> = ({
  chips,
  disabled,
  onExecute,
}) => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('terminal');
  const [armedCommand, setArmedCommand] = useState<string | null>(null);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
    },
    [],
  );

  const handlePress = (chip: AiSuggestionChip) => {
    if (disabled) return;
    if (chip.dangerous && armedCommand !== chip.command) {
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
      setArmedCommand(chip.command);
      armTimerRef.current = setTimeout(() => setArmedCommand(null), ARM_RESET_MS);
      return;
    }
    if (armTimerRef.current) {
      clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
    setArmedCommand(null);
    onExecute(chip.command);
  };

  if (chips.length === 0) {
    return (
      <View
        testID="terminal-suggestion-empty"
        style={[styles.chip, styles.emptyChip, styles.chipSurface(isDark, theme)]}
      >
        <Text
          numberOfLines={1}
          style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}
        >
          {t('aiSuggest.emptyHint')}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      testID="terminal-suggestion-row"
      horizontal
      keyboardShouldPersistTaps="handled"
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {chips.map(chip => {
        const armed = armedCommand === chip.command;
        return (
          <TouchableOpacity
            key={chip.command}
            testID={`terminal-suggestion-${testIdSlug(chip.command)}`}
            activeOpacity={0.76}
            accessibilityRole="button"
            accessibilityLabel={
              armed
                ? t('aiSuggest.a11yArm', { command: chip.command })
                : t('aiSuggest.a11yRun', { command: chip.command })
            }
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => handlePress(chip)}
            style={[
              styles.chip,
              styles.chipSurface(isDark, theme),
              chip.dangerous && {
                borderColor: theme.colors.error,
                backgroundColor: armed
                  ? theme.colors.errorContainer
                  : styles.chipSurface(isDark, theme).backgroundColor,
              },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                theme.typography.codeSm,
                styles.chipText,
                {
                  color: chip.dangerous ? theme.colors.error : theme.colors.onSurfaceVariant,
                },
              ]}
            >
              {armed ? t('aiSuggest.chipArm') : chip.command}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  row: { gap: 8, paddingRight: 12 },
  chip: {
    maxWidth: 200,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  emptyChip: { alignSelf: 'flex-start', maxWidth: 280 },
  chipText: {},
  // isDark/theme 经闭包传入,故用方法而非静态条目。
  chipSurface: (
    isDark: boolean,
    theme: ReturnType<typeof useTheme>['theme'],
  ): { backgroundColor: string; borderColor: string } => ({
    backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : theme.colors.surfaceContainerLow,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : theme.colors.outlineVariant,
  }),
});
```

（注：StyleSheet.create 里放函数是允许的——它是普通对象；若 lint 抱怨，把 `chipSurface` 提为组件外普通函数即可。）

- [ ] **Step 8.4: 跑绿 + Commit**

```bash
cd "$P" && npx jest TerminalSuggestionRow --testPathIgnorePatterns="/node_modules/"
git add src/components/terminal/TerminalSuggestionRow.tsx __tests__/TerminalSuggestionRow.test.tsx
git commit -m "feat(终端): AI 建议 chips 行组件——空态提示/危险 chip 两段式确认(3s 复位)"
```

## Task 9: `TerminalVoiceFab` 组件（TDD）

**Files:**
- Create: `src/components/terminal/TerminalVoiceFab.tsx`
- Test: `__tests__/TerminalVoiceFab.test.tsx`（新建）

- [ ] **Step 9.1: 写失败测试**：

```tsx
// __tests__/TerminalVoiceFab.test.tsx
import React from 'react';
import { ActivityIndicator } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { TerminalVoiceFab } from '../src/components/terminal/TerminalVoiceFab';

jest.useFakeTimers();

const wrap = (ui: React.ReactElement) => (
  <ThemeContext.Provider value={{ theme: utilityMinimalist, mode: 'light', setMode: jest.fn(), isDark: false }}>
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, right: 0, bottom: 0, left: 0 } }}>
      {ui}
    </SafeAreaProvider>
  </ThemeContext.Provider>
);

let screen: ReactTestRenderer.ReactTestRenderer;
const onPress = jest.fn();
const onLongPress = jest.fn();

const renderFab = async (
  phase: 'idle' | 'recording' | 'generating' | 'error',
  disabled = false,
) => {
  await act(async () => {
    screen = ReactTestRenderer.create(
      wrap(
        <TerminalVoiceFab phase={phase} disabled={disabled} onPress={onPress} onLongPress={onLongPress} />,
      ),
    );
  });
};
const fab = () => screen.root.findByProps({ testID: 'terminal-voice-fab' });
const hasPulse = () => {
  try { return Boolean(screen.root.findByProps({ testID: 'terminal-voice-fab-pulse' })); }
  catch { return false; }
};

beforeEach(() => jest.clearAllMocks());
afterEach(() => act(async () => { screen.unmount(); }));

describe('TerminalVoiceFab', () => {
  it('idle: mic + press/long-press wired', async () => {
    await renderFab('idle');
    expect(fab()).toBeTruthy();
    act(() => { fab().props.onPress(); });
    expect(onPress).toHaveBeenCalledTimes(1);
    act(() => { fab().props.onLongPress?.(); });
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(hasPulse()).toBe(false);
  });

  it('recording: pulse overlay visible, red error tint', async () => {
    await renderFab('recording');
    expect(hasPulse()).toBe(true);
    expect(JSON.stringify(fab().props.style)).toContain(utilityMinimalist.colors.error);
  });

  it('generating: spinner replaces the mic', async () => {
    await renderFab('generating');
    expect(screen.root.findAllByType(ActivityIndicator).length).toBe(1);
    expect(hasPulse()).toBe(false);
  });

  it('error: still pressable (retry semantics live in the screen)', async () => {
    await renderFab('error');
    act(() => { fab().props.onPress(); });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('disabled passthrough', async () => {
    await renderFab('idle', true);
    expect(fab().props.disabled).toBe(true);
  });
});
```

- [ ] **Step 9.2: 跑红** `cd "$P" && npx jest TerminalVoiceFab --testPathIgnorePatterns="/node_modules/"` → FAIL。

- [ ] **Step 9.3: 实现** `src/components/terminal/TerminalVoiceFab.tsx`：

```tsx
// Always-visible voice FAB pinned to the right edge of the terminal bottom
// bar (spec 2026-09-21). Tap = start/stop STT (the screen routes by phase);
// long-press (idle only) = open the editable text input. Purely presentational:
// the phase and handlers come from useAiCommandSuggestions via the screen.
import React, { useEffect, useRef } from 'react';
import { Animated, ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import type { AiSuggestPhase } from '../../hooks/useAiCommandSuggestions';

const MicIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 20 }) => (
  <Svg width={size} height={size} viewBox="0 0 20 20">
    <Path
      d="M10 2.5a3 3 0 0 1 3 3v4a3 3 0 0 1-6 0v-4a3 3 0 0 1 3-3Z"
      fill="none"
      stroke={color}
      strokeWidth={1.6}
    />
    <Path
      d="M5.5 9.5a4.5 4.5 0 0 0 9 0M10 14v3M7.5 17h5"
      fill="none"
      stroke={color}
      strokeWidth={1.6}
      strokeLinecap="round"
    />
  </Svg>
);

export interface TerminalVoiceFabProps {
  phase: AiSuggestPhase;
  disabled: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

export const TerminalVoiceFab: React.FC<TerminalVoiceFabProps> = ({
  phase,
  disabled,
  onPress,
  onLongPress,
}) => {
  const { theme } = useTheme();
  const { t } = useTranslation('terminal');
  const reduceMotion = useReduceMotion();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (phase !== 'recording' || reduceMotion) {
      pulse.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [phase, reduceMotion, pulse]);

  const recording = phase === 'recording';
  const accentColor = recording
    ? theme.colors.error
    : phase === 'error'
      ? theme.colors.error
      : theme.colors.primary;

  return (
    <TouchableOpacity
      testID="terminal-voice-fab"
      activeOpacity={0.74}
      accessibilityRole="button"
      accessibilityLabel={t('aiSuggest.voiceFabLabel')}
      accessibilityState={{ disabled, busy: phase === 'generating' }}
      hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[
        styles.fab,
        {
          backgroundColor: recording ? theme.colors.errorContainer : theme.colors.surface,
          borderColor: recording || phase === 'error' ? theme.colors.error : theme.colors.outline,
        },
        disabled && styles.disabled,
      ]}
    >
      {recording && !reduceMotion ? (
        <Animated.View
          testID="terminal-voice-fab-pulse"
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.pulse,
            {
              backgroundColor: theme.colors.error,
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.3] }),
            },
          ]}
        />
      ) : null}
      {phase === 'generating' ? (
        <ActivityIndicator size="small" color={theme.colors.primary} />
      ) : (
        <MicIcon color={accentColor} />
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  fab: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    alignSelf: 'center',
  },
  pulse: { borderRadius: 27 },
  disabled: { opacity: 0.45 },
});
```

（`useReduceMotion` 的导出名：先读 `src/hooks/useReduceMotion.ts` 确认是 `useReduceMotion` 具名导出——侦察已确认文件存在 50 行、模块级单例缓存。）

- [ ] **Step 9.4: 跑绿 + Commit**

```bash
cd "$P" && npx jest TerminalVoiceFab --testPathIgnorePatterns="/node_modules/"
git add src/components/terminal/TerminalVoiceFab.tsx __tests__/TerminalVoiceFab.test.tsx
git commit -m "feat(终端): 常驻语音悬浮钮组件——录音红晕脉冲(尊重减弱动态)/生成 spinner/长按回调"
```

## Task 10: `TerminalAiStatusStrip` 组件（TDD）

**Files:**
- Create: `src/components/terminal/TerminalAiStatusStrip.tsx`
- Test: `__tests__/TerminalAiStatusStrip.test.tsx`（新建）

- [ ] **Step 10.1: 写失败测试**：

```tsx
// __tests__/TerminalAiStatusStrip.test.tsx
import React from 'react';
import { Text, TextInput } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { TerminalAiStatusStrip } from '../src/components/terminal/TerminalAiStatusStrip';
import type { AiSuggestPhase } from '../src/hooks/useAiCommandSuggestions';

jest.useFakeTimers();

const wrap = (ui: React.ReactElement) => (
  <ThemeContext.Provider value={{ theme: utilityMinimalist, mode: 'light', setMode: jest.fn(), isDark: false }}>
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, right: 0, bottom: 0, left: 0 } }}>
      {ui}
    </SafeAreaProvider>
  </ThemeContext.Provider>
);

let screen: ReactTestRenderer.ReactTestRenderer;
const handlers = {
  onRetry: jest.fn(),
  onDismissError: jest.fn(),
  onSendText: jest.fn(),
  onCloseText: jest.fn(),
};

const renderStrip = async (props: {
  phase: AiSuggestPhase;
  textMode?: boolean;
  liveCaption?: string;
  liveStatus?: string;
  errorText?: string;
}) => {
  await act(async () => {
    screen = ReactTestRenderer.create(
      wrap(
        <TerminalAiStatusStrip
          phase={props.phase}
          textMode={props.textMode ?? false}
          liveCaption={props.liveCaption ?? ''}
          liveStatus={props.liveStatus ?? ''}
          errorText={props.errorText ?? ''}
          {...handlers}
        />,
      ),
    );
  });
};
const byTestID = (id: string) => screen.root.findByProps({ testID: id });

beforeEach(() => jest.clearAllMocks());
afterEach(() => act(async () => { screen.unmount(); }));

describe('TerminalAiStatusStrip', () => {
  it('recording: shows live caption or the listening fallback', async () => {
    await renderStrip({ phase: 'recording', liveCaption: '看看状态' });
    expect(screen.root.findAllByType(Text).some(n => n.props.children === '看看状态')).toBe(true);
    await renderStrip({ phase: 'recording', liveCaption: '' });
    expect(screen.root.findAllByType(Text).some(n => n.props.children === '正在聆听…')).toBe(true);
  });

  it('generating: shows liveStatus or the generating fallback', async () => {
    await renderStrip({ phase: 'generating', liveStatus: 'list_dir' });
    expect(screen.root.findAllByType(Text).some(n => n.props.children === 'list_dir')).toBe(true);
    await renderStrip({ phase: 'generating', liveStatus: '' });
    expect(screen.root.findAllByType(Text).some(n => n.props.children === '正在生成建议…')).toBe(true);
  });

  it('error: message + retry + dismiss', async () => {
    await renderStrip({ phase: 'error', errorText: '生成命令失败' });
    expect(screen.root.findAllByType(Text).some(n => n.props.children === '生成命令失败')).toBe(true);
    act(() => { byTestID('terminal-ai-retry').props.onPress(); });
    expect(handlers.onRetry).toHaveBeenCalledTimes(1);
    act(() => { byTestID('terminal-ai-error-dismiss').props.onPress(); });
    expect(handlers.onDismissError).toHaveBeenCalledTimes(1);
  });

  it('textMode: editable input + send (trimmed, clears draft) + cancel', async () => {
    await renderStrip({ phase: 'idle', textMode: true });
    const input = screen.root.findAllByType(TextInput).find(n => n.props.testID === 'terminal-ai-text-input');
    expect(input).toBeTruthy();
    expect(byTestID('terminal-ai-text-send').props.disabled).toBe(true);
    act(() => { input!.props.onChangeText('  看看状态  '); });
    expect(byTestID('terminal-ai-text-send').props.disabled).toBe(false);
    act(() => { byTestID('terminal-ai-text-send').props.onPress(); });
    expect(handlers.onSendText).toHaveBeenCalledWith('看看状态');
    act(() => { byTestID('terminal-ai-text-cancel').props.onPress(); });
    expect(handlers.onCloseText).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 10.2: 跑红** `cd "$P" && npx jest TerminalAiStatusStrip --testPathIgnorePatterns="/node_modules/"` → FAIL。

- [ ] **Step 10.3: 实现** `src/components/terminal/TerminalAiStatusStrip.tsx`：

```tsx
// Status strip rendered above the terminal bottom bar while the AI-suggest
// flow is active (spec 2026-09-21): live STT caption while recording, the
// current commandGen tool while generating, retry/dismiss on error, and the
// editable text input that backs the FAB long-press.
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import type { AiSuggestPhase } from '../../hooks/useAiCommandSuggestions';

export interface TerminalAiStatusStripProps {
  phase: AiSuggestPhase;
  textMode: boolean;
  liveCaption: string;
  liveStatus: string;
  errorText: string;
  onRetry: () => void;
  onDismissError: () => void;
  onSendText: (text: string) => void;
  onCloseText: () => void;
}

export const TerminalAiStatusStrip: React.FC<TerminalAiStatusStripProps> = ({
  phase,
  textMode,
  liveCaption,
  liveStatus,
  errorText,
  onRetry,
  onDismissError,
  onSendText,
  onCloseText,
}) => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('terminal');
  const [draft, setDraft] = useState('');

  const surface: { backgroundColor: string; borderColor: string } = {
    backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : theme.colors.surfaceContainerLow,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : theme.colors.outlineVariant,
  };

  if (textMode) {
    return (
      <View testID="terminal-ai-text-strip" style={[styles.strip, surface]}>
        <TextInput
          testID="terminal-ai-text-input"
          value={draft}
          onChangeText={setDraft}
          placeholder={t('aiSuggest.textPlaceholder')}
          placeholderTextColor={theme.colors.onSurfaceVariant}
          autoFocus
          multiline
          style={[theme.typography.bodySm, styles.textInput, { color: theme.colors.onSurface }]}
        />
        <TouchableOpacity
          testID="terminal-ai-text-send"
          accessibilityRole="button"
          disabled={!draft.trim()}
          onPress={() => {
            onSendText(draft.trim());
            setDraft('');
          }}
          style={[styles.pillButton, { borderColor: theme.colors.primary }, !draft.trim() && styles.disabled]}
        >
          <Text style={[theme.typography.labelSm, { color: theme.colors.primary }]}>
            {t('aiSuggest.textSend')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="terminal-ai-text-cancel"
          accessibilityRole="button"
          onPress={() => {
            setDraft('');
            onCloseText();
          }}
          style={[styles.pillButton, { borderColor: theme.colors.outline }]}
        >
          <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
            {t('aiSuggest.textCancel')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === 'recording') {
    return (
      <View testID="terminal-ai-strip" style={[styles.strip, surface]}>
        <View style={[styles.recDot, { backgroundColor: theme.colors.error }]} />
        <Text
          testID="terminal-ai-caption"
          numberOfLines={1}
          style={[theme.typography.bodySm, styles.flexText, { color: theme.colors.onSurface }]}
        >
          {liveCaption || t('aiSuggest.listening')}
        </Text>
      </View>
    );
  }

  if (phase === 'generating') {
    return (
      <View testID="terminal-ai-strip" style={[styles.strip, surface]}>
        <ActivityIndicator size="small" color={theme.colors.primary} />
        <Text
          testID="terminal-ai-progress"
          numberOfLines={1}
          style={[theme.typography.bodySm, styles.flexText, { color: theme.colors.onSurfaceVariant }]}
        >
          {liveStatus || t('aiSuggest.generating')}
        </Text>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View testID="terminal-ai-strip" style={[styles.strip, surface, { borderColor: theme.colors.error }]}>
        <Text
          testID="terminal-ai-error"
          numberOfLines={2}
          style={[theme.typography.bodySm, styles.flexText, { color: theme.colors.error }]}
        >
          {errorText || t('aiSuggest.errorVoice')}
        </Text>
        <TouchableOpacity
          testID="terminal-ai-retry"
          accessibilityRole="button"
          onPress={onRetry}
          style={[styles.pillButton, { borderColor: theme.colors.primary }]}
        >
          <Text style={[theme.typography.labelSm, { color: theme.colors.primary }]}>
            {t('aiSuggest.errorRetry')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="terminal-ai-error-dismiss"
          accessibilityRole="button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={onDismissError}
          style={styles.dismiss}
        >
          <Text style={[theme.typography.codeSm, { color: theme.colors.onSurfaceVariant }]}>✕</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return null;
};

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 40,
  },
  flexText: { flex: 1, minWidth: 0 },
  recDot: { width: 8, height: 8, borderRadius: 4 },
  textInput: { flex: 1, minWidth: 0, paddingVertical: 0 },
  pillButton: {
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismiss: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.45 },
});
```

- [ ] **Step 10.4: 跑绿 + Commit**

```bash
cd "$P" && npx jest TerminalAiStatusStrip --testPathIgnorePatterns="/node_modules/"
git add src/components/terminal/TerminalAiStatusStrip.tsx __tests__/TerminalAiStatusStrip.test.tsx
git commit -m "feat(终端): AI 状态条组件——实时字幕/生成进度/错误重试/可编辑文本输入"
```

## Task 11: `DeviceTerminalScreen` 底部区重构 + 既有测试改写

**Files:**
- Modify: `src/screens/devices/DeviceTerminalScreen.tsx`
- Rewrite: `__tests__/DeviceTerminal.voiceFab.test.tsx`
- Modify: `__tests__/DeviceTerminalScreen.test.tsx`（两条建议 chip 用例 + KB a11y 断言 + 新增键盘开关用例）

这是最大的一个任务。**按小步走**：每改一块就跑相关测试。

- [ ] **Step 11.1: screen 代码改造**（`src/screens/devices/DeviceTerminalScreen.tsx`）：

① **imports**：
- 删 `import { buildTerminalSuggestions } from '../../utils/terminalSuggestions';`
- 删 `import { VoiceToBashModal } from '../../components/terminal/VoiceToBashModal';`
- 加：
```tsx
import { useAiCommandSuggestions } from '../../hooks/useAiCommandSuggestions';
import { TerminalSuggestionRow } from '../../components/terminal/TerminalSuggestionRow';
import { TerminalVoiceFab } from '../../components/terminal/TerminalVoiceFab';
import { TerminalAiStatusStrip } from '../../components/terminal/TerminalAiStatusStrip';
```

② **删状态**：`const [voiceModalOpen, setVoiceModalOpen] = useState(false);`（246 行）及其注释块；`aiSuggestions` useMemo（297-304 行）。

③ **hook 接线**——放在 `terminalInputEnabled` 定义之后：

```tsx
  // 终端 AI 建议命令行(2026-09 spec):语音直通 + 长按文本输入 → commandGen 多建议 chips。
  const aiSuggest = useAiCommandSuggestions({
    deviceId: terminal?.deviceId ?? '',
    cwd: terminal?.directory ?? directory,
    sessionId: terminal?.id,
  });
  // 换会话(屏内 setTerminalId 可不卸载)必须清空 chips/复位——旧会话的建议
  // 绝不能被送进新 pty(spec 审查意见)。reset 是稳定 useCallback,依赖只挂 terminalId。
  useEffect(() => {
    aiSuggest.reset();
  }, [terminalId]); // eslint-disable-line react-hooks/exhaustive-deps
```

④ **键盘开关**——在 `focusTerminalInput`（714 行）附近加：

```tsx
  // 键盘开关(替代旧 KB 聚焦钮):开→收起,关→唤起。
  const keyboardOpen = keyboardInset > 0 || keyboardProxyFocused;
  const toggleKeyboard = () => {
    if (keyboardOpen) {
      keyboardProxyRef.current?.blur();
      Keyboard.dismiss();
    } else {
      focusKeyboardProxyInput();
    }
  };
```

⑤ **SVG 图标**——在 `TopPanelToggleIcon` 后加（import 行补 `Rect`）：

```tsx
const KeyboardToggleIcon: React.FC<{ color: string }> = ({ color }) => (
  <Svg width={20} height={20} viewBox="0 0 20 20">
    <Rect x={1.5} y={4} width={17} height={12} rx={2} fill="none" stroke={color} strokeWidth={1.5} />
    <Path
      d="M5 8h1.5M9 8h1.5M13 8h1.5M5 11h1.5M9 11h1.5M13 11h1.5M6.5 13.8h7"
      fill="none"
      stroke={color}
      strokeWidth={1.4}
      strokeLinecap="round"
    />
  </Svg>
);
```

⑥ **JSX 重构**（1520-1724 行区域）。整体结构替换为（保留外层条件 `terminal && !terminalDeadWithoutReplay` 与 `onLayout`/`testID="terminal-floating-controls"`）：

```tsx
            {terminal && !terminalDeadWithoutReplay ? (
              <View
                testID="terminal-floating-controls"
                pointerEvents="box-none"
                onLayout={event =>
                  setFloatingControlsHeight(event.nativeEvent.layout.height)
                }
                style={[styles.floatingControls, { bottom: controlsBottomOffset }]}
              >
                {aiSuggest.phase !== 'idle' || aiSuggest.textMode ? (
                  <TerminalAiStatusStrip
                    phase={aiSuggest.phase}
                    textMode={aiSuggest.textMode}
                    liveCaption={aiSuggest.liveCaption}
                    liveStatus={aiSuggest.liveStatus}
                    errorText={aiSuggest.errorText}
                    onRetry={aiSuggest.retry}
                    onDismissError={aiSuggest.dismissError}
                    onSendText={aiSuggest.submitText}
                    onCloseText={aiSuggest.closeTextInput}
                  />
                ) : null}
                <View style={styles.controlsRow} pointerEvents="box-none">
                  <View style={styles.controlsStack} pointerEvents="box-none">
                    <TerminalSuggestionRow
                      chips={aiSuggest.chips}
                      disabled={!terminalInputEnabled}
                      onExecute={command => {
                        sendToTerminal(`${command}\r`, {
                          focus: false,
                          keepKeyboardProxyFocused: true,
                        });
                        setVoiceCommandBanner(command);
                      }}
                    />
                    <ScrollView
                      horizontal
                      keyboardShouldPersistTaps="handled"
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.keyRow}
                    >
                      <TouchableOpacity
                        testID="terminal-keyboard-focus"
                        activeOpacity={0.74}
                        accessibilityRole="button"
                        accessibilityLabel={tReplay('aiSuggest.keyboardToggleLabel')}
                        hitSlop={terminalControlHitSlop}
                        accessibilityState={{ disabled: !terminalInputEnabled }}
                        onPressIn={toggleKeyboard}
                        disabled={!terminalInputEnabled}
                        style={[
                          styles.keyButton,
                          {
                            backgroundColor: elevatedSurfaceColor,
                            borderColor: keyboardProxyFocused
                              ? theme.colors.primary
                              : outlineColor,
                          },
                          !terminalInputEnabled && styles.disabledControl,
                        ]}
                      >
                        <KeyboardToggleIcon
                          color={
                            keyboardProxyFocused
                              ? theme.colors.primary
                              : theme.colors.onSurfaceVariant
                          }
                        />
                        <TextInput
                          ref={keyboardProxyRef}
                          testID="terminal-keyboard-proxy"
                          defaultValue={TERMINAL_KEYBOARD_PROXY_VALUE}
                          onChangeText={handleKeyboardProxyChange}
                          onKeyPress={handleKeyboardProxyKeyPress}
                          onFocus={handleKeyboardProxyFocus}
                          onBlur={handleKeyboardProxyBlur}
                          selection={TERMINAL_KEYBOARD_PROXY_SELECTION}
                          editable={terminalInputEnabled}
                          pointerEvents="none"
                          autoCapitalize="none"
                          autoCorrect={false}
                          autoComplete="off"
                          textContentType="none"
                          keyboardType={TERMINAL_PROXY_KEYBOARD_TYPE}
                          showSoftInputOnFocus
                          disableFullscreenUI
                          returnKeyType="done"
                          submitBehavior="newline"
                          multiline
                          blurOnSubmit={false}
                          caretHidden
                          contextMenuHidden
                          importantForAutofill="no"
                          spellCheck={false}
                          style={styles.keyboardProxy}
                        />
                      </TouchableOpacity>
                      {terminalShortcutGroups.map(group => (
                        /* …原样保留整个 groups map（1643-1690 行不动）… */
                      ))}
                    </ScrollView>
                  </View>
                  <TerminalVoiceFab
                    phase={aiSuggest.phase}
                    disabled={!terminalInputEnabled}
                    onPress={() => {
                      if (!terminalInputEnabled) return;
                      if (aiSuggest.phase === 'recording') aiSuggest.stopVoice();
                      else aiSuggest.startVoice();
                    }}
                    onLongPress={() => {
                      if (!terminalInputEnabled) return;
                      aiSuggest.openTextInput();
                    }}
                  />
                </View>
              </View>
            ) : null}
```

注意：**旧 voice FAB chip（1691-1721 行，含 `t('terminal.voice')`）整块删除**；`terminalShortcutGroups` 的 map 原样保留；**文件尾部的 `<VoiceToBashModal … mode="live" …>` 渲染块（1756-1771 行）整块删除**。

⑦ **styles** 增补（`floatingControls` 不变）：

```tsx
  controlsRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'stretch',
  },
  controlsStack: {
    flex: 1,
    minWidth: 0,
    gap: 10,
  },
```

- [ ] **Step 11.2: 改写 `__tests__/DeviceTerminal.voiceFab.test.tsx`**（整文件替换）：mock **hook 模块**（不再 mock VoiceToBashModal），其余 mocks（navigation/TerminalEmulator/seedStore/renderScreen）照旧文件保留：

```tsx
// 可控 hook 状态（工厂箭头在调用时读取，无 TDZ）
const mockAi = {
  phase: 'idle' as 'idle' | 'recording' | 'generating' | 'error',
  chips: [] as Array<{ command: string; dangerous: boolean }>,
  liveCaption: '',
  liveStatus: '',
  errorText: '',
  textMode: false,
  voiceStatus: 'idle',
  startVoice: jest.fn(),
  stopVoice: jest.fn(),
  submitText: jest.fn(),
  retry: jest.fn(),
  clearChips: jest.fn(),
  dismissError: jest.fn(),
  openTextInput: jest.fn(),
  closeTextInput: jest.fn(),
  reset: jest.fn(),
};
jest.mock('../src/hooks/useAiCommandSuggestions', () => ({
  useAiCommandSuggestions: () => mockAi,
}));
```

用例（`rerender` helper：改 `mockAi` 后 `act(() => { screen.update(<…同 renderScreen 的树…/>); })`——把 renderScreen 抽出 `tree()` 返回元素以便 update）：

1. `renders the FAB; disabled while input unavailable`（离线→disabled true，恢复→false）
2. `tap starts voice from idle`（onPress → mockAi.startVoice 调用）
3. `tap stops voice while recording`（phase='recording' + rerender → onPress → stopVoice）
4. `long-press opens the text input`（onLongPress → openTextInput）
5. `renders AI chips and executes on tap`（mockAi.chips=[{command:'git status --short',dangerous:false}] → 按 `terminal-suggestion-git-status-short` → mockTerminalSendText 收到 `'git status --short\r'` 且 `{focus:false}`；**并断言 `terminal-voice-banner` 出现**（spec §6 的「执行时 banner 更新」））
6. `dangerous chip requires the second tap`（dangerous chip 首点不发、二点发）
7. `empty chips show the hint chip`（chips=[] → `terminal-suggestion-empty` 存在）
8. `resets when the terminal id changes`（terminalId='term-1' 渲染后改 mockRouteParams.terminalId='term-2' + rerender → **`mockAi.reset` 恰好被调 2 次**（首次 mount 的 effect + 切换那一次——只断言"被调"会因 mount 即触发而空洞））
9. `status strip shows while generating`（phase='generating' → `terminal-ai-strip` 存在）

- [ ] **Step 11.3: 更新 `__tests__/DeviceTerminalScreen.test.tsx`**：

① 「suggestion chips」两条用例改写：文件顶部加同一个 `useAiCommandSuggestions` mock（同 Step 11.2 形状）；`keeps suggestions and shortcuts floating above the keyboard` 里 `hasSuggestion` 改查 mock chip（mockAi.chips 预置 `git status --short`）；`sends suggestion chips without dropping the soft keyboard focus` 改为：mock chip → onPress → `mockTerminalSendText` 收 `('git status --short\r', {focus:false})` + KB 边框 primary 断言保留。
② 新增 `toggles the soft keyboard from the keyboard button`：初始 `onPressIn` → 聚焦态成立（keyboard-focus 边框 primary）；触发 `keyboardListeners.keyboardWillShow`（height 300）→ 再 `onPressIn` → `keyboardDismissSpy` 被调。
③ KB a11y 断言：`accessibilityLabel` 从 `'Focus terminal keyboard'` 改为 `'切换键盘'`（i18n 钉中文）。
④ 若有其他 `'Focus terminal keyboard'` 字面量断言 → 全部改 `'切换键盘'`（grep 确认）。

- [ ] **Step 11.4: 跑相关套件 + 修到绿**

```bash
cd "$P" && npx jest DeviceTerminal --testPathIgnorePatterns="/node_modules/" 2>&1 | tail -20
```
预期：`DeviceTerminal.voiceFab` / `DeviceTerminalScreen` / `DeviceTerminalScreen.attach` / `DeviceTerminal.initialCommand` 全绿（attach 测试只断言 KB disabled/存在性，不受图标替换影响；initialCommand 走 banner，不受影响）。

- [ ] **Step 11.5: Commit**

```bash
cd "$P" && git add src/screens/devices/DeviceTerminalScreen.tsx __tests__/DeviceTerminal.voiceFab.test.tsx __tests__/DeviceTerminalScreen.test.tsx
git commit -m "feat(终端): 底部区重构——AI 建议 chips 行+常驻语音悬浮钮+键盘图标开关,live 弹窗入口移除"
```

## Task 12: 移除旧推荐（瘦身 util + 删旧 i18n 键）

**Files:**
- Modify: `src/utils/terminalSuggestions.ts`
- Modify: `__tests__/terminalSuggestions.test.ts`、`__tests__/utils/terminalSuggestions.exports.test.ts`
- Modify: `src/i18n/locales/devices/en.json`、`src/i18n/locales/devices/zh.json`（删 `terminal.voice`）

- [ ] **Step 12.1: 瘦身 util**——`src/utils/terminalSuggestions.ts` 全文替换为（保留安全谓词，modal 与 AI chips 都在用）：

```ts
// Safety predicates for AI-suggested terminal commands. The old
// history/fallback suggestion builder (buildTerminalSuggestions) was removed
// when the terminal moved to server-generated AI suggestions (2026-09); only
// the danger filters remain — consumed by VoiceToBashModal and the AI chips.

const INTERACTIVE_COMMANDS = /^(?:vim|vi|nano|less|more|top|htop|ssh|mysql|psql|python|node|irb|pry)(?:\s|$)/;
export const DANGEROUS_COMMANDS = /\b(?:rm\s+-rf|sudo\s+rm|mkfs|diskutil\s+erase|shutdown|reboot|halt|poweroff)\b/;
const SECRET_MARKERS = /<redacted>|token=|password=|passwd=|secret=|api[_-]?key=/i;

export function isUnsafeSuggestion(command: string) {
  return (
    INTERACTIVE_COMMANDS.test(command) ||
    DANGEROUS_COMMANDS.test(command) ||
    SECRET_MARKERS.test(command)
  );
}
```

- [ ] **Step 12.2: 更新两个 util 测试**——`__tests__/terminalSuggestions.test.ts` 重写为 `isUnsafeSuggestion` 用例（交互式命令 true/`rm -rf` true/`token=` true/`git status` false）；`__tests__/utils/terminalSuggestions.exports.test.ts` 删除 `buildTerminalSuggestions` 的 import 与断言，保留 `DANGEROUS_COMMANDS`/`isUnsafeSuggestion`。

- [ ] **Step 12.3: 删旧 i18n 键**——`devices/en.json` 与 `zh.json` 的 `terminal` 子树删 `"voice"` 行（保留 `voiceCommand`/`retry`）。验证无引用：

```bash
cd "$P" && grep -rn "terminal\.voice\b" src/ | grep -v voiceCommand | grep -v __tests__; echo "exit=$?"
```
预期：无输出（exit 1）。`t('terminal.voice')` 的唯一调用点已在 Task 11 随旧 chip 删除。

- [ ] **Step 12.4: 跑绿 + Commit**

```bash
cd "$P" && npx jest terminalSuggestions --testPathIgnorePatterns="/node_modules/"
git add src/utils/terminalSuggestions.ts __tests__/terminalSuggestions.test.ts __tests__/utils/terminalSuggestions.exports.test.ts src/i18n/locales/devices
git commit -m "refactor(终端): 移除旧历史/静态推荐 builder 与 devices:terminal.voice 旧键"
```

## Task 13: 全量回归 + 类型检查

- [ ] **Step 13.1:**

```bash
cd "$P" && npm run typecheck && echo TS-OK
cd "$P" && npx jest --testPathIgnorePatterns="/node_modules/" 2>&1 | tail -12
```

预期：tsc 0 错；jest 失败清单 = Task 0.3 记录的基线（**不得新增失败**；历史 terminal flake 如复现属基线）。若 `VibeCodingListScreen.longpress` 因 modal stub 断言受影响（不应——initial 模式没动），修到绿。

- [ ] **Step 13.2:** server 侧再全量跑一次（phone 改动可能触发共享契约的测试期望）：

```bash
cd "$S" && npm run test:server 2>&1 | tail -6
```

- [ ] **Step 13.3:** 如有零星修正，逐条 commit（中文 message）。

## Task 14: 合并回主分支

- [ ] **Step 14.1: phone 合并**

```bash
cd /Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangVibeCodingPhone
git merge feat/terminal-voice-suggest-bar
npx jest --testPathIgnorePatterns="/node_modules/" 2>&1 | tail -6   # 主树抽查（可选）
```

- [ ] **Step 14.2: server 合并**

```bash
cd /Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangPhoneServer
git merge feat/commandgen-multi-suggestions
npm run test:server 2>&1 | tail -4
```

- [ ] **Step 14.3: 收尾**——向用户报告：两分支已并 main（未 push/未部署）；部署链 = **server 重启** + **手机 rebuild**（agent 零改）；上线顺序无硬依赖（响应字段纯加法，旧手机 + 新 server 兼容）。

---

## 附：已知坑位清单（执行时对照）

1. worktree 里 jest 必须 `--testPathIgnorePatterns="/node_modules/"`，否则 0 tests 假绿。
2. 组件测试断言中文（jest.setup 钉 zh）。
3. `toHaveBeenLastCalledWith`/`toHaveBeenCalledWith` 做深比较——emulator `sendText` 收到的是 `{focus:false}`（`keepKeyboardProxyFocused` 被 `sendToTerminal` 消化，不下传）。
4. react-test-renderer 的 `findAllByProps({testID})` 会重复计数——断言存在性用 `findByProps`，计数用 `findAll(...).filter(n => n.props.testID === id)`。
5. Animated.loop 组件测试必须 `jest.useFakeTimers()` + afterEach unmount。
6. server 测试若对 commandGen 响应做严格 `toEqual`，记得补 `commands`/`dangerousFlags`。
7. `chipSurface` 若 lint 拒绝 StyleSheet 内函数，提为模块级普通函数。
