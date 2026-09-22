# 终端 AI 悬浮钮 logo 化 + 短按打字/长按说话 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 终端底栏 AI 悬浮钮换 aliang logo(恒定不换图标),手势反转为短按=文字输入、长按=STT、松开=结束;提示词去「麦克风」。

**Architecture:** `TerminalVoiceFab` 从 `TouchableOpacity`(onPress/onLongPress)换成 `Pressable` + 按压计时器(与 `VoiceTextInput` hold-to-talk 同范式),成为纯展示手势分类器,回调由 screen 按 `AiSuggestPhase` 路由到 `useAiCommandSuggestions` 既有 API(hook 零改)。图标恒为 `src/components/visual/Logo.tsx`,相位靠颜色/脉冲/角标 spinner 表达。

**Tech Stack:** React Native 0.7x、`react-native-svg`(Logo 已用)、jest + react-test-renderer(仓库组件测试惯例,**不用** @testing-library)、i18next(zh/en 双语)。

**Spec:** `docs/superpowers/specs/2026-09-22-terminal-fab-logo-holdtalk-design.md`

**仓库纪律(执行者必读)**
- 本计划在 worktree `AliangVibeCodingPhone/.worktrees/terminal-fab-logo-holdtalk`(分支 `feat/terminal-fab-logo-holdtalk`)内执行,所有命令的 cwd = 该 worktree 根。
- worktree 不含 node_modules,jest/tsc 靠向上解析到主仓依赖;**jest 调用必须 pattern 在前、flag 在后**,且带 `--testPathIgnorePatterns="/node_modules/"`(worktree 内 jest 全量会被 `\.worktrees` ignore 规则误伤):
  `npx jest <pattern> --testPathIgnorePatterns="/node_modules/"`
- commit message 一律中文,结尾加 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- 已知基线:全量 jest 有 terminal 相关既有 flake(主仓基线),失败时先判断是否与本改动相关,不相关不追。
- 测试基建事实(已核):`useTheme` 有 Context 默认值(测试无需 provider);jest.setup.js 把 i18n 锁 `zh`;`react-native-svg` 在 transform 白名单内可渲染;组件测试用 `react-test-renderer` + `act`,直接调实例 props 上的回调(见 `src/components/projects/__tests__/FileLongPressMenu.test.tsx`)。

---

### Task 1: i18n 文案去「麦克风」+ 守卫测试

**Files:**
- Modify: `src/i18n/locales/terminal/zh.json`(`aiSuggest.emptyHint`,~line 61)
- Modify: `src/i18n/locales/terminal/en.json`(`aiSuggest.emptyHint`,~line 61)
- Test: `src/components/terminal/__tests__/aiSuggestCopy.test.ts`(新建)

- [ ] **Step 1: 写失败测试(文案守卫)**

新建 `src/components/terminal/__tests__/aiSuggestCopy.test.ts`:

```ts
// 文案守卫(spec 2026-09-22 §4):aiSuggest 命名空间不得再出现「麦克风」/
// mic——图标已是 logo,提示词里的「麦克风」是残留误导。匹配规则:CJK
// 「麦克风」按子串;en 的 mic 大小写不敏感 + 词边界(\bmic\b,不误伤
// command 一类词)。只扫 aiSuggest,不波及 voiceBash 等合法使用处。
import zh from '../../../i18n/locales/terminal/zh.json';
import en from '../../../i18n/locales/terminal/en.json';

const valuesOf = (ns: Record<string, unknown>): string[] =>
  Object.values(ns).filter((v): v is string => typeof v === 'string');

describe('terminal aiSuggest 文案守卫:不提麦克风', () => {
  it.each([
    ['zh', zh.aiSuggest],
    ['en', en.aiSuggest],
  ])('%s 命名空间不含「麦克风」', (_locale, ns) => {
    for (const value of valuesOf(ns as Record<string, unknown>)) {
      expect(value.includes('麦克风')).toBe(false);
    }
  });

  it('en 命名空间不含独立的 mic 一词', () => {
    for (const value of valuesOf(en.aiSuggest as Record<string, unknown>)) {
      expect(/\bmic\b/i.test(value)).toBe(false);
    }
  });

  it('emptyHint 描述新交互(轻点输入 / 长按说话)', () => {
    expect(zh.aiSuggest.emptyHint).toBe('轻点输入命令，长按说出命令');
    expect(en.aiSuggest.emptyHint).toBe('Tap to type a command — hold to speak it');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest aiSuggestCopy --testPathIgnorePatterns="/node_modules/"`
Expected: FAIL——zh 的 `emptyHint` 含「麦克风」断言不通过(旧文案「点右侧麦克风说出命令，长按可输入文字」)。

- [ ] **Step 3: 改两行文案**

`src/i18n/locales/terminal/zh.json`:
```json
    "emptyHint": "轻点输入命令，长按说出命令",
```
`src/i18n/locales/terminal/en.json`:
```json
    "emptyHint": "Tap to type a command — hold to speak it",
```
两文件中其余键一律不动。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest aiSuggestCopy --testPathIgnorePatterns="/node_modules/"`
Expected: PASS(全部用例绿)。

- [ ] **Step 5: Commit**

```bash
git add src/i18n/locales/terminal/zh.json src/i18n/locales/terminal/en.json src/components/terminal/__tests__/aiSuggestCopy.test.ts
git commit -m "终端:aiSuggest 文案去「麦克风」——轻点输入/长按说话新交互 + 守卫测试

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: TerminalVoiceFab——Pressable 手势状态机 + Logo 恒定图标

**Files:**
- Modify: `src/components/terminal/TerminalVoiceFab.tsx`(整体重写,文件保持单一职责:展示 + 手势分类)
- Test: `src/components/terminal/__tests__/TerminalVoiceFab.test.tsx`(新建)

- [ ] **Step 1: 写失败测试(手势状态机 + 渲染断言)**

新建 `src/components/terminal/__tests__/TerminalVoiceFab.test.tsx`:

```tsx
// TerminalVoiceFab 手势状态机 + logo 恒定渲染(spec 2026-09-22)。
// 仓库惯例:react-test-renderer + act,直接调实例 props 上的回调。Pressable
// 的按压语义用 props.onPressIn / props.onPressOut 直呼模拟,fake timers 推进
// 长按阈值(测试传 100ms 短阈值)。
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ActivityIndicator, Pressable } from 'react-native';
import { TerminalVoiceFab } from '../TerminalVoiceFab';
import { Logo } from '../../visual/Logo';

type FabProps = React.ComponentProps<typeof TerminalVoiceFab>;

const renderFab = (overrides: Partial<FabProps> = {}) => {
  const props: FabProps = {
    phase: 'idle',
    disabled: false,
    onShortPress: jest.fn(),
    onHoldStart: jest.fn(),
    onHoldEnd: jest.fn(),
    holdThresholdMs: 100,
    ...overrides,
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<TerminalVoiceFab {...props} />);
  });
  return { renderer, props };
};

const pressableOf = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.findByType(Pressable);

describe('TerminalVoiceFab 手势状态机', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('短按(阈值内松开)→ 只触发 onShortPress', () => {
    const { renderer, props } = renderFab();
    const pressable = pressableOf(renderer);
    act(() => pressable.props.onPressIn());
    act(() => jest.advanceTimersByTime(50));
    act(() => pressable.props.onPressOut());
    expect(props.onShortPress).toHaveBeenCalledTimes(1);
    expect(props.onHoldStart).not.toHaveBeenCalled();
    expect(props.onHoldEnd).not.toHaveBeenCalled();
  });

  it('长按(≥阈值)→ pressIn 侧触发 onHoldStart,松开触发 onHoldEnd,不触发 onShortPress', () => {
    const { renderer, props } = renderFab();
    const pressable = pressableOf(renderer);
    act(() => pressable.props.onPressIn());
    act(() => jest.advanceTimersByTime(100));
    expect(props.onHoldStart).toHaveBeenCalledTimes(1);
    act(() => pressable.props.onPressOut());
    expect(props.onHoldEnd).toHaveBeenCalledTimes(1);
    expect(props.onShortPress).not.toHaveBeenCalled();
  });

  it('阈值差一点松开仍算短按', () => {
    const { renderer, props } = renderFab();
    const pressable = pressableOf(renderer);
    act(() => pressable.props.onPressIn());
    act(() => jest.advanceTimersByTime(99));
    act(() => pressable.props.onPressOut());
    expect(props.onShortPress).toHaveBeenCalledTimes(1);
    expect(props.onHoldStart).not.toHaveBeenCalled();
  });

  it('无配对 pressIn 的 pressOut 是 no-op', () => {
    const { renderer, props } = renderFab();
    act(() => pressableOf(renderer).props.onPressOut());
    expect(props.onShortPress).not.toHaveBeenCalled();
    expect(props.onHoldStart).not.toHaveBeenCalled();
    expect(props.onHoldEnd).not.toHaveBeenCalled();
  });

  it('长按期间多次 advance 只触发一次 onHoldStart;松开只触发一次 onHoldEnd', () => {
    const { renderer, props } = renderFab();
    const pressable = pressableOf(renderer);
    act(() => pressable.props.onPressIn());
    act(() => jest.advanceTimersByTime(500));
    act(() => jest.advanceTimersByTime(500));
    expect(props.onHoldStart).toHaveBeenCalledTimes(1);
    act(() => pressable.props.onPressOut());
    act(() => pressableOf(renderer).props.onPressOut());
    expect(props.onHoldEnd).toHaveBeenCalledTimes(1);
  });

  it('按压中卸载 → 不触发任何回调(计时器随卸载清理)', () => {
    const { renderer, props } = renderFab();
    const pressable = pressableOf(renderer);
    act(() => pressable.props.onPressIn());
    act(() => renderer.unmount());
    act(() => jest.advanceTimersByTime(500));
    expect(props.onHoldStart).not.toHaveBeenCalled();
    expect(props.onHoldEnd).not.toHaveBeenCalled();
    expect(props.onShortPress).not.toHaveBeenCalled();
  });

  it('disabled → Pressable 收到 disabled 且直接调用回调也被短路', () => {
    const { renderer, props } = renderFab({ disabled: true });
    expect(pressableOf(renderer).props.disabled).toBe(true);
    act(() => pressableOf(renderer).props.onPressIn());
    act(() => jest.advanceTimersByTime(200));
    act(() => pressableOf(renderer).props.onPressOut());
    expect(props.onShortPress).not.toHaveBeenCalled();
    expect(props.onHoldStart).not.toHaveBeenCalled();
    expect(props.onHoldEnd).not.toHaveBeenCalled();
  });
});

describe('TerminalVoiceFab 渲染:logo 恒定', () => {
  it('idle/recording/generating/error 四相位 logo 都在,不因相位消失', () => {
    const phases: FabProps['phase'][] = ['idle', 'recording', 'generating', 'error'];
    for (const phase of phases) {
      const { renderer } = renderFab({ phase });
      expect(renderer.root.findAllByType(Logo)).toHaveLength(1);
    }
  });

  it('generating 才出现角标 spinner,其余相位没有', () => {
    const { renderer } = renderFab({ phase: 'idle' });
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
    const gen = renderFab({ phase: 'generating' });
    expect(gen.renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  });

  it('recording 出现脉冲叠层,idle 没有(spec §6 渲染断言)', () => {
    const idle = renderFab({ phase: 'idle' });
    expect(idle.renderer.root.findAllByProps({ testID: 'terminal-voice-fab-pulse' })).toHaveLength(0);
    const rec = renderFab({ phase: 'recording' });
    expect(rec.renderer.root.findAllByProps({ testID: 'terminal-voice-fab-pulse' })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest TerminalVoiceFab --testPathIgnorePatterns="/node_modules/"`
Expected: FAIL——旧组件是 `TouchableOpacity`,没有 `onShortPress/onHoldStart/onHoldEnd/holdThresholdMs` props,`findByType(Pressable)` 抛 "No instances found";渲染断言因图标是 `MicIcon` 而非 `Logo` 失败。(红阶段测试文件对旧组件的类型引用会有 excess-property 报错,无害——jest 走 babel 不做类型检查,失败原因即上述运行时断言;tsc 首次介入在 Task 3 Step 2。)

- [ ] **Step 3: 重写组件**

`src/components/terminal/TerminalVoiceFab.tsx` 整体替换为:

```tsx
// Terminal AI FAB(spec 2026-09-22):短按=文字输入,长按(≥450ms)=STT
// push-to-talk,松开=结束。图标恒为 aliang Logo,任何相位不换图标——相位
// 由表面色/描边(录音红)、脉冲叠层与生成期角标 spinner 表达。纯展示手势
// 分类器:onShortPress/onHoldStart/onHoldEnd 由 screen 接线,并按
// AiSuggestPhase 路由到 useAiCommandSuggestions(hook 自带相位守卫,
// 陈旧闭包最多是被 hook 短路,不会产生错误行为)。
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { Logo } from '../visual/Logo';
import type { AiSuggestPhase } from '../../hooks/useAiCommandSuggestions';

export const HOLD_THRESHOLD_MS = 450;

export interface TerminalVoiceFabProps {
  phase: AiSuggestPhase;
  disabled: boolean;
  /** 短按(未到阈值松开)→ screen 调 openTextInput()。 */
  onShortPress: () => void;
  /** 按住到阈值 → screen 调 startVoice()。 */
  onHoldStart: () => void;
  /** 长按后松开 → screen 按 phase 调 stopVoice()。 */
  onHoldEnd: () => void;
  /** 长按阈值;测试注入短值用,默认 450ms(spec §2)。 */
  holdThresholdMs?: number;
}

export const TerminalVoiceFab: React.FC<TerminalVoiceFabProps> = ({
  phase,
  disabled,
  onShortPress,
  onHoldStart,
  onHoldEnd,
  holdThresholdMs = HOLD_THRESHOLD_MS,
}) => {
  const { theme, isDark } = useTheme();
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

  // 手势状态机:pressActiveRef 保证 pressOut 与 pressIn 配对(滑出/被抢占
  // 触发的 pressOut 也走这里);holdFiredRef 区分短按与长按松开。
  const pressActiveRef = useRef(false);
  const holdFiredRef = useRef(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  // 按压中卸载:清计时器(录音由 hook 的 unmount cancel 兜底)。
  useEffect(() => () => clearHoldTimer(), []);

  const handlePressIn = () => {
    if (disabled) return;
    pressActiveRef.current = true;
    holdFiredRef.current = false;
    clearHoldTimer();
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      holdFiredRef.current = true;
      onHoldStart();
    }, holdThresholdMs);
  };

  const handlePressOut = () => {
    if (!pressActiveRef.current) return;
    pressActiveRef.current = false;
    clearHoldTimer();
    if (holdFiredRef.current) onHoldEnd();
    else onShortPress();
  };

  const recording = phase === 'recording';
  // 表面色沿用 DeviceTerminalScreen 底栏 FAB 的 elevatedSurface/outline 惯用
  // (dark 用半透明白叠层,light 用主题 token),录音/错误态红边红底盖过默认。
  const restingSurface = isDark ? 'rgba(255,255,255,0.06)' : theme.colors.surfaceContainerLowest;
  const restingOutline = isDark ? 'rgba(255,255,255,0.08)' : theme.colors.outlineVariant;

  return (
    <Pressable
      testID="terminal-voice-fab"
      accessibilityRole="button"
      // 颜色/动效不能是唯一指示:无障碍标签随相位播报录音/错误态。
      accessibilityLabel={
        recording
          ? `${t('aiSuggest.voiceFabLabel')}，${t('aiSuggest.listening')}`
          : phase === 'error'
            ? `${t('aiSuggest.voiceFabLabel')}，${t('aiSuggest.errorVoice')}`
            : t('aiSuggest.voiceFabLabel')
      }
      accessibilityHint={t('aiSuggest.emptyHint')}
      accessibilityState={{ disabled, busy: phase === 'generating' }}
      hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[
        styles.fab,
        {
          backgroundColor: recording ? theme.colors.errorContainer : restingSurface,
          borderColor: recording || phase === 'error' ? theme.colors.error : restingOutline,
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
      <Logo size={24} />
      {phase === 'generating' ? (
        <ActivityIndicator size={12} color={theme.colors.primary} style={styles.spinner} />
      ) : null}
    </Pressable>
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
  spinner: { position: 'absolute', right: 6, bottom: 6 },
  disabled: { opacity: 0.45 },
});
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest TerminalVoiceFab --testPathIgnorePatterns="/node_modules/"`
Expected: PASS(手势 7 例 + 渲染 3 例全绿)。

- [ ] **Step 5: Commit**

```bash
git add src/components/terminal/TerminalVoiceFab.tsx src/components/terminal/__tests__/TerminalVoiceFab.test.tsx
git commit -m "终端:AI 悬浮钮换 aliang logo + 短按打字/长按说话(松开结束)手势反转

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: DeviceTerminalScreen 接线 + 既有测试契约改写

> 2026-09-22 执行期扩充(Task 2 评审发现):根目录 `__tests__/` 是主测试目录;`__tests__/DeviceTerminal.voiceFab.test.tsx` 有 3 例断言旧手势契约,必须随接线改写;Task 2 删除的旧组件测试的 a11y/视觉断言须移植进新组件测试。

**Files:**
- Modify: `src/screens/devices/DeviceTerminalScreen.tsx:1687-1698`(FAB JSX)
- Modify: `__tests__/DeviceTerminal.voiceFab.test.tsx`(3 个旧契约用例改写)
- Modify: `src/components/terminal/__tests__/TerminalVoiceFab.test.tsx`(移植 4 条断言)

- [ ] **Step 1: 替换 FAB 接线**

找到 `<TerminalVoiceFab`(约 line 1687),把

```tsx
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
```

替换为(相位路由保留在 screen,与既有注释/惯例一致):

```tsx
                  <TerminalVoiceFab
                    phase={aiSuggest.phase}
                    disabled={!terminalInputEnabled}
                    onShortPress={() => {
                      if (!terminalInputEnabled) return;
                      aiSuggest.openTextInput();
                    }}
                    onHoldStart={() => {
                      if (!terminalInputEnabled) return;
                      aiSuggest.startVoice();
                    }}
                    onHoldEnd={() => {
                      if (!terminalInputEnabled) return;
                      if (aiSuggest.phase === 'recording') aiSuggest.stopVoice();
                    }}
                  />
```

- [ ] **Step 2: 改写 `__tests__/DeviceTerminal.voiceFab.test.tsx` 的 3 个旧契约用例**

该文件 mock 了 `useAiCommandSuggestions`(mockAi)并渲染整屏,通过 `fab().props.*` 驱动 FAB。把以下 3 个用例整体替换(其余用例一律不动):

删除:
- `it('tap starts voice from idle', ...)`(断言 `onPress → startVoice`)
- `it('tap stops voice while recording', ...)`(断言 `onPress → stopVoice`)
- `it('long-press opens the text input', ...)`(断言 `onLongPress → openTextInput`)

替换为(沿用文件既有 harness:`renderScreen()` / `updateScreen()` / `mockAi` / `fab()`):

```tsx
  it('short-press opens the text input', async () => {
    await renderScreen();

    act(() => {
      fab().props.onShortPress();
    });

    expect(mockAi.openTextInput).toHaveBeenCalledTimes(1);
    expect(mockAi.startVoice).not.toHaveBeenCalled();
  });

  it('hold starts voice from idle', async () => {
    await renderScreen();

    act(() => {
      fab().props.onHoldStart();
    });

    expect(mockAi.startVoice).toHaveBeenCalledTimes(1);
    expect(mockAi.stopVoice).not.toHaveBeenCalled();
  });

  it('release while recording stops voice', async () => {
    await renderScreen();
    mockAi.phase = 'recording';
    await updateScreen();

    act(() => {
      fab().props.onHoldEnd();
    });

    expect(mockAi.stopVoice).toHaveBeenCalledTimes(1);
    expect(mockAi.startVoice).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: 向新组件测试移植旧测试的 a11y/视觉断言**

在 `src/components/terminal/__tests__/TerminalVoiceFab.test.tsx` 的「渲染:logo 恒定」describe 内追加(顶部补一行 `import { darkTheme } from '../../../theme/themes/darkTheme';`,与既有 import 排在一起):

```tsx
  // 以下四条移植自被删除的旧根级测试(2026-09-22 评审):颜色/动效不能是
  // 唯一指示,相位还要有 a11y 播报;红边红底与 busy 态是主相位视觉。
  it('recording/error 相位无障碍标签随相位播报', () => {
    const rec = renderFab({ phase: 'recording' });
    const recNode = rec.renderer.root.findByProps({ testID: 'terminal-voice-fab' });
    expect(recNode.props.accessibilityLabel).toContain('正在聆听…');
    const err = renderFab({ phase: 'error' });
    const errNode = err.renderer.root.findByProps({ testID: 'terminal-voice-fab' });
    expect(errNode.props.accessibilityLabel).toContain('语音识别失败');
  });

  it('recording 样式含主题 error 色(红边红底)', () => {
    const rec = renderFab({ phase: 'recording' });
    const recNode = rec.renderer.root.findByProps({ testID: 'terminal-voice-fab' });
    expect(JSON.stringify(recNode.props.style)).toContain(darkTheme.colors.error);
  });

  it('generating 相位 accessibilityState.busy=true,其余相位 false', () => {
    const gen = renderFab({ phase: 'generating' });
    expect(
      gen.renderer.root.findByProps({ testID: 'terminal-voice-fab' }).props.accessibilityState,
    ).toEqual({ disabled: false, busy: true });
    const idle = renderFab({ phase: 'idle' });
    expect(
      idle.renderer.root.findByProps({ testID: 'terminal-voice-fab' }).props.accessibilityState,
    ).toEqual({ disabled: false, busy: false });
  });

  it('generating 无脉冲叠层', () => {
    const gen = renderFab({ phase: 'generating' });
    expect(gen.renderer.root.findAllByProps({ testID: 'terminal-voice-fab-pulse' })).toHaveLength(0);
  });
```

- [ ] **Step 4: 跑相关测试**

Run: `npx jest TerminalVoiceFab --testPathIgnorePatterns="/node_modules/"` → 手势 7 例 + 渲染 7 例全绿;
Run: `npx jest DeviceTerminal.voiceFab --testPathIgnorePatterns="/node_modules/"` → 全绿(改写后 9 例或等量);
Run: `npx jest useAiCommandSuggestions --testPathIgnorePatterns="/node_modules/"` → 全绿(hook 未动,零回归);
Run: `npx jest aiSuggestCopy --testPathIgnorePatterns="/node_modules/"` → 4/4 绿。

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`
Expected: 0 error(旧 `onPress`/`onLongPress` props 已不存在,漏改的调用点会在此暴露)。

- [ ] **Step 6: Commit**

```bash
git add src/screens/devices/DeviceTerminalScreen.tsx __tests__/DeviceTerminal.voiceFab.test.tsx src/components/terminal/__tests__/TerminalVoiceFab.test.tsx
git commit -m "终端:FAB 接线改短按输入/长按录音/松开结束 + 既有接线测试契约改写 + a11y 断言移植

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 全量回归验证

**Files:** 无新改动(纯验证;若抓到回归回对应任务修)。

- [ ] **Step 1: 全量 jest(worktree 调用惯例)**

Run: `npx jest --testPathIgnorePatterns="/node_modules/" 2>&1 | tail -20`
Expected: 通过数 ≥ 主仓基线,失败仅限已知 terminal 既有 flake;不得出现本改动相关失败(aiSuggestCopy / TerminalVoiceFab / 引用 emptyHint 的用例)。

- [ ] **Step 2: 类型检查终验**

Run: `npx tsc --noEmit`
Expected: 0 error。

- [ ] **Step 3: 报告与收尾**

汇总:新增/修改文件清单、测试红→绿证据、全量结果。合并回 main 走 superpowers:finishing-a-development-branch(用户确认合并时机——按惯例未 push 未部署,真机验收靠 rebuild)。
