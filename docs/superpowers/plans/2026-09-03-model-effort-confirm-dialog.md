# 创建 VibeCoding 模型/Effort 二次确认弹窗 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建页 Start 时,若 model/effort 任一未手动指定,弹出确认弹窗展示将生效值+来源;同时修复 resolver 跨 provider 污染(缺陷 A)与 Me 默认 provider 不生效(缺陷 B)。

**Architecture:** server resolver 加 provider 一致性门控;手机端新增镜像纯函数(与 server 同规则,测试对齐)、基于现有 `BottomSheet` 的 `ModelConfirmSheet`、创建页 `handleCreate` 分流 + provider 预填。draftConfig/server API 契约零改。

**Tech Stack:** RN + TypeScript + zustand(store)/i18next;server Node + vitest;phone jest + react-test-renderer。

**Spec:** `docs/superpowers/specs/2026-09-03-model-effort-confirm-dialog-design.md`

**仓库与工作方式:**
- Task 1 在 `AliangPhoneServer/`(独立 git 仓,main)
- Task 2-6 在 `AliangVibeCodingPhone/`(独立 git 仓,main)
- 各仓测试命令:server `npm test`(vitest run);phone `npm test`(jest)、`npm run typecheck`(tsc --noEmit)
- commit message 一律中文(项目约定)
- phone 仓 `jest.setup.js` 已 mock reanimated;RN Modal 在测试中渲染 children(仓 preset),勿自行 requireActual mock react-native

---

### Task 1: Server resolver 加 provider 一致性门控(缺陷 A)

**Files:**
- Modify: `AliangPhoneServer/server/src/modelConfig.ts`(`resolveEffectiveModelConfig`,约 L60-115)
- Test: `AliangPhoneServer/server/test/modelConfig.test.ts`(已有 `dev/sess/user` 三个 builder)

- [ ] **Step 1: 写失败测试**

在 `server/test/modelConfig.test.ts` 的 `describe('resolveEffectiveModelConfig', ...)` 内追加(复用文件顶部已有的 `sess/user/dev` builder):

```ts
  it('Me default does not leak across providers (provider mismatch -> CLI default)', () => {
    const r = resolveEffectiveModelConfig(
      sess({ provider: 'codex' }),
      user({ defaultProvider: 'claude_code', defaultModel: 'glm-5.2', defaultEffort: 'high' }),
      dev(),
    );
    expect(r.provider).toBe('codex');
    expect(r.model).toBeUndefined();
    expect(r.effort).toBeUndefined();
    expect(r.source.model).toBe('cli');
    expect(r.source.effort).toBe('cli');
  });

  it('Me default applies when session provider matches Me default provider', () => {
    const r = resolveEffectiveModelConfig(
      sess({ provider: 'claude_code' }),
      user({ defaultProvider: 'claude_code', defaultModel: 'glm-5.2', defaultEffort: 'high' }),
      dev(),
    );
    expect(r.provider).toBe('claude_code');
    expect(r.model).toBe('glm-5.2');
    expect(r.effort).toBe('high');
    expect(r.source.model).toBe('user');
    expect(r.source.effort).toBe('user');
  });

  it('Me default still applies when user set no default provider', () => {
    const r = resolveEffectiveModelConfig(
      sess({ provider: 'codex' }),
      user({ defaultModel: 'glm-5.2', defaultEffort: 'high' }),
      dev(),
    );
    expect(r.model).toBe('glm-5.2');
    expect(r.effort).toBe('high');
    expect(r.source.model).toBe('user');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd AliangPhoneServer && npx vitest run server/test/modelConfig.test.ts`
Expected: FAIL — 第 1 个新用例断言 `model` 为 `undefined` 但现状返回 `'glm-5.2'`(污染);后两个用例可能已 PASS(现状行为)。

- [ ] **Step 3: 实现门控**

`server/src/modelConfig.ts` 中 `resolveEffectiveModelConfig`,在 provider 解析循环之后、`valueLayers` 定义处,将:

```ts
  const valueLayers: Layer[] = [
    { name: 'session', model: session.model, effort: session.effort },
    user
      ? { name: 'user', model: user.defaultModel, effort: user.defaultEffort }
      : { name: 'user' },
  ];
```

改为:

```ts
  // Me 页默认是针对 defaultProvider 配的整体偏好:会话选了别的 provider 时
  // 不适用(否则会把 A 家模型塞进 B 家 CLI)。defaultProvider 未设 = 全局偏好,
  // 仍然适用;provider 完全未知时也无从冲突,放行。
  const userProvider = normalizeProvider(user?.defaultProvider);
  const meApplies = !userProvider || !providerValue || userProvider === providerValue;
  const valueLayers: Layer[] = [
    { name: 'session', model: session.model, effort: session.effort },
    meApplies && user
      ? { name: 'user', model: user.defaultModel, effort: user.defaultEffort }
      : { name: 'user' },
  ];
```

- [ ] **Step 4: 跑测试确认全过 + 全量回归**

Run: `npx vitest run server/test/modelConfig.test.ts` → 3 新用例 PASS,存量用例(含 'empty session -> inherits user default',其 session 无 provider、user.defaultProvider=codex,门控放行)不回归。spec §3 表中第 4 例「session 显式 model 恒 session 来源」由存量用例 'session override wins' 覆盖(该用例恰为 provider 不一致 + session 显式,门控不影响显式覆盖),无需新增。
Run: `npm test` → 全量 PASS。

- [ ] **Step 5: Commit**

```bash
cd AliangPhoneServer
git add server/src/modelConfig.ts server/test/modelConfig.test.ts
git commit -m "fix: 模型默认解析加 provider 一致性门控,Me 偏好不再跨 provider 渗入 CLI"
```

---

### Task 2: 手机端镜像 resolver + 单测

**Files:**
- Create: `AliangVibeCodingPhone/src/utils/effectiveModelConfig.ts`
- Test: `AliangVibeCodingPhone/__tests__/effectiveModelConfig.test.ts`

- [ ] **Step 1: 写失败测试**

`__tests__/effectiveModelConfig.test.ts`:

```ts
import { resolveEffectiveModelChoice } from '../src/utils/effectiveModelConfig';

describe('resolveEffectiveModelChoice', () => {
  it('跨 provider 的 Me 默认不渗入:落 CLI 默认,meApplies=false', () => {
    const r = resolveEffectiveModelChoice('codex', undefined, undefined, {
      provider: 'claude_code',
      model: 'glm-5.2',
      effort: 'high',
    });
    expect(r.model).toBeUndefined();
    expect(r.effort).toBeUndefined();
    expect(r.modelSource).toBe('cli');
    expect(r.effortSource).toBe('cli');
    expect(r.meApplies).toBe(false);
  });

  it('provider 与 Me 默认一致:继承 Me 的 model/effort,来源 me', () => {
    const r = resolveEffectiveModelChoice('claude_code', undefined, undefined, {
      provider: 'claude_code',
      model: 'glm-5.2',
      effort: 'high',
    });
    expect(r.model).toBe('glm-5.2');
    expect(r.effort).toBe('high');
    expect(r.modelSource).toBe('me');
    expect(r.effortSource).toBe('me');
    expect(r.meApplies).toBe(true);
  });

  it('Me 未设 provider:model/effort 视为全局偏好仍适用', () => {
    const r = resolveEffectiveModelChoice('codex', undefined, undefined, {
      model: 'gpt-5.4',
      effort: 'high',
    });
    expect(r.model).toBe('gpt-5.4');
    expect(r.modelSource).toBe('me');
    expect(r.meApplies).toBe(true);
  });

  it('手动指定优先于 Me 默认,逐字段独立标来源', () => {
    const r = resolveEffectiveModelChoice('codex', 'gpt-5.4', undefined, {
      provider: 'codex',
      model: 'gpt-5.5',
      effort: 'high',
    });
    expect(r.model).toBe('gpt-5.4');
    expect(r.modelSource).toBe('manual');
    expect(r.effort).toBe('high');
    expect(r.effortSource).toBe('me');
  });

  it('Me 全空:落 CLI 默认;undefined 的 meDefault 同样处理', () => {
    for (const me of [undefined, { provider: null, model: null, effort: null }]) {
      const r = resolveEffectiveModelChoice('codex', undefined, undefined, me);
      expect(r.model).toBeUndefined();
      expect(r.modelSource).toBe('cli');
      expect(r.meApplies).toBe(true);
    }
  });

  it('空串/空白等价于未指定(与 server cleaned 语义对齐)', () => {
    const r = resolveEffectiveModelChoice('codex', '  ', '', { model: 'gpt-5.4' });
    expect(r.model).toBe('gpt-5.4');
    expect(r.modelSource).toBe('me');
  });

  it('provider 别名归一化:claude/claudecode 视为 claude_code', () => {
    const r = resolveEffectiveModelChoice('claude_code', undefined, undefined, {
      provider: 'claudecode',
      model: 'glm-5.2',
    });
    expect(r.model).toBe('glm-5.2');
    expect(r.meApplies).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd AliangVibeCodingPhone && npx jest __tests__/effectiveModelConfig.test.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现**

`src/utils/effectiveModelConfig.ts`:

```ts
import { normalizeProvider, type EffortProvider } from './modelIntensity';

/** 弹窗来源标注:本次手动选择 / Me 页默认 / CLI(或 provider)内置默认。 */
export type ModelChoiceSource = 'manual' | 'me' | 'cli';

/** Me 页个人默认(与 /api/me/model-options 的 user_default 同形,均可空)。 */
export interface MeModelDefault {
  provider?: string | null;
  model?: string | null;
  effort?: string | null;
}

export interface ResolvedModelChoice {
  provider: EffortProvider;
  /** undefined = 该字段落 provider 内置默认(CLI 默认)。 */
  model: string | undefined;
  effort: string | undefined;
  modelSource: ModelChoiceSource;
  effortSource: ModelChoiceSource;
  /** Me 偏好(provider 一致性门控后)是否适用。 */
  meApplies: boolean;
}

/**
 * 手机端镜像 server 的 resolveEffectiveModelConfig
 * (AliangPhoneServer server/src/modelConfig.ts)。规则必须逐字对齐——
 * 确认弹窗展示什么,server 实际就执行什么。规则:
 *   effective.model  = 手动 || (Me 适用 ? Me.model : 无) || CLI 默认
 *   Me 适用 = Me.provider 未设 或 归一化后与已选 provider 一致
 */
export const resolveEffectiveModelChoice = (
  provider: EffortProvider,
  manualModel: string | undefined,
  manualEffort: string | undefined,
  meDefault: MeModelDefault | undefined,
): ResolvedModelChoice => {
  const clean = (v?: string | null): string | undefined => {
    const s = (v ?? '').trim();
    return s ? s : undefined;
  };
  const meProvider = normalizeProvider(meDefault?.provider ?? undefined);
  const meApplies = !meProvider || meProvider === provider;
  const meModel = meApplies ? clean(meDefault?.model) : undefined;
  const meEffort = meApplies ? clean(meDefault?.effort) : undefined;
  const model = clean(manualModel);
  const effort = clean(manualEffort);
  return {
    provider,
    model: model ?? meModel,
    effort: effort ?? meEffort,
    modelSource: model ? 'manual' : meModel ? 'me' : 'cli',
    effortSource: effort ? 'manual' : meEffort ? 'me' : 'cli',
    meApplies,
  };
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest __tests__/effectiveModelConfig.test.ts` → 7 用例 PASS。

- [ ] **Step 5: Commit**

```bash
cd AliangVibeCodingPhone
git add src/utils/effectiveModelConfig.ts __tests__/effectiveModelConfig.test.ts
git commit -m "feat: 新增手机端模型默认镜像 resolver(与 server 门控规则对齐)"
```

---

### Task 3: MainTabs 导航类型前提

**Files:**
- Modify: `AliangVibeCodingPhone/src/app/navigation/types.ts:3-8`

- [ ] **Step 1: 改类型**

`types.ts` 顶部 import 增加 `NavigatorScreenParams`(来自 `@react-navigation/native`),并将 `MainTabs: undefined;` 改为:

```ts
  // 带 screen 参数跳转(Me 页引导)需要嵌套参数类型;undefined 会让
  // push('MainTabs', { screen: 'Account' }) 无法类型通过。
  MainTabs: NavigatorScreenParams<MainTabParamList>;
```

(`MainTabParamList` 已在本文件 L60 定义,含 `Account`;注意它声明在 `RootStackParamList` 之后,TS 类型别名无提升问题,直接引用即可。)

- [ ] **Step 2: 类型检查**

Run: `cd AliangVibeCodingPhone && npm run typecheck`
Expected: exit 0。若现有对 `MainTabs` 的调用点因参数类型报错(理论上不会——`undefined` 参数对新类型仍合法,因 `NavigatorScreenParams` 允许无参 navigate),按报错最小修复。

- [ ] **Step 3: Commit**

```bash
git add src/app/navigation/types.ts
git commit -m "chore: RootStackParamList.MainTabs 改为嵌套参数类型,支持带 screen 跳转"
```

---

### Task 4: ModelConfirmSheet 组件 + i18n + 组件测试

**Files:**
- Create: `AliangVibeCodingPhone/src/components/vibecoding/ModelConfirmSheet.tsx`
- Modify: `AliangVibeCodingPhone/src/i18n/locales/vibecoding/zh.json`、`en.json`(createScreen 下新增 `confirmSheet` 子树)
- Test: `AliangVibeCodingPhone/__tests__/ModelConfirmSheet.test.tsx`

- [ ] **Step 1: 加 i18n key**

`src/i18n/locales/vibecoding/zh.json` 的 `createScreen` 对象内追加:

```json
"confirmSheet": {
  "title": "确认模型配置",
  "subtitle": "即将以 {{provider}} 启动",
  "modelLabel": "模型",
  "effortLabel": "推理力度",
  "sourceManual": "本次选择",
  "sourceMe": "Me 页默认",
  "sourceCli": "CLI 默认",
  "cliModelValue": "provider 内置默认",
  "noMeHint": "当前未应用个人默认模型，可在 Me 页配置",
  "btnConfirm": "确认开始",
  "btnBack": "返回修改",
  "btnGoMe": "去 Me 页设置",
  "btnStartAnyway": "仍用默认开始"
}
```

`en.json` 同位置:

```json
"confirmSheet": {
  "title": "Confirm model settings",
  "subtitle": "Starting with {{provider}}",
  "modelLabel": "Model",
  "effortLabel": "Effort",
  "sourceManual": "Your choice",
  "sourceMe": "Me-page default",
  "sourceCli": "CLI default",
  "cliModelValue": "provider built-in default",
  "noMeHint": "No personal default applied — configure one on the Me page",
  "btnConfirm": "Start",
  "btnBack": "Edit settings",
  "btnGoMe": "Open Me settings",
  "btnStartAnyway": "Start anyway"
}
```

- [ ] **Step 2: 写失败测试**

`__tests__/ModelConfirmSheet.test.tsx`(照抄 `__tests__/CreateVibeCodingScreen.test.tsx` 的 `wrap`/ThemeContext/SafeAreaProvider 基建;jest.setup 已把 locale 钉在 zh,断言用中文字符串):

```tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';

const mockUserDefault: Record<string, unknown> = { provider: null, model: null, effort: null };
jest.mock('../src/hooks/useModelOptions', () => ({
  useModelOptions: () => ({ providerCatalog: [], userDefault: mockUserDefault, refresh: jest.fn() }),
}));

import { ModelConfirmSheet } from '../src/components/vibecoding/ModelConfirmSheet';

const wrap = async (ui: React.ReactElement) => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <ThemeContext.Provider value={{ theme: utilityMinimalist, mode: 'light', setMode: jest.fn(), isDark: false }}>
        <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, right: 0, bottom: 0, left: 0 } }}>
          {ui}
        </SafeAreaProvider>
      </ThemeContext.Provider>,
    );
    await Promise.resolve();
  });
  return renderer!;
};
const touchByTestID = (root: ReactTestRenderer.ReactTestInstance, testID: string) =>
  root.findAllByType(TouchableOpacity).find(c => c.props?.testID === testID);
const tap = (root: ReactTestRenderer.ReactTestRenderer, testID: string) => {
  const btn = touchByTestID(root.root, testID);
  act(() => { btn?.props?.onPress?.(); });
};
const allText = (root: ReactTestRenderer.ReactTestRenderer): string =>
  root.root.findAllByType(Text).map(t => {
    const c = t.props.children;
    return Array.isArray(c) ? c.join('') : String(c ?? '');
  }).join(' ');

const baseProps = {
  open: true,
  onClose: jest.fn(),
  provider: 'codex' as const,
  manualModel: '',
  manualEffort: '',
  onConfirm: jest.fn(),
  onGoToMeSettings: jest.fn(),
};

describe('ModelConfirmSheet', () => {
  beforeEach(() => {
    Object.keys(mockUserDefault).forEach(k => delete mockUserDefault[k]);
    Object.assign(mockUserDefault, { provider: null, model: null, effort: null });
  });

  it('Me 有默认:展示解析值+「Me 页默认」来源,按钮组=确认/返回修改', async () => {
    Object.assign(mockUserDefault, { provider: 'codex', model: 'gpt-5.4', effort: 'high' });
    const root = await wrap(<ModelConfirmSheet {...baseProps} />);
    expect(allText(root)).toContain('gpt-5.4');
    expect(allText(root)).toContain('Me 页默认');
    expect(allText(root)).toContain('high');
    expect(touchByTestID(root.root, 'sheet-btn-confirm')).toBeTruthy();
    expect(touchByTestID(root.root, 'sheet-btn-back')).toBeTruthy();
    expect(touchByTestID(root.root, 'sheet-btn-go-me')).toBeUndefined();
  });

  it('Me 空:展示「provider 内置默认/CLI 默认」+引导提示,按钮组=去设置/仍用默认', async () => {
    const root = await wrap(<ModelConfirmSheet {...baseProps} />);
    expect(allText(root)).toContain('provider 内置默认');
    expect(allText(root)).toContain('可在 Me 页配置');
    expect(touchByTestID(root.root, 'sheet-btn-go-me')).toBeTruthy();
    expect(touchByTestID(root.root, 'sheet-btn-start-anyway')).toBeTruthy();
    expect(touchByTestID(root.root, 'sheet-btn-confirm')).toBeUndefined();
  });

  it('跨 provider:Me 默认不适用,标 CLI 默认且出现引导', async () => {
    Object.assign(mockUserDefault, { provider: 'claude_code', model: 'glm-5.2', effort: 'high' });
    const root = await wrap(<ModelConfirmSheet {...baseProps} />);
    expect(allText(root)).not.toContain('glm-5.2');
    expect(allText(root)).toContain('CLI 默认');
    expect(touchByTestID(root.root, 'sheet-btn-go-me')).toBeTruthy();
  });

  it('手动指定字段标「本次选择」,未指定字段按 Me/CLI 解析', async () => {
    Object.assign(mockUserDefault, { provider: 'codex', model: 'gpt-5.4', effort: 'high' });
    const root = await wrap(<ModelConfirmSheet {...baseProps} manualModel="gpt-5.5" />);
    expect(allText(root)).toContain('gpt-5.5');
    expect(allText(root)).toContain('本次选择');
    expect(allText(root)).toContain('high');
  });

  it('回调:确认/仍用默认→onConfirm;返回修改→onClose;去设置→onGoToMeSettings', async () => {
    const onClose = jest.fn();
    const onConfirm = jest.fn();
    const onGoToMeSettings = jest.fn();
    const meEmpty = await wrap(
      <ModelConfirmSheet {...baseProps} onClose={onClose} onConfirm={onConfirm} onGoToMeSettings={onGoToMeSettings} />,
    );
    tap(meEmpty, 'sheet-btn-start-anyway');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    tap(meEmpty, 'sheet-btn-go-me');
    expect(onGoToMeSettings).toHaveBeenCalledTimes(1);

    Object.assign(mockUserDefault, { provider: 'codex', model: 'gpt-5.4', effort: 'high' });
    const meSet = await wrap(
      <ModelConfirmSheet {...baseProps} onClose={onClose} onConfirm={onConfirm} onGoToMeSettings={onGoToMeSettings} />,
    );
    tap(meSet, 'sheet-btn-confirm');
    expect(onConfirm).toHaveBeenCalledTimes(2);
    tap(meSet, 'sheet-btn-back');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('open=false 不渲染内容', async () => {
    const root = await wrap(<ModelConfirmSheet {...baseProps} open={false} />);
    expect(allText(root)).not.toContain('确认模型配置');
  });
});
```

注意:若 `ModelConfirmSheet` 需要 `meDefault` 直读 props 而非 `useModelOptions`,以实现为准调整 mock;本计划让组件内部 `useModelOptions()`(模块缓存,零请求),与创建页同源。

- [ ] **Step 3: 跑测试确认失败**

Run: `npx jest __tests__/ModelConfirmSheet.test.tsx`
Expected: FAIL(组件不存在)。

- [ ] **Step 4: 实现组件**

`src/components/vibecoding/ModelConfirmSheet.tsx`:

```tsx
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from '../shared/BottomSheet';
import { GlowButton } from '../shared/GlowButton';
import { useTheme } from '../../theme/useTheme';
import { useModelOptions } from '../../hooks/useModelOptions';
import { resolveEffectiveModelChoice } from '../../utils/effectiveModelConfig';
import { providerLabel, type EffortProvider } from '../../utils/modelIntensity';

/**
 * 创建页 Start 时的模型/effort 二次确认弹窗。仅在 model/effort 任一未手动
 * 指定时由创建页打开;展示将生效值及其来源(与 server resolver 同规则,
 * 见 effectiveModelConfig.ts),Me 无适用默认时引导去 Me 页配置。
 */
export const ModelConfirmSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  provider: EffortProvider;
  manualModel: string;
  manualEffort: string;
  onConfirm: () => void;
  onGoToMeSettings: () => void;
}> = ({ open, onClose, provider, manualModel, manualEffort, onConfirm, onGoToMeSettings }) => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('vibecoding');
  const { userDefault } = useModelOptions();
  const choice = resolveEffectiveModelChoice(provider, manualModel, manualEffort, userDefault);
  const hasMeSource = choice.modelSource === 'me' || choice.effortSource === 'me';
  // BottomSheet 关闭动画期间 children 仍挂载约 240ms;内容随 open 立即收起,
  // 既避免视觉残留,也让测试能同步断言「已关闭」(无需 fake timers)。
  const visible = open;

  const sourceText = (s: 'manual' | 'me' | 'cli') =>
    s === 'manual' ? t('createScreen.confirmSheet.sourceManual')
    : s === 'me' ? t('createScreen.confirmSheet.sourceMe')
    : t('createScreen.confirmSheet.sourceCli');

  const renderRow = (label: string, value: string | undefined, source: 'manual' | 'me' | 'cli', valueTestID: string, sourceTestID: string) => (
    <View style={styles.row}>
      <Text style={[theme.typography.labelSm, { color: theme.colors.onSurfaceVariant }]}>
        {label}
      </Text>
      <Text
        testID={valueTestID}
        style={[theme.typography.bodyMd, { color: theme.colors.onSurface, flexShrink: 1 }]}
        numberOfLines={1}>
        {value ?? t('createScreen.confirmSheet.cliModelValue')}
      </Text>
      <View style={[styles.sourceChip, { borderColor: isDark ? 'rgba(255,255,255,0.12)' : theme.colors.outlineVariant }]}>
        <Text testID={sourceTestID} style={[theme.typography.labelSm, { color: theme.colors.primary }]}>
          {sourceText(source)}
        </Text>
      </View>
    </View>
  );

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t('createScreen.confirmSheet.title')}
      subtitle={t('createScreen.confirmSheet.subtitle', { provider: providerLabel(provider) })}>
      <View style={styles.body}>
        {visible ? renderRow(
          t('createScreen.confirmSheet.modelLabel'),
          choice.model,
          choice.modelSource,
          'sheet-model-value',
          'sheet-model-source',
        ) : null}
        {visible ? renderRow(
          t('createScreen.confirmSheet.effortLabel'),
          choice.effort,
          choice.effortSource,
          'sheet-effort-value',
          'sheet-effort-source',
        ) : null}
        {visible && !hasMeSource ? (
          <Text testID="sheet-no-me-hint" style={[theme.typography.bodySm, { color: theme.colors.onSurfaceVariant }]}>
            {t('createScreen.confirmSheet.noMeHint')}
          </Text>
        ) : null}
        <View style={styles.actions}>
          {!visible ? null : hasMeSource ? (
            <>
              <GlowButton
                title={t('createScreen.confirmSheet.btnBack')}
                onPress={onClose}
                variant="outline"
                style={styles.btn}
                testID="sheet-btn-back"
              />
              <GlowButton
                title={t('createScreen.confirmSheet.btnConfirm')}
                onPress={onConfirm}
                style={styles.btn}
                testID="sheet-btn-confirm"
              />
            </>
          ) : (
            <>
              <GlowButton
                title={t('createScreen.confirmSheet.btnGoMe')}
                onPress={onGoToMeSettings}
                style={styles.btn}
                testID="sheet-btn-go-me"
              />
              <GlowButton
                title={t('createScreen.confirmSheet.btnStartAnyway')}
                onPress={onConfirm}
                variant="outline"
                style={styles.btn}
                testID="sheet-btn-start-anyway"
              />
            </>
          )}
        </View>
      </View>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  body: { gap: 12, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sourceChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 'auto',
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  btn: { flex: 1 },
});
```

实现时两个必须核对的点(执行者注意):
- `GlowButton` 是否透传 `testID` 到内部 TouchableOpacity(`src/components/shared/GlowButton.tsx`)。若不透传,给 GlowButton 加透传(`...rest` 到 TouchableOpacity),不改其既有调用方。
- `BottomSheet` 的 children 区域是否需要 `ScrollView` 包一层(参照 `ApprovalQuickPolicySheet` 的用法),内容矮,不一定需要;以渲染不溢出为准。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx jest __tests__/ModelConfirmSheet.test.tsx` → 6 用例 PASS。
Run: `npm run typecheck` → exit 0。

- [ ] **Step 6: Commit**

```bash
git add src/components/vibecoding/ModelConfirmSheet.tsx src/i18n/locales/vibecoding/zh.json src/i18n/locales/vibecoding/en.json __tests__/ModelConfirmSheet.test.tsx
git commit -m "feat: ModelConfirmSheet 模型/effort 二次确认弹窗(含来源标注与 Me 页引导)"
```

---

### Task 5: 创建页集成(分流 + provider 预填)+ 既有测试适配

**Files:**
- Modify: `AliangVibeCodingPhone/src/screens/vibecoding/CreateVibeCodingScreen.tsx`
- Test: `AliangVibeCodingPhone/__tests__/CreateVibeCodingScreen.test.tsx`

- [ ] **Step 1: 扩展测试 mock,写失败测试**

测试文件改动:
(a) `useModelOptions` mock 改为读可变对象并补 hook 的 `refresh` 方法:

```ts
const mockUserDefault: Record<string, unknown> = { provider: null, model: null, effort: null };
jest.mock('../src/hooks/useModelOptions', () => ({
  useModelOptions: () => ({
    providerCatalog: { codex: null, claude_code: null, opencode: null },
    userDefault: mockUserDefault,
    refresh: jest.fn(),
  }),
  catalogEffortOptions: () => [
    { label: 'LOW', value: 'low' },
    { label: 'HIGH', value: 'high' },
  ],
}));
```

(b) navigation mock 记录 `push`:

```ts
const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ replace: mockReplace, goBack: jest.fn(), navigate: jest.fn(), push: mockPush }),
  useRoute: () => ({ params: {} }),
}));
```

(c) 增加两个 helper(放在现有 `tap` 附近),并把「点 START」抽成函数:

```ts
const pressStart = (r: ReactTestRenderer.ReactTestRenderer) => {
  const startTouch = r.root
    .findAllByType(TouchableOpacity)
    .find(c => c.findAllByType(Text).some(t => String(t.props.children).includes('START VIBECODING')));
  act(() => { (startTouch as { props: { onPress?: () => void } })?.props?.onPress?.(); });
};
/** Start 后若弹出了确认 sheet,点其中的确认类按钮(sheet 场景化,二选一存在)。 */
const confirmSheetIfOpen = (r: ReactTestRenderer.ReactTestRenderer) => {
  const btn = touchByTestID(r.root, 'sheet-btn-confirm') ?? touchByTestID(r.root, 'sheet-btn-start-anyway');
  if (btn) act(() => { btn.props.onPress?.(); });
};
```

(d) 新 describe 块,**追加在现有 describe 之后**(两块共享同一 `mockUserDefault` 模块 mock,jest 按文件顺序执行,放前面会把突变泄漏进存量用例;`afterEach` 统一卸载 renderer 并还原 `mockDevices[0].tools`):

```ts
describe('CreateVibeCodingScreen model confirm sheet', () => {
  let root: ReactTestRenderer.ReactTestRenderer;
  beforeEach(() => {
    Object.keys(mockUserDefault).forEach(k => delete mockUserDefault[k]);
    Object.assign(mockUserDefault, { provider: null, model: null, effort: null });
    mockReplace.mockClear();
    mockPush.mockClear();
  });
  afterEach(() => {
    act(() => { root?.unmount(); });
    mockDevices[0].tools = [];
  });

  it('model/effort 均未指定:Start 打开确认 sheet,不直接 navigate', async () => {
    root = await wrap(<CreateVibeCodingScreen />);
    pressStart(root);
    // Me 全空(mock 默认)→ 走 go-me 按钮组;sheet 在开 = 内容行可见
    expect(touchByTestID(root.root, 'sheet-model-value')).toBeTruthy();
    expect(touchByTestID(root.root, 'sheet-btn-start-anyway')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('model、effort 都手动指定:Start 直通 navigate(零打扰)', async () => {
    root = await wrap(<CreateVibeCodingScreen />);
    tap(root.root, 'model-chip-gpt-5');   // 依赖 (e) 新增的 model 芯片 testID
    tap(root.root, 'effort-chip-high');   // 依赖 (e) 新增的 effort 芯片 testID
    pressStart(root);
    expect(touchByTestID(root.root, 'sheet-model-value')).toBeUndefined();
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it('任一未指定(选了 effort 未选 model)也弹 sheet', async () => {
    root = await wrap(<CreateVibeCodingScreen />);
    tap(root.root, 'effort-chip-high');
    pressStart(root);
    expect(touchByTestID(root.root, 'sheet-model-value')).toBeTruthy();
    expect(touchByTestID(root.root, 'sheet-btn-start-anyway')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('确认开始:navigate 且 draftConfig 与原语义一致(model/effort 不带值)', async () => {
    Object.assign(mockUserDefault, { provider: 'codex', model: 'gpt-5.4', effort: 'high' });
    root = await wrap(<CreateVibeCodingScreen />);
    pressStart(root);
    tap(root.root, 'sheet-btn-confirm');
    expect(mockReplace).toHaveBeenCalledTimes(1);
    const [dest, params] = mockReplace.mock.calls[0];
    expect(dest).toBe('VibeCodingSession');
    expect(params.draftConfig.model).toBeUndefined();
    expect(params.draftConfig.effort).toBeUndefined();
  });

  it('返回修改:仅关 sheet,不 navigate,可再次 Start', async () => {
    // 种同 provider 的 Me 默认 → 走 confirm/back 按钮组
    Object.assign(mockUserDefault, { provider: 'codex', model: 'gpt-5.4', effort: 'high' });
    root = await wrap(<CreateVibeCodingScreen />);
    pressStart(root);
    expect(touchByTestID(root.root, 'sheet-btn-back')).toBeTruthy();
    tap(root.root, 'sheet-btn-back');
    expect(mockReplace).not.toHaveBeenCalled();
    expect(touchByTestID(root.root, 'sheet-btn-confirm')).toBeUndefined();
    pressStart(root);
    expect(touchByTestID(root.root, 'sheet-btn-confirm')).toBeTruthy();
  });

  it('Me 空:按钮组为 去设置/仍用默认;去设置=push MainTabs Account 且先关 sheet', async () => {
    root = await wrap(<CreateVibeCodingScreen />);
    pressStart(root);
    expect(touchByTestID(root.root, 'sheet-btn-go-me')).toBeTruthy();
    tap(root.root, 'sheet-btn-go-me');
    expect(mockPush).toHaveBeenCalledWith('MainTabs', { screen: 'Account' });
    // sheet 已关(重新渲染后确认按钮不可见)
    expect(touchByTestID(root.root, 'sheet-btn-confirm')).toBeUndefined();
    expect(touchByTestID(root.root, 'sheet-btn-start-anyway')).toBeUndefined();
    // 仍用默认开始路径
    pressStart(root);
    tap(root.root, 'sheet-btn-start-anyway');
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it('跨 provider:Me 默认(claude)对所选 codex 不适用 → 走 Me 空按钮组', async () => {
    Object.assign(mockUserDefault, { provider: 'claude_code', model: 'glm-5.2', effort: 'high' });
    root = await wrap(<CreateVibeCodingScreen />);
    pressStart(root);
    expect(touchByTestID(root.root, 'sheet-btn-go-me')).toBeTruthy();
    expect(touchByTestID(root.root, 'sheet-btn-confirm')).toBeUndefined();
  });

  it('缺陷B:Me 默认 provider 可用时预填 provider 芯片', async () => {
    root = await wrap(<CreateVibeCodingScreen />);
    // 模拟 userDefault 异步到达:wrap 时 provider 为 null,再置值并重渲染
    Object.assign(mockUserDefault, { provider: 'claude_code', model: 'glm-5.2', effort: 'high' });
    await act(async () => { root.update(<CreateVibeCodingScreen />); });
    expect(touchByTestID(root.root, 'provider-chip-claude_code')?.props.accessibilityState?.selected ?? false).toBe(true);
    pressStart(root);
    confirmSheetIfOpen(root);
    expect(mockReplace.mock.calls[0][1].draftConfig.provider).toBe('claude_code');
  });

  it('缺陷B:Me 默认 provider 不可用时不预填(维持 codex/自动切换)', async () => {
    // tools 恢复由本 describe 的 afterEach 兜底
    mockDevices[0].tools = [{ id: 'codex', available: true }, { id: 'claude_code', available: false }];
    Object.assign(mockUserDefault, { provider: 'claude_code' });
    root = await wrap(<CreateVibeCodingScreen />);
    pressStart(root);
    confirmSheetIfOpen(root);
    expect(mockReplace.mock.calls[0][1].draftConfig.provider).toBe('codex');
  });

  it('缺陷B:用户手动点过 provider 芯片后,Me 预填不覆盖', async () => {
    Object.assign(mockUserDefault, { provider: null });
    root = await wrap(<CreateVibeCodingScreen />);
    tap(root.root, 'provider-chip-codex'); // 触碰即 providerTouchedRef=true
    Object.assign(mockUserDefault, { provider: 'opencode' });
    await act(async () => { root.update(<CreateVibeCodingScreen />); });
    pressStart(root);
    confirmSheetIfOpen(root);
    expect(mockReplace.mock.calls[0][1].draftConfig.provider).toBe('codex');
  });
});
```

(e) 屏幕内 provider/model/effort 芯片补 testID(实现步骤里做):provider 芯片 `provider-chip-${value}`、model 芯片 `model-chip-${preset.value}`(value='' 的「默认」chip 为 `model-chip-`)、effort 芯片 `effort-chip-${preset.value}`。测试中用到的具体 chip 值以 mock 的 `useRecentModelOptions`(model: gpt-5)与 `catalogEffortOptions`(low/high)为准 —— 上例 `model-chip-gpt-5`、`effort-chip-high`。

(f) 既有 12 个用例适配:在每个「点 START VIBECODING」之后插入 `confirmSheetIfOpen(root);`(mock 的 userDefault 为空 → 出现的是 `sheet-btn-start-anyway`)。用 sed 或逐个编辑;断言本体零改。注意 'Create passes draftConfig...' 用例在 tap 顺序上仍先 cap-modify/approval-chip 再 START。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest __tests__/CreateVibeCodingScreen.test.tsx`
Expected: 新 describe FAIL(sheet 不存在/芯片 testID 不存在);存量用例因未适配同样 FAIL(此步允许先只加新用例跑红,存量适配放实现后)。

- [ ] **Step 3: 实现创建页改动**

`CreateVibeCodingScreen.tsx`:

(a) import 增加 `useRef`(react)、`normalizeProvider`(utils/modelIntensity)、`ModelConfirmSheet`(../components/vibecoding/ModelConfirmSheet)。

(b) state 区新增:

```ts
  const [confirmOpen, setConfirmOpen] = useState(false);
  // 用户手动点过 provider 芯片后,Me 默认 provider 预填不再生效。
  const providerTouchedRef = useRef(false);
```

(c) 缺陷 B 预填 effect(放在现有 availability 自动切换 effect 之后):

```ts
  // Me 页默认 provider 预填(缺陷 B):用户未手动选过、且该 provider 在本设备
  // 可用时才预填;不可用则不干预,由上面的 availability effect 兜底自动切。
  useEffect(() => {
    if (providerTouchedRef.current) return;
    const meProvider = normalizeProvider(userDefault.provider ?? undefined);
    if (meProvider && availability[meProvider] && provider !== meProvider) {
      setProvider(meProvider);
    }
  }, [userDefault.provider, availability, provider]);
```

(d) provider 芯片 onPress 首行加 `providerTouchedRef.current = true;`;provider/model/effort 芯片补 testID(见 Step 1(e));provider 芯片同时补 `accessibilityState={{ selected: active }}`(测试断言选中态依赖它,顺带补齐 a11y)。

(e) `handleCreate` 重构 + 新增 `startSession`(原 navigate 逻辑整体平移,`rememberModel` 移入 startSession——确认真正开始时才记历史):

```ts
  const startSession = () => {
    if (creating || !device) return;
    rememberModel(model);
    const effectiveDirectory =
      project?.path ?? directory?.trim() ?? device.authorizedDirectories[0] ?? '~';
    setCreating(true);
    navigation.replace('VibeCodingSession', {
      draftConfig: {
        deviceId: device.id,
        projectId: project?.id || undefined,
        directory: effectiveDirectory,
        provider,
        model: model.trim() || undefined,
        effort: effort.trim() || undefined,
        approvalScheme: approval === 'inherit' ? undefined : approval,
        canRead,
        canModify,
        canRun,
        exposePreviewPort,
      },
    });
  };

  const handleCreate = () => {
    if (creating || !device) return;
    // 任一字段未手动指定 → 先弹确认;都指定了 → 保持原直通,零打扰。
    if (model.trim() === '' || effort.trim() === '') {
      setConfirmOpen(true);
      return;
    }
    startSession();
  };
```

(f) JSX 中 `</ScrollView>` 之后、`</SafeAreaWrapper>` 之前挂载:

```tsx
      <ModelConfirmSheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        provider={provider}
        manualModel={model}
        manualEffort={effort}
        onConfirm={() => {
          setConfirmOpen(false);
          startSession();
        }}
        onGoToMeSettings={() => {
          // 必须先关 sheet:BottomSheet 基于 RN Modal,不关会盖住 push 出的 Account 页,
          // Android 返回键也会先命中 Modal 的 onRequestClose。
          setConfirmOpen(false);
          navigation.push('MainTabs', { screen: 'Account' });
        }}
      />
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest __tests__/CreateVibeCodingScreen.test.tsx` → 全部 PASS(新 10 + 存量 12)。
Run: `npm run typecheck` → exit 0。

- [ ] **Step 5: Commit**

```bash
git add src/screens/vibecoding/CreateVibeCodingScreen.tsx __tests__/CreateVibeCodingScreen.test.tsx
git commit -m "feat: 创建页 Start 接入模型确认弹窗;provider 预填 Me 默认(未手动选择时)"
```

---

### Task 6: 全量回归验证

**Files:** 无新改动(验证任务;发现问题就地修复并单独提交)

- [ ] **Step 1: phone 全量**

Run: `cd AliangVibeCodingPhone && npm run typecheck && npm test`
Expected: tsc exit 0;jest 全绿(基线外零新增失败;历史上有 terminal 相关 3 个 flaky,若出现且与本改动无关,记录并复跑确认 flake)。

- [ ] **Step 2: server 全量**

Run: `cd AliangPhoneServer && npm test`
Expected: 全绿。

- [ ] **Step 3: 真机待验证项(不阻塞,记录给用户)**

- 创建页 Me 有默认 → 弹窗展示 Me 值;确认后会话实际跑在该模型上
- Me 空 → 引导按钮 → Account 页 → 保存默认 → 返回创建页 → 重开弹窗反映新默认
- 跨 provider 场景(codex 设备 + claude 默认)→ 弹窗标 CLI 默认,agent 侧 `--model` 不再收到外族模型

---

## 附:端到端规则一致性

- server `resolveEffectiveModelConfig`(Task 1)与 phone `resolveEffectiveModelChoice`(Task 2)的 meApplies 谓词语义对齐(server 多一个 `!providerValue` 放行项——provider 完全未知时放行;手机创建页 provider 恒显式故无需该项,**不要"顺手补齐"造成行为漂移**);两侧测试用例(跨 provider / 同 provider / 无 defaultProvider)语义一一对应。未来任何一侧改规则,必须同步另一侧+两侧测试。
