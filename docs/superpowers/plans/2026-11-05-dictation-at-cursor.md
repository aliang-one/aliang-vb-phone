# 长按麦克风键：光标处实时听写 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 文本模式下长按左侧麦克风键进入 hold-to-talk 听写，识别文字实时插入输入框当前光标处；松手定稿并落光标。

**Architecture:** 纯手机端改动。屏幕层（VibeCodingSessionScreen）持有听写会话状态（ref，不进 state），复用现有 `useVoiceStt` 单例（与语音录制天然互斥）；插入/定稿/还原逻辑抽成 `src/utils/dictation.ts` 纯函数便于单测；MessageComposer 加长按手势、光标上报与 `setSelection` 句柄、屏幕驱动的提示行。服务端与 STT 协议零改动。

**Tech Stack:** React Native (New Arch), TypeScript, jest + react-test-renderer, i18next。

**Spec:** `docs/superpowers/specs/2026-11-05-dictation-at-cursor-design.md`（已过三轮审稿，以 spec 为准）

---

## 工作区与硬约束（每个任务开工前先读这节）

- 本计划在 worktree `/Users/mac/MyProgram/AiProgram/vibe_on_phone/AliangVibeCodingPhone-dictation`（分支 `dictation-at-cursor`）执行，`node_modules` 已软链到主树，jest 直接可用。
- 所有命令在 worktree 根目录执行。
- **Commit message 用中文**，结尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- **VibeCodingSessionScreen 有 hooks 不变量结构测试**（`__tests__/vibecoding/VibeCodingSessionScreen.hooksInvariant.test.ts`）：`if (!session)` 早退守卫（约 2764 行）之后、主 JSX return 之前**禁止新增任何 hook 调用**。放置分区：状态/refs（Step 2）与 watch effects（Step 7）放 `voiceStt` 声明附近（约 600 行一带）；**听写回调（Step 3-6）必须放在 `composerReadOnlyReason` 声明（约 2092 行）之后、守卫之前**——它们的依赖数组引用了 `composerReadOnlyReason` / `shouldDisableComposerForProvider`（约 1292 行），放早了是 use-before-declaration 编译错误。
- jest 基线（worktree 已验证）：`MessageComposer.memo.test.tsx` + `useVoiceStt.test.tsx` 全绿（17 tests）。全量 suite 有已知的顺序污染红（agentTranscript/aboutScreen/localService），**不要跑全量 suite 判回归**，按本计划指定的文件跑。
- 文件行号为 2026-11-05 快照，实施时以符号名定位为准。

---

### Task 1: 听写纯函数 `src/utils/dictation.ts`

**Files:**
- Create: `src/utils/dictation.ts`
- Create: `src/utils/__tests__/dictation.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// src/utils/__tests__/dictation.test.ts
import {
  IDLE_DICTATION,
  applyDictationLive,
  commitDictationText,
  replaceSegment,
  resolveDictationAnchor,
  revertDictation,
  type DictationSession,
} from '../dictation';

describe('replaceSegment', () => {
  it('光标在中间：插入并保留前后文', () => {
    expect(replaceSegment('hello world', 5, 0, ' beautiful')).toBe('hello beautiful world');
  });
  it('光标在末尾：纯追加', () => {
    expect(replaceSegment('hello', 5, 0, ' world')).toBe('hello world');
  });
  it('空 input：直接成为新文本', () => {
    expect(replaceSegment('', 0, 0, 'hi')).toBe('hi');
  });
  it('片段收缩：识别改口变短时正确替换旧片段', () => {
    // "继续帮我" (segLen=4) 改口成 "继续" (incoming=2)
    expect(replaceSegment('继续帮我，然后', 0, 4, '继续')).toBe('继续，然后');
  });
  it('incoming 为空串：片段被清掉（partial 中间态）', () => {
    expect(replaceSegment('AB文案CD', 2, 2, '')).toBe('ABCD');
  });
});

describe('resolveDictationAnchor', () => {
  it('从未聚焦（null selection）：追加到末尾，不取 0', () => {
    expect(resolveDictationAnchor(null, 7)).toEqual({ cursor: 7, segLen: 0 });
  });
  it('空选区：在光标处插入', () => {
    expect(resolveDictationAnchor({ start: 3, end: 3 }, 10)).toEqual({ cursor: 3, segLen: 0 });
  });
  it('非空选区：segLen = 选区长度（首次更新即替换选区）', () => {
    expect(resolveDictationAnchor({ start: 2, end: 5 }, 10)).toEqual({ cursor: 2, segLen: 3 });
  });
});

describe('applyDictationLive（在途片段滑动替换）', () => {
  const base: DictationSession = { active: true, cursor: 0, segLen: 0 };
  it('首次更新：插入 live 并回报新 segLen', () => {
    expect(applyDictationLive(base, '前文', '你好')).toEqual({ input: '你好前文', segLen: 2 });
  });
  it('连续更新：新 live 替换上一段在途片段', () => {
    const s: DictationSession = { active: true, cursor: 0, segLen: 2 };
    expect(applyDictationLive(s, '你好前文', '你好，世界')).toEqual({ input: '你好，世界前文', segLen: 5 });
  });
  it('inactive 时恒等返回（finishWith 尾随空更新不得抹掉已定稿文本）', () => {
    // 真实时序：finishWith 置 liveCaption='' 并同步触发 onComplete（清 active），
    // 随后 effect 才跑 → 此时 session.active=false，必须原样返回。
    const s: DictationSession = { active: false, cursor: 0, segLen: 5 };
    expect(applyDictationLive(s, '已定稿文本', '')).toEqual({ input: '已定稿文本', segLen: 5 });
  });
  it('幂等：同一 live 重复应用不重复插入', () => {
    const s1: DictationSession = { active: true, cursor: 0, segLen: 0 };
    const r1 = applyDictationLive(s1, '', '重复');
    const s2: DictationSession = { active: true, cursor: 0, segLen: r1.segLen };
    expect(applyDictationLive(s2, r1.input, '重复')).toEqual({ input: '重复', segLen: 2 });
  });
});

describe('commitDictationText / revertDictation', () => {
  const session: DictationSession = { active: true, cursor: 2, segLen: 3 };
  it('commit：用权威 final 全文替换在途段并回报落点光标', () => {
    // 在途段显示 "你好呀"(3)，服务端归一化后 full_text = "你好，呀。"
    expect(commitDictationText(session, 'AB你好呀CD', '你好，呀。')).toEqual({
      input: 'AB你好，呀。CD',
      cursor: 2 + '你好，呀。'.length,
    });
  });
  it('revert：清掉在途段还原原文', () => {
    expect(revertDictation(session, 'AB你好呀CD')).toBe('ABCD');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/utils/__tests__/dictation.test.ts`
Expected: FAIL（`Cannot find module '../dictation'`）

- [ ] **Step 3: 最小实现**

```typescript
// src/utils/dictation.ts
// 长按麦克风键听写：光标处实时插入的纯函数集合。
// 设计 spec: docs/superpowers/specs/2026-11-05-dictation-at-cursor-design.md
//
// 屏幕层持有 DictationSession（ref，不进 state），每次 stt.partial 驱动的
// liveCaption 变化调用 applyDictationLive 滑动替换在途片段；stt.completed
// 用 commitDictationText 以权威 final 全文替换（liveCaption 有 120ms 节流、
// finishWith 会丢弃 pending caption 且服务端标点/ITN 可能改写文本，绝不能
// 假设"片段已在位"）；失败用 revertDictation 还原。

export interface DictationSession {
  /** 仅在 start 成功后为 true；commit/revert/错误同步置回 false——liveCaption
   * 的 watch effect 以此门控（finishWith 在 onComplete 前会把 liveCaption
   * 置空，未门控会把已定稿片段抹掉）。 */
  active: boolean;
  /** 听写锚点：input 中的插入起点（选区起点或 input.length）。 */
  cursor: number;
  /** 当前在途片段长度（初始 = 选区长度）。 */
  segLen: number;
}

export const IDLE_DICTATION: DictationSession = { active: false, cursor: 0, segLen: 0 };

export interface TextSelection {
  start: number;
  end: number;
}

/** `input[cursor, cursor+segLen)` 替换为 incoming。 */
export function replaceSegment(
  input: string,
  cursor: number,
  segLen: number,
  incoming: string,
): string {
  return input.slice(0, cursor) + incoming + input.slice(cursor + segLen);
}

/** 听写锚点：null selection（从未聚焦）→ 追加末尾；空选区 → 光标处；
 * 非空选区 → 替换整个选区（同系统键盘听写习惯）。 */
export function resolveDictationAnchor(
  selection: TextSelection | null,
  inputLength: number,
): { cursor: number; segLen: number } {
  if (!selection) return { cursor: inputLength, segLen: 0 };
  const segLen = Math.max(0, selection.end - selection.start);
  return { cursor: selection.start, segLen };
}

/** liveCaption 变化：替换在途片段。inactive 时恒等返回——这是防"尾随空更新
 * 抹掉定稿文本"的唯一闸门，屏幕层 effect 不得绕过它直接调 replaceSegment。 */
export function applyDictationLive(
  session: DictationSession,
  input: string,
  incoming: string,
): { input: string; segLen: number } {
  if (!session.active) return { input, segLen: session.segLen };
  return {
    input: replaceSegment(input, session.cursor, session.segLen, incoming),
    segLen: incoming.length,
  };
}

/** 定稿：用权威 final 全文替换在途段，回报光标应落的偏移。 */
export function commitDictationText(
  session: DictationSession,
  input: string,
  text: string,
): { input: string; cursor: number } {
  return {
    input: replaceSegment(input, session.cursor, session.segLen, text),
    cursor: session.cursor + text.length,
  };
}

/** 失败/空结果：清掉在途段还原原文。 */
export function revertDictation(session: DictationSession, input: string): string {
  return replaceSegment(input, session.cursor, session.segLen, '');
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/utils/__tests__/dictation.test.ts`
Expected: PASS（全部用例绿）

- [ ] **Step 5: Commit**

```bash
git add src/utils/dictation.ts src/utils/__tests__/dictation.test.ts
git commit -m "feat: 听写光标插入纯函数(在途段滑动替换/权威定稿/还原)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: i18n key（zh + en）

**Files:**
- Modify: `src/i18n/locales/vibecoding/zh.json`（`"composer"` 对象内，`"tapToSpeak"` 约 358 行附近）
- Modify: `src/i18n/locales/vibecoding/en.json`（同位置）

- [ ] **Step 1: 加 zh key**

在 `zh.json` 的 `"composer"` 对象里（与 `"tapToSpeak"` 同级）加：

```json
"dictationHint": "正在听写…松手结束",
```

- [ ] **Step 2: 加 en key**

在 `en.json` 的 `"composer"` 对象同位置加：

```json
"dictationHint": "Dictating… release to insert",
```

- [ ] **Step 3: 验证 JSON 合法 + i18n 相关测试**

Run: `node -e "require('./src/i18n/locales/vibecoding/zh.json');require('./src/i18n/locales/vibecoding/en.json');console.log('ok')" && npx jest src/components/vibecoding/__tests__/MessageComposer.memo.test.tsx`
Expected: `ok`，测试 PASS

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/vibecoding/zh.json src/i18n/locales/vibecoding/en.json
git commit -m "feat: 听写提示行 i18n key(zh+en)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: MessageComposer — forwardRef + setSelection 句柄 + 光标上报

**Files:**
- Modify: `src/components/vibecoding/MessageComposer.tsx`
- Create: `src/components/vibecoding/__tests__/MessageComposer.dictation.test.tsx`

背景：`MessageComposer` 当前是 `export const MessageComposer = React.memo(MessageComposerBase)`（约 1094 行）。TextInput 在 text 模式分支渲染（约 601 行），目前无 ref、无 `onSelectionChange`、无 testID。

- [ ] **Step 1: 写失败测试**

```tsx
// src/components/vibecoding/__tests__/MessageComposer.dictation.test.tsx
// 长按听写：composer 侧手势/光标上报/提示行契约。仿 memo.test 的
// TestRenderer + 全 props 构建惯例。
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { MessageComposer } from '../MessageComposer';
import type { MessageComposerProps } from '../MessageComposer';
import type { UseVoiceSttResult } from '../../../hooks/useVoiceStt';

const stableVoiceStt = {
  status: 'idle',
  liveCaption: '',
  errorMessage: '',
  start: jest.fn(),
  stop: jest.fn(),
  cancel: jest.fn(),
} as unknown as UseVoiceSttResult;

function buildProps(overrides: Partial<MessageComposerProps> = {}): MessageComposerProps {
  return {
    mode: 'text',
    onModeChange: jest.fn(),
    input: '',
    onInputChange: jest.fn(),
    voiceDraft: '',
    commands: [],
    voiceStt: stableVoiceStt,
    sendingMessage: false,
    interruptingTurn: false,
    canInterruptTurn: false,
    deviceOffline: false,
    readOnlyReason: undefined,
    autoFocusText: false,
    toolsMenuVisible: false,
    toolsDisabled: false,
    onToggleTools: jest.fn(),
    goalDraft: false,
    goalSession: false,
    showGoalHint: true,
    onTextInputFocus: jest.fn(),
    onVoiceCapture: jest.fn(),
    onVoiceCaptureStart: jest.fn(),
    onVoiceCaptureEnd: jest.fn(),
    onSendVoice: jest.fn(),
    onSendText: jest.fn(),
    onInterruptTurn: jest.fn(),
    onEditVoice: jest.fn(),
    ...overrides,
  } as MessageComposerProps;
}

describe('MessageComposer 听写契约', () => {
  it('TextInput onSelectionChange 经 onComposerSelectionChange 上报', () => {
    const onComposerSelectionChange = jest.fn();
    const tree = TestRenderer.create(
      <MessageComposer {...buildProps({ input: 'hello', onComposerSelectionChange })} />,
    );
    const textInput = tree.root.find(node => node.props.testID === 'composer-text-input');
    act(() => {
      // RN TextInput 的 onSelectionChange 签名
      textInput.props.onSelectionChange({
        nativeEvent: { selection: { start: 2, end: 5 } },
      });
    });
    expect(onComposerSelectionChange).toHaveBeenCalledWith({ start: 2, end: 5 });
  });

  it('ref.setSelection 存在且可调用（透传 TextInput）', () => {
    const ref = React.createRef<{ setSelection: (s: number, e: number) => void }>();
    let tree: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      tree = TestRenderer.create(<MessageComposer ref={ref} {...buildProps()} />);
    });
    // TestRenderer 下底层 TextInput 是 host 组件、ref 为 null，但句柄方法
    // 必须存在且空值安全（内部用 ?. 透传，不抛错）。
    expect(typeof ref.current?.setSelection).toBe('function');
    expect(() => ref.current?.setSelection(1, 1)).not.toThrow();
    tree?.unmount();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/components/vibecoding/__tests__/MessageComposer.dictation.test.tsx`
Expected: FAIL（`composer-text-input` 找不到 / ref 无 setSelection）

- [ ] **Step 3: 实现**

`MessageComposer.tsx` 三处改动：

3a. props 接口（`MessageComposerProps` 尾部）与句柄类型加：

```tsx
export interface MessageComposerHandle {
  /** 定稿后把光标放到插入文本末尾（TextInput ref 透传；未挂载时空安全）。 */
  setSelection: (start: number, end: number) => void;
}
```

props 内加（可选）：

```tsx
  /** 听写：TextInput 选区变化上报（屏幕存 ref 不进 state）。 */
  onComposerSelectionChange?: (selection: { start: number; end: number }) => void;
```

3b. 组件改 forwardRef（`MessageComposerBase` 签名改为接受 ref）：

```tsx
const MessageComposerBase = (
  props: MessageComposerProps,
  ref: React.Ref<MessageComposerHandle>,
) => {
  // ...原函数体...
};
export const MessageComposer = React.memo(
  React.forwardRef<MessageComposerHandle, MessageComposerProps>(MessageComposerBase),
);
```

函数体内加（与现有 refs 一带）：

```tsx
  const textInputRef = useRef<TextInput | null>(null);
  React.useImperativeHandle(
    ref,
    () => ({
      setSelection: (start: number, end: number) => {
        textInputRef.current?.setSelection(start, end);
      },
    }),
    [],
  );
```

3c. TextInput（text 模式分支）加 ref / onSelectionChange / testID：

```tsx
        <TextInput
          ref={textInputRef}
          value={input}
          onChangeText={onInputChange}
          onSelectionChange={e => onComposerSelectionChange?.(e.nativeEvent.selection)}
          testID="composer-text-input"
          // ...其余 props 不动...
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/components/vibecoding/__tests__/MessageComposer.dictation.test.tsx src/components/vibecoding/__tests__/MessageComposer.memo.test.tsx`
Expected: PASS（新用例 + memo 契约不回归——memo(forwardRef) 语义不变）

- [ ] **Step 5: Commit**

```bash
git add src/components/vibecoding/MessageComposer.tsx src/components/vibecoding/__tests__/MessageComposer.dictation.test.tsx
git commit -m "feat: composer forwardRef setSelection 句柄+选区上报

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: MessageComposer — toggle 长按手势（hold-to-talk）

**Files:**
- Modify: `src/components/vibecoding/MessageComposer.tsx`（`renderModeToggle` 约 449-471 行 + props + 组件 refs 区）
- Modify: `src/components/vibecoding/__tests__/MessageComposer.dictation.test.tsx`

关键坑：现 toggle `disabled = isVoiceActive`。听写开始后 status 变 recording →
isVoiceActive → 按钮被禁用 → **松手的 onPressOut 会被吞掉，录音永远停不下来**。
解法：composer 本地 `dictationHolding` state，按住期间豁免禁用。

- [ ] **Step 1: 写失败测试**（追加到 Task 3 的测试文件）

```tsx
describe('MessageComposer toggle 长按手势', () => {
  it('长按触发 onDictationPressIn，不触发 onModeChange；按住期间点按(双指误触)也不切模式', () => {
    const onDictationPressIn = jest.fn();
    const onModeChange = jest.fn();
    const tree = TestRenderer.create(
      <MessageComposer
        {...buildProps({ onDictationPressIn, onModeChange })}
      />,
    );
    const toggle = tree.root.find(node => node.props.testID === 'composer-toggle');
    act(() => toggle.props.onLongPress());
    act(() => toggle.props.onPress()); // 按住期间的双指误触/系统重放
    expect(onDictationPressIn).toHaveBeenCalledTimes(1);
    expect(onModeChange).not.toHaveBeenCalled();
  });

  it('长按后的 onPressOut 触发 onDictationPressOut；普通点按的 onPressOut 不触发', () => {
    const onDictationPressIn = jest.fn();
    const onDictationPressOut = jest.fn();
    const tree = TestRenderer.create(
      <MessageComposer {...buildProps({ onDictationPressIn, onDictationPressOut })} />,
    );
    const toggle = tree.root.find(node => node.props.testID === 'composer-toggle');
    act(() => toggle.props.onPressOut()); // 无长按时：no-op
    expect(onDictationPressOut).not.toHaveBeenCalled();
    act(() => toggle.props.onLongPress());
    act(() => toggle.props.onPressOut()); // 长按后松手
    expect(onDictationPressOut).toHaveBeenCalledTimes(1);
  });

  it('点按仍触发 onModeChange（现行为回归）', () => {
    const onModeChange = jest.fn();
    const onDictationPressIn = jest.fn();
    const tree = TestRenderer.create(
      <MessageComposer {...buildProps({ onModeChange, onDictationPressIn })} />,
    );
    const toggle = tree.root.find(node => node.props.testID === 'composer-toggle');
    act(() => toggle.props.onPress());
    expect(onModeChange).toHaveBeenCalledTimes(1);
    expect(onDictationPressIn).not.toHaveBeenCalled();
  });

  it('只读态（readOnlyReason）长按不触发；未传可选 props 时长按不抛错', () => {
    const onDictationPressIn = jest.fn();
    const tree = TestRenderer.create(
      <MessageComposer
        {...buildProps({ readOnlyReason: '会话只读', onDictationPressIn })}
      />,
    );
    const toggle = tree.root.find(node => node.props.testID === 'composer-toggle');
    act(() => toggle.props.onLongPress());
    expect(onDictationPressIn).not.toHaveBeenCalled();

    const bare = TestRenderer.create(<MessageComposer {...buildProps()} />);
    const bareToggle = bare.root.find(node => node.props.testID === 'composer-toggle');
    expect(() => act(() => bareToggle.props.onLongPress())).not.toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/components/vibecoding/__tests__/MessageComposer.dictation.test.tsx`
Expected: 新增 4 用例 FAIL（props 不存在，onLongPress 为 undefined）

- [ ] **Step 3: 实现**

props 接口加：

```tsx
  /** 听写：文本模式下长按 toggle 进入 hold-to-talk 听写（屏幕启动 STT）。
   * 未传时长按为无操作（保守可选 prop，现无其他消费方）。 */
  onDictationPressIn?: () => void;
  /** 听写：松手结束（屏幕 stop STT）。与 onDictationPressIn 配对。 */
  onDictationPressOut?: () => void;
```

组件 refs/state 区加：

```tsx
  // 听写按住态：长按开始 → 松手结束。作用有二：a) 期间豁免 toggle 的
  // isVoiceActive 禁用（否则 status→recording 置 disabled 后松手的
  // onPressOut 被吞，录音停不下来）；b) 普通点按的 onPressOut 不误触 stop。
  const [dictationHolding, setDictationHolding] = useState(false);
```

`renderModeToggle` 改为：

```tsx
  const renderModeToggle = () => {
    const targetMode: ComposerMode = mode === 'text' ? 'voice' : 'text';
    const iconName: ComposerIconName = mode === 'text' ? 'mic' : 'keyboard';
    const disabled = isVoiceActive && !dictationHolding;
    return (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={mode === 'text' ? t('composer.switchToVoice') : t('composer.switchToText')}
        disabled={disabled}
        onPress={() => {
          // 按住听写期间（含另一根手指误触）不切模式——spec §2「按住期间
          // 禁用防误触切模式」的等价守卫（禁用被按住态豁免了）。
          if (dictationHolding) return;
          onModeChange(targetMode);
        }}
        onLongPress={() => {
          if (composerDisabled || !onDictationPressIn) return;
          setDictationHolding(true);
          onDictationPressIn();
        }}
        onPressOut={() => {
          if (!dictationHolding) return;
          setDictationHolding(false);
          onDictationPressOut?.();
        }}
        testID="composer-toggle"
        style={[styles.ctrlBtn, { borderRadius: theme.borderRadius.full }, ctrlBg]}
      >
        <Animated.View style={{ transform: [{ scale: toggleScale }] }}>
          <ComposerIcon name={iconName} size={20} color={theme.colors.onSurfaceVariant} />
        </Animated.View>
      </TouchableOpacity>
    );
  };
```

（原注释「只读态不禁用切换…G6」保留不动；`disabled` 语义只在听写按住期间放宽。）

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/components/vibecoding/__tests__/MessageComposer.dictation.test.tsx src/components/vibecoding/__tests__/MessageComposer.memo.test.tsx src/components/vibecoding/__tests__/MessageComposer.steer.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/vibecoding/MessageComposer.tsx src/components/vibecoding/__tests__/MessageComposer.dictation.test.tsx
git commit -m "feat: toggle 长按进入听写(hold-to-talk+按住期豁免禁用防松手吞事件)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: MessageComposer — 听写提示行（屏幕驱动 notice）

**Files:**
- Modify: `src/components/vibecoding/MessageComposer.tsx`
- Modify: `src/components/vibecoding/__tests__/MessageComposer.dictation.test.tsx`

背景：容器 `<View style={styles.container}>`（约 845 行）之前的父级 View 里已有
interrupt tabs 等条件块；提示行插在容器正前方，text 模式专用。渲染条件由屏幕
下发的 `dictationNotice` 驱动，**不用 hook status**（hook 'error' 在文本模式
今天什么都不渲染且会一直挂着 → 静默失败，违反"异常必须有状态返回"）。

- [ ] **Step 1: 写失败测试**（追加）

```tsx
describe('MessageComposer 听写提示行', () => {
  it('text 模式 + live notice：显示提示行', () => {
    const tree = TestRenderer.create(
      <MessageComposer
        {...buildProps({
          dictationNotice: { kind: 'live', text: '正在听写…松手结束' },
        })}
      />,
    );
    const row = tree.root.find(node => node.props.testID === 'composer-dictation-notice');
    expect(JSON.stringify(row.props)).toContain('正在听写…松手结束');
  });

  it('text 模式 + error notice：显示错误文案', () => {
    const tree = TestRenderer.create(
      <MessageComposer
        {...buildProps({ dictationNotice: { kind: 'error', text: '未检测到语音' } })}
      />,
    );
    expect(() =>
      tree.root.find(node => node.props.testID === 'composer-dictation-notice'),
    ).not.toThrow();
  });

  it('voice 模式不显示提示行', () => {
    const tree = TestRenderer.create(
      <MessageComposer
        {...buildProps({
          mode: 'voice',
          dictationNotice: { kind: 'live', text: '正在听写…松手结束' },
        })}
      />,
    );
    const found = tree.root.findAll(
      node => node.props.testID === 'composer-dictation-notice',
    );
    expect(found).toHaveLength(0);
  });

  it('不传 dictationNotice 不显示', () => {
    const tree = TestRenderer.create(<MessageComposer {...buildProps()} />);
    const found = tree.root.findAll(
      node => node.props.testID === 'composer-dictation-notice',
    );
    expect(found).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/components/vibecoding/__tests__/MessageComposer.dictation.test.tsx`
Expected: 新增 4 用例 FAIL（找不到 `composer-dictation-notice`）

- [ ] **Step 3: 实现**

props 接口加：

```tsx
  /** 听写提示行（屏幕层 notice 状态驱动，见 spec §3.6.3）：
   * live=听写中提示；error=失败文案。null/undefined 不渲染。 */
  dictationNotice?: { kind: 'live' | 'error'; text: string } | null;
```

JSX：找到容器 `<View style={[styles.container,` 所在行，在其**正前方**（同一父级内）插入：

```tsx
          {dictationNotice && mode === 'text' ? (
            <View
              testID="composer-dictation-notice"
              style={[styles.inlineRow, { marginBottom: 6 }]}
            >
              <Waveform
                active={dictationNotice.kind === 'live'}
                calm
                color={dictationNotice.kind === 'error' ? theme.colors.error : theme.colors.primary}
              />
              <Text
                style={[
                  theme.typography.labelMd,
                  {
                    color:
                      dictationNotice.kind === 'error'
                        ? theme.colors.error
                        : theme.colors.onSurfaceVariant,
                    flexShrink: 1,
                  },
                ]}
                numberOfLines={2}
              >
                {dictationNotice.text}
              </Text>
            </View>
          ) : null}
```

（`Waveform` 为同文件现成组件，签名 `{ active, calm, color }`；`styles.inlineRow` 现成。）

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/components/vibecoding/__tests__/MessageComposer.dictation.test.tsx src/components/vibecoding/__tests__/MessageComposer.memo.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/vibecoding/MessageComposer.tsx src/components/vibecoding/__tests__/MessageComposer.dictation.test.tsx
git commit -m "feat: composer 听写提示行(屏幕 notice 驱动,live/error 两态)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: 屏幕层接线（VibeCodingSessionScreen）

**Files:**
- Modify: `src/screens/vibecoding/VibeCodingSessionScreen.tsx`

**⚠️ hooks 不变量**：本任务新增的全部 hook（useRef/useState/useCallback/useEffect）
必须放在 `if (!session)` 早退守卫**之前**的 hooks 区。改完必须跑
`npx jest __tests__/vibecoding/VibeCodingSessionScreen.hooksInvariant.test.ts`。

改动点（以符号定位，行号为快照参考）：

- [ ] **Step 1: imports 与句柄**

文件头 import 区加：

```tsx
import {
  applyDictationLive,
  commitDictationText,
  IDLE_DICTATION,
  resolveDictationAnchor,
  revertDictation,
  type DictationSession,
} from '../../utils/dictation';
import type { MessageComposerHandle } from '../../components/vibecoding/MessageComposer';
```

- [ ] **Step 2: 状态与 refs**（放在 `const voiceStt = useVoiceStt();`（约 601 行）之后）

```tsx
  // ----- 长按听写（光标处实时插入，spec 2026-11-05）-----
  const composerRef = useRef<MessageComposerHandle | null>(null);
  // TextInput 最新选区（ref 不进 state：每次按键都会变，进 state 会多一帧渲染）。
  const composerSelectionRef = useRef<{ start: number; end: number } | null>(null);
  // 听写会话（ref：partial 逐条更新，进 state 会拖累流式渲染）。
  const dictationRef = useRef<DictationSession>({ ...IDLE_DICTATION });
  const [dictationNotice, setDictationNotice] = useState<{
    kind: 'live' | 'error';
    text: string;
  } | null>(null);
  const dictationNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

- [ ] **Step 3: notice 定时器助手**（放在 handleVoiceCapture 一带回调区，约 1670 行之前）

```tsx
  const clearDictationNotice = useCallback(() => {
    if (dictationNoticeTimerRef.current) {
      clearTimeout(dictationNoticeTimerRef.current);
      dictationNoticeTimerRef.current = null;
    }
    setDictationNotice(null);
  }, []);

  // 错误提示 4s 自动清除（屏幕拥有定时器；hook error 态会挂到下一次 start）。
  const armDictationErrorNotice = useCallback(
    (text: string) => {
      if (dictationNoticeTimerRef.current) clearTimeout(dictationNoticeTimerRef.current);
      setDictationNotice({ kind: 'error', text });
      dictationNoticeTimerRef.current = setTimeout(() => {
        dictationNoticeTimerRef.current = null;
        setDictationNotice(null);
      }, 4000);
    },
    [],
  );
```

- [ ] **Step 4: 光标上报回调**

```tsx
  const handleComposerSelectionChange = useCallback(
    (selection: { start: number; end: number }) => {
      composerSelectionRef.current = selection;
    },
    [],
  );
```

- [ ] **Step 5: pressIn / commit / pressOut**

```tsx
  const handleDictationPressIn = useCallback(() => {
    if (dictationRef.current.active) return;
    if (
      voiceStt.status === 'recording' ||
      voiceStt.status === 'connecting' ||
      voiceStt.status === 'stopping'
    ) {
      return;
    }
    // 只读/离线守卫与语音路径同源（composerDisabled 同口径）。
    if (session?.purpose !== 'goal' && (deviceOffline || shouldDisableComposerForProvider)) {
      return;
    }
    if (composerReadOnlyReason) return;
    const anchor = resolveDictationAnchor(composerSelectionRef.current, input.length);
    dictationRef.current = { active: true, cursor: anchor.cursor, segLen: anchor.segLen };
    if (dictationNoticeTimerRef.current) {
      clearTimeout(dictationNoticeTimerRef.current);
      dictationNoticeTimerRef.current = null;
    }
    setDictationNotice({ kind: 'live', text: t('vibecoding:composer.dictationHint') });
    void voiceStt
      .start({
        sessionId: session?.id,
        projectPath: session?.directory ?? project?.path,
        onComplete: handleDictationComplete,
      })
      .then(started => {
        if (!started) {
          // start 被拒（如上一段录音仍在 stopping）：撤销锚点，还原提示。
          dictationRef.current = { ...IDLE_DICTATION };
          setDictationNotice(null);
        }
      });
  }, [input, voiceStt, session, project, deviceOffline, shouldDisableComposerForProvider, composerReadOnlyReason, t, handleDictationComplete]);
```

实现注意：`input` 直接取闭包值（按住期间用户无法编辑，长按瞬间的 input 即
定稿基准），并进依赖数组——每次按键重建回调，与 composer 现有重渲染节奏一致。
**本屏没有 `inputRef`，不要臆造**。该回调必须声明在 `composerReadOnlyReason`
（约 2092 行）之后。

5b. `handleDictationComplete` **必须声明在 `handleDictationPressIn` 之前**：

```tsx
  // stt.completed / STOP_SAFETY 兜底 / stt.error 携带部分文本 都会走这里。
  // 必须以权威 final 全文 splice 替换在途段（spec §3.2：liveCaption 120ms
  // 节流 + finishWith 丢弃 pending + 服务端标点归一化，"已在位"假设不成立）。
  const handleDictationComplete = useCallback(
    (text: string) => {
      const dictation = dictationRef.current;
      dictationRef.current = { ...IDLE_DICTATION };
      if (!text.trim()) {
        setInput(prev => revertDictation(dictation, prev));
        armDictationErrorNotice(t('common:voice.noSpeechDetected'));
        return;
      }
      setInput(prev => commitDictationText(dictation, prev, text).input);
      const cursor = dictation.cursor + text.length;
      // 值经 React 提交后再落光标；rAF 一拍足够。
      requestAnimationFrame(() => {
        composerRef.current?.setSelection(cursor, cursor);
      });
      setDictationNotice(null);
    },
    [armDictationErrorNotice, t],
  );
```

实现注意：splice 一律走 `setInput(prev => ...)` 函数式更新拿最新 input；
落点 `cursor = dictation.cursor + text.length` 只依赖锚点与文本长度，不依赖
input。`noSpeechDetected` 在 **common** 命名空间（`common/zh.json:73`，hook
同款用法 `common:voice.noSpeechDetected`），vibecoding 命名空间没有 voice
对象。

- [ ] **Step 6: pressOut**

```tsx
  // 无活动听写会话时绝不调 voiceStt.stop()（普通点按 toggle 的松手会走到这）。
  const handleDictationPressOut = useCallback(() => {
    if (!dictationRef.current.active) return;
    void voiceStt.stop();
  }, [voiceStt]);
```

- [ ] **Step 7: 两个 watch effect**（hooks 区，守卫之前）

```tsx
  // stt.partial 驱动：liveCaption 变化 → 在途片段滑动替换。session ref 门控：
  // finishWith 在 onComplete 前把 liveCaption 置空，此 effect 若在 commit 之后
  // 运行会拿到 inactive → applyDictationLive 恒等返回（Task 1 单测固化）。
  useEffect(() => {
    const dictation = dictationRef.current;
    if (!dictation.active) return;
    const next = applyDictationLive(dictation, input, voiceStt.liveCaption);
    if (next.input === input && next.segLen === dictation.segLen) return;
    dictation.segLen = next.segLen;
    setInput(next.input);
  }, [input, voiceStt.liveCaption]);

  // 失败感知（failWith 不触发 onComplete，只能走 status watch）：
  // revert 原文 + 错误提示 4s。异常必须有状态返回（硬规则）。
  useEffect(() => {
    const dictation = dictationRef.current;
    if (!dictation.active) return;
    if (voiceStt.status !== 'error') return;
    dictationRef.current = { ...IDLE_DICTATION };
    setInput(prev => revertDictation(dictation, prev));
    armDictationErrorNotice(
      voiceStt.errorMessage || t('vibecoding:composer.voiceError'),
    );
  }, [voiceStt.status, voiceStt.errorMessage, armDictationErrorNotice, t]);
```

- [ ] **Step 8: 清理与既有回调收口**

- 屏幕层**没有**卸载停录 effect（mic 清理在 `useVoiceStt` 内部自己的 unmount
  cleanup 里，`useVoiceStt.ts:258`）。新增一个专职卸载清理 effect（放 Step 7
  两个 watch effect 旁，守卫之前）：

  ```tsx
  // 卸载：清提示定时器 + 复位听写会话（mic/socket 由 useVoiceStt 自身清理）。
  useEffect(
    () => () => {
      if (dictationNoticeTimerRef.current) clearTimeout(dictationNoticeTimerRef.current);
      dictationRef.current = { ...IDLE_DICTATION };
    },
    [],
  );
  ```

- 现有 `voiceStt.stop()` 的三个调用点不必为听写改动（听写与语音共用互斥状态，
  `enterGoalDraft` 约 1337 行 / `handleVoiceCaptureEnd` 约 1709 行 /
  `handleInterruptTurn` 约 2166 行的 stop 在听写激活时同样适用，无需额外收口）。
- 现有 `handleComposerModeChange`（`onModeChange={handleComposerModeChange}` 的
  实现）体内加：`clearDictationNotice();`（模式切换提前清除错误提示）。
- 确认上述所有新增 hook 都在 `if (!session)` 守卫（约 2764 行）之前。

- [ ] **Step 9: 渲染点接线**（`<MessageComposer` 约 4141 行）

```tsx
          <MessageComposer
            ref={composerRef}
            // ...现有 props 全部保留...
            onComposerSelectionChange={handleComposerSelectionChange}
            onDictationPressIn={handleDictationPressIn}
            onDictationPressOut={handleDictationPressOut}
            dictationNotice={dictationNotice}
          />
```

- [ ] **Step 10: 验证**

Run:
```bash
npx jest __tests__/vibecoding/VibeCodingSessionScreen.hooksInvariant.test.ts src/utils/__tests__/dictation.test.ts src/components/vibecoding/__tests__/MessageComposer.dictation.test.tsx src/components/vibecoding/__tests__/MessageComposer.memo.test.tsx __tests__/useVoiceStt.test.tsx
npx tsc --noEmit 2>&1 | head -20
```
Expected: jest 全 PASS；tsc 无新增错误（存量错误若与本次文件无关则忽略，但
`VibeCodingSessionScreen.tsx` / `MessageComposer.tsx` / `dictation.ts` 必须零错误）。

- [ ] **Step 11: Commit**

```bash
git add src/screens/vibecoding/VibeCodingSessionScreen.tsx
git commit -m "feat: 会话屏接线长按听写(锚定光标/实时滑动替换/权威定稿/错误还原)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: 收尾验证

- [ ] **Step 1: 全相关测试**

```bash
npx jest src/utils/__tests__/dictation.test.ts \
  src/components/vibecoding/__tests__/MessageComposer.dictation.test.tsx \
  src/components/vibecoding/__tests__/MessageComposer.memo.test.tsx \
  src/components/vibecoding/__tests__/MessageComposer.attachments.test.tsx \
  src/components/vibecoding/__tests__/MessageComposer.steer.test.tsx \
  __tests__/VoiceTextInput.test.tsx \
  __tests__/useVoiceStt.test.tsx __tests__/useVoiceStt.silence.test.tsx \
  __tests__/vibecoding/VibeCodingSessionScreen.hooksInvariant.test.ts
```
Expected: 全 PASS

- [ ] **Step 2: lint（只看本次触碰的文件）**

```bash
npx eslint src/utils/dictation.ts src/utils/__tests__/dictation.test.ts src/components/vibecoding/MessageComposer.tsx src/components/vibecoding/__tests__/MessageComposer.dictation.test.tsx src/screens/vibecoding/VibeCodingSessionScreen.tsx
```
Expected: 无 error（warning 逐条判断是否存量）

- [ ] **Step 3: TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep -E "dictation|MessageComposer|VibeCodingSessionScreen" | head
```
Expected: 无输出（这三个文件零类型错误）

- [ ] **Step 4: 提交收尾（如有 lint 顺手修）+ 汇报**

若全部绿且无未提交变更则跳过 commit。汇报内容包含：改动文件清单、测试结果原样输出、已知未覆盖项（真机手势实测）。

---

## 明确不做（与 spec §5 一致）

- 不改服务端 / STT 协议；不迁百炼 DashScope；不做上下文增强/热词。
- 不动语音模式任何交互；不做"听写转 AI 润色"。

## 真机验收清单（出包后人工 smoke，不在本计划自动化范围）

1. 文本模式打字到一半，光标停在中间 → 长按麦克风键说话 → 文字实时出现在光标处，前后文不丢。
2. 松手 → 定稿，光标落在插入文本末尾。
3. 长按后不说话松手 → 原文还原 + 错误提示 4s 消失。
4. 点按麦克风键 → 仍切换语音模式（回归）。
5. 语音模式原有 hold-to-talk / 编辑回填不受影响（回归）。
6. 只读会话长按 → 无反应（守卫）。
