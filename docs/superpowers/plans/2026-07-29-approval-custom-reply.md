# 审批自定义回复(Approval Custom Reply)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 vibecoding「方案选择」审批(`kind === 'client_response'`)加一个「自定义回复」入口,让用户能用自己的话回复(文本/语音),经现有 `message` 链路发回 AI。

**Architecture:** 新增纯 UI 共享组件 `ApprovalCustomReply`(展开式入口:折叠为一个触发器,点开出现 `VoiceTextInput` + 发送 + ✕ 收起),会话屏与审批中心各贴一行条件渲染。复用现有 `message` 回传链路,**契约 / phone api / 服务端 / agent 零改动**。

**Tech Stack:** React Native 0.85(New Arch)、TypeScript、react-i18next、react-test-renderer + jest、现有 `VoiceTextInput` / `GlowButton`。

**Spec:** `docs/superpowers/specs/2026-07-29-approval-custom-reply-design.md`

---

## 文件结构

- **Create** `src/components/vibecoding/ApprovalCustomReply.tsx` — 纯 UI 组件(展开/收起 + 输入 + 发送),不绑 i18n namespace,文案由宿主 props 传入。
- **Create** `__tests__/ApprovalCustomReply.test.tsx` — 组件单测(react-test-renderer)。
- **Modify** `src/i18n/locales/vibecoding/zh.json`、`en.json` — `session.approval` 加 3 个 key。
- **Modify** `src/i18n/locales/operations/zh.json`、`en.json` — `approval` 加 3 个 key。
- **Modify** `src/screens/vibecoding/VibeCodingSessionScreen.tsx` — import + 在方案选择卡片贴条件渲染。
- **Modify** `src/screens/operations/ApprovalCenterScreen.tsx` — import + 在方案选择卡片贴条件渲染。

**不改**:`api/approvals.ts`、server 全部、agent、契约类型。

---

## Task 1: i18n 文案(4 个文件)

**Files:**
- Modify: `src/i18n/locales/vibecoding/zh.json`(在 `session.approval.jumpLabel` 之后)
- Modify: `src/i18n/locales/vibecoding/en.json`(同结构)
- Modify: `src/i18n/locales/operations/zh.json`(在 `approval.openSession` 之后)
- Modify: `src/i18n/locales/operations/en.json`(同结构)

- [ ] **Step 1: vibecoding/zh.json — 在 `session.approval` 块的 `jumpLabel` 之后插入 3 键**

用 Edit,锚点(该行在文件中唯一):
```
old: "jumpLabel": "跳转到待审批",
new: "jumpLabel": "跳转到待审批",
  "customReply": "自己回复…",
  "customReplyPlaceholder": "输入你的回复",
  "customReplySend": "发送",
```

- [ ] **Step 2: vibecoding/en.json — 同位置插入英文**

先确认 `en.json` 中 `session.approval.jumpLabel` 的现有值,以其为锚(如 `"jumpLabel": "Jump to pending",`)在其后加:
```
  "customReply": "Reply yourself…",
  "customReplyPlaceholder": "Type your reply",
  "customReplySend": "Send",
```

- [ ] **Step 3: operations/zh.json — 在 `approval.openSession` 之后插入**

锚点:`"openSession": "OPEN SESSION"`(该块末行),改为:
```
old: "openSession": "OPEN SESSION"
new: "openSession": "OPEN SESSION",
  "customReply": "自己回复…",
  "customReplyPlaceholder": "输入你的回复",
  "customReplySend": "发送"
```
注意:原 `openSession` 是块末(无尾逗号),新键后**最后一个新键不带逗号**。

- [ ] **Step 4: operations/en.json — 同 Step 3,英文**

锚点同 `openSession`,加:
```
  "customReply": "Reply yourself…",
  "customReplyPlaceholder": "Type your reply",
  "customReplySend": "Send"
```

- [ ] **Step 5: 校验四个 JSON 合法**

Run: `node -e "['vibecoding/zh','vibecoding/en','operations/zh','operations/en'].forEach(n=>{require('./src/i18n/locales/'+n+'.json');console.log(n,'OK')})"`
Expected: 四行 `OK`,无 `JSON_ERROR`(逗号/尾逗号错误会抛 SyntaxError)。

- [ ] **Step 6: Commit**

```bash
git add src/i18n/locales/vibecoding/zh.json src/i18n/locales/vibecoding/en.json \
        src/i18n/locales/operations/zh.json src/i18n/locales/operations/en.json
git commit -m "feat(i18n): 审批自定义回复文案(vibecoding+operations 中英)"
```

---

## Task 2: ApprovalCustomReply 组件(TDD)

**Files:**
- Create: `src/components/vibecoding/ApprovalCustomReply.tsx`
- Test: `__tests__/ApprovalCustomReply.test.tsx`

- [ ] **Step 1: 写失败测试 `__tests__/ApprovalCustomReply.test.tsx`**

```tsx
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TextInput, TouchableOpacity } from 'react-native';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { ApprovalCustomReply } from '../src/components/vibecoding/ApprovalCustomReply';

// Stub VoiceTextInput so tests drive the host logic without the STT stack.
jest.mock('../src/components/vibecoding/VoiceTextInput', () => {
  const React = require('react');
  const { TextInput } = require('react-native');
  return {
    VoiceTextInput: (props: any) => (
      <TextInput
        testID={`${props.testIDPrefix ?? 'rename'}-input`}
        value={props.value}
        onChangeText={props.onChangeText}
        onSubmitEditing={props.onSubmitEditing}
      />
    ),
  };
});

const wrap = (ui: React.ReactElement) => {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <ThemeContext.Provider
        value={{ theme: utilityMinimalist, mode: 'light', setMode: jest.fn(), isDark: false }}
      >
        {ui}
      </ThemeContext.Provider>,
    );
  });
  return r;
};

const props = (onSend: jest.Mock) => ({
  approvalId: 'a1',
  triggerLabel: 'Reply',
  placeholder: 'Type your reply',
  sendLabel: 'Send',
  onSend,
});

const find = (r: ReactTestRenderer.ReactTestRenderer, tid: string) =>
  r.root.findAllByType(TouchableOpacity).find(b => b.props.testID === tid);

const sendBtn = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAllByType(Text).find(t => String(t.props.children) === 'Send');

describe('ApprovalCustomReply', () => {
  it('折叠态:渲染触发器,不渲染输入/发送', () => {
    const r = wrap(<ApprovalCustomReply {...props(jest.fn())} />);
    expect(find(r, 'approval-custom-reply-trigger-a1')).toBeTruthy();
    expect(find(r, 'approval-custom-reply-send-a1')).toBeFalsy();
    expect(r.root.findAllByType(TextInput).length).toBe(0);
  });

  it('点触发器展开:出现输入框与发送按钮', () => {
    const r = wrap(<ApprovalCustomReply {...props(jest.fn())} />);
    act(() => find(r, 'approval-custom-reply-trigger-a1')!.props.onPress());
    expect(r.root.findAllByType(TextInput).length).toBe(1);
    expect(find(r, 'approval-custom-reply-send-a1')).toBeTruthy();
  });

  it('空文本时发送禁用;输入后启用', () => {
    const r = wrap(<ApprovalCustomReply {...props(jest.fn())} />);
    act(() => find(r, 'approval-custom-reply-trigger-a1')!.props.onPress());
    expect(sendBtn(r)!.props.disabled).toBe(true); // 透过包装断言见 Step 3 说明
    act(() => r.root.findByType(TextInput).props.onChangeText('  hello '));
    // 发送按钮内部 GlowButton 的 disabled 经 testID 包装查询(见 Step 3)
  });

  it('输入后点发送:调 onSend(trim) 并清空收起', () => {
    const onSend = jest.fn();
    const r = wrap(<ApprovalCustomReply {...props(onSend)} />);
    act(() => find(r, 'approval-custom-reply-trigger-a1')!.props.onPress());
    act(() => r.root.findByType(TextInput).props.onChangeText('  hello '));
    act(() => find(r, 'approval-custom-reply-send-a1')!.props.onPress());
    expect(onSend).toHaveBeenCalledWith('hello');
    // 已收起:输入框消失
    expect(r.root.findAllByType(TextInput).length).toBe(0);
  });

  it('点 ✕ 收起:不调 onSend,再次展开文本保留', () => {
    const onSend = jest.fn();
    const r = wrap(<ApprovalCustomReply {...props(onSend)} />);
    act(() => find(r, 'approval-custom-reply-trigger-a1')!.props.onPress());
    act(() => r.root.findByType(TextInput).props.onChangeText('keep me'));
    act(() => find(r, 'approval-custom-reply-collapse-a1')!.props.onPress());
    expect(onSend).not.toHaveBeenCalled();
    expect(r.root.findAllByType(TextInput).length).toBe(0);
    // 再展开 → 文本仍在
    act(() => find(r, 'approval-custom-reply-trigger-a1')!.props.onPress());
    expect(r.root.findByType(TextInput).props.value).toBe('keep me');
  });

  it('disabled 时点触发器不展开', () => {
    const r = wrap(<ApprovalCustomReply {...props(jest.fn())} disabled />);
    act(() => find(r, 'approval-custom-reply-trigger-a1')!.props.onPress());
    expect(r.root.findAllByType(TextInput).length).toBe(0);
  });
});
```

> Step 3 说明(发送禁用断言的精确查法):`GlowButton` 把 `disabled` 透传给内部 `Pressable`/`Text`。实施时确认 `GlowButton` 是否把 `testID` 落在可查元素上(会话屏现有 `approval-more-${id}` 已用 testID,说明支持)。发送按钮断言改用:`r.root.findAll(node => node.props.testID === 'approval-custom-reply-send-a1')[0].props.disabled`。若 GlowButton 不透传 disabled 到带 testID 的节点,则在 `ApprovalCustomReply` 内用 `TouchableOpacity`(带 testID)+ 禁用样式自绘发送按钮替代 GlowButton(见 Step 4 备选)。**先按 GlowButton 透传实现,测试红/绿时会暴露真实结构,据此校准断言。**

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest __tests__/ApprovalCustomReply.test.tsx`
Expected: FAIL — `Cannot find module '../src/components/vibecoding/ApprovalCustomReply'`。

- [ ] **Step 3: 实现 `src/components/vibecoding/ApprovalCustomReply.tsx`**

```tsx
// 「自定义回复」入口:折叠为一个触发器,展开后是 VoiceTextInput + 发送 + ✕ 收起。
// 纯 UI、不绑 i18n namespace —— 文案由宿主以各自 namespace 翻译后传入。
// 仅用于方案选择(client_response)审批:onSend 触发 resolve(id,'approved',{message})。
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { GlowButton } from '../shared/GlowButton';
import { VoiceTextInput } from './VoiceTextInput';

export interface ApprovalCustomReplyProps {
  approvalId: string;
  triggerLabel: string;
  placeholder: string;
  sendLabel: string;
  disabled?: boolean;
  sessionId?: string;
  projectPath?: string;
  onSend: (message: string) => void;
}

const MAX_LENGTH = 2000; // < 服务端 message.max(4000),前端先截

export const ApprovalCustomReply: React.FC<ApprovalCustomReplyProps> = ({
  approvalId,
  triggerLabel,
  placeholder,
  sendLabel,
  disabled = false,
  sessionId,
  projectPath,
  onSend,
}) => {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');

  const trimmed = text.trim();
  const canSend = trimmed.length > 0;

  const send = () => {
    if (!canSend) return;
    onSend(trimmed);
    setText('');
    setExpanded(false);
  };

  const collapse = () => setExpanded(false); // 保留 text
  const toggle = () => {
    if (disabled) return;
    setExpanded(v => !v);
  };

  if (!expanded) {
    return (
      <TouchableOpacity
        testID={`approval-custom-reply-trigger-${approvalId}`}
        accessibilityRole="button"
        accessibilityLabel={triggerLabel}
        disabled={disabled}
        onPress={toggle}
        style={styles.trigger}
      >
        <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
          {triggerLabel}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.expand}>
      <View style={styles.inputRow}>
        <VoiceTextInput
          testIDPrefix={`approval-custom-reply-${approvalId}`}
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          maxLength={MAX_LENGTH}
          returnKeyType="send"
          onSubmitEditing={send}
          sessionId={sessionId}
          projectPath={projectPath}
          style={styles.input}
        />
      </View>
      <View style={styles.actionRow}>
        <TouchableOpacity
          testID={`approval-custom-reply-collapse-${approvalId}`}
          accessibilityRole="button"
          accessibilityLabel="collapse"
          onPress={collapse}
          style={styles.collapseBtn}
        >
          <Svg width={18} height={18} viewBox="0 0 24 24">
            <Path
              d="M6 6l12 12M18 6L6 18"
              stroke={theme.colors.onSurfaceVariant}
              strokeWidth={2}
              strokeLinecap="round"
            />
          </Svg>
        </TouchableOpacity>
        <GlowButton
          testID={`approval-custom-reply-send-${approvalId}`}
          title={sendLabel}
          onPress={send}
          disabled={!canSend}
          variant="primary"
          style={styles.sendBtn}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  trigger: { paddingVertical: 7, alignSelf: 'flex-end' },
  expand: { gap: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1 },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  collapseBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  sendBtn: { minWidth: 88, minHeight: 44 },
});
```

> 备选:若 Step 1 测试发现 `GlowButton` 不把 `testID`/`disabled` 落到可断言节点,把发送按钮从 `<GlowButton>` 换成自绘 `<TouchableOpacity testID=… disabled={!canSend} onPress={send}>`(样式参照 `GlowButton` primary),其余不变。

- [ ] **Step 4: 跑测试确认通过(必要时校准断言)**

Run: `npx jest __tests__/ApprovalCustomReply.test.tsx`
Expected: PASS(6/6)。若「空文本禁用」断言因 GlowButton 结构查不到,按 Step 1 说明校准为 `findAll(node => node.props.testID === ...)[0].props.disabled`。

- [ ] **Step 5: tsc**

Run: `npx tsc --noEmit`
Expected: 无新增错误(忽略仓库既有的 LSP stale 报错,以 tsc 实际退出码 0 为准)。

- [ ] **Step 6: Commit**

```bash
git add src/components/vibecoding/ApprovalCustomReply.tsx __tests__/ApprovalCustomReply.test.tsx
git commit -m "feat(vibecoding): ApprovalCustomReply 自定义回复组件"
```

---

## Task 3: 会话屏接入

**Files:**
- Modify: `src/screens/vibecoding/VibeCodingSessionScreen.tsx`
  - import 区(约 `:40` `ApprovalQuickPolicySheet` import 旁)
  - `renderApprovalCard` 的 `optionChoices.length` 分支(约 `:2207`「更多 ⋯」`TouchableOpacity` 所在 `approvalMoreRow` 内)

- [ ] **Step 1: 加 import**

在 `import { ApprovalQuickPolicySheet } ...` 一行附近加:
```tsx
import { ApprovalCustomReply } from '../../components/vibecoding/ApprovalCustomReply';
```

- [ ] **Step 2: 在方案选择卡片的选项区追加条件渲染**

定位 `optionChoices.map(...)` 之后、`<View style={styles.approvalMoreRow}>` 之内(或其后),加入(用现有 `t`、`session`、`handleResolveApproval`、`deviceOffline`、`resolvingApproval`):

```tsx
{approval.kind === 'client_response' && (
  <ApprovalCustomReply
    approvalId={approval.id}
    triggerLabel={t('session.approval.customReply')}
    placeholder={t('session.approval.customReplyPlaceholder')}
    sendLabel={t('session.approval.customReplySend')}
    disabled={deviceOffline || Boolean(resolvingApproval)}
    sessionId={session.id}
    projectPath={session.directory}
    onSend={msg => handleResolveApproval(approval.id, 'approved', { message: msg })}
  />
)}
```

> 确认上下文变量在 `renderApprovalCard` 作用域内可见:`session`(闭包)、`deviceOffline`、`resolvingApproval`、`handleResolveApproval`、`t` 均已存在(见 `:2084-2224`)。`session.directory` 是项目路径(与该屏其它VoiceTextInput 用法一致)。

- [ ] **Step 3: tsc**

Run: `npx tsc --noEmit`
Expected: 退出码 0(忽略既有 stale)。

- [ ] **Step 4: 相关测试不回归**

Run: `npx jest __tests__/VibeCodingSessionScreen` (若无该屏专属测试则跳过)
Expected: 不新增失败。

- [ ] **Step 5: Commit**

```bash
git add src/screens/vibecoding/VibeCodingSessionScreen.tsx
git commit -m "feat(vibecoding): 会话屏方案选择接入自定义回复"
```

---

## Task 4: 审批中心接入

**Files:**
- Modify: `src/screens/operations/ApprovalCenterScreen.tsx`
  - import 区(约 `:29` `ApprovalQuickPolicySheet` import 旁)
  - `ApprovalCard` 的 `optionActionStack` 内(约 `:487`「更多」`TouchableOpacity` 旁)

- [ ] **Step 1: 加 import**

```tsx
import { ApprovalCustomReply } from '../../components/vibecoding/ApprovalCustomReply';
```

- [ ] **Step 2: 在方案选择卡片的 `optionActionStack` 内追加条件渲染**

在 `optionChoices.map(...)` 之后、「更多」链接旁加入(用现有 `t`、`item`、`onResolve`、`actionsDisabled`):

```tsx
{item.kind === 'client_response' && (
  <ApprovalCustomReply
    approvalId={item.id}
    triggerLabel={t('approval.customReply')}
    placeholder={t('approval.customReplyPlaceholder')}
    sendLabel={t('approval.customReplySend')}
    disabled={actionsDisabled}
    onSend={msg => onResolve(item.id, 'approved', { message: msg })}
  />
)}
```

> 该屏**无** `canResolve`/`resolvableApprovalIds`(与会话屏不同源),靠 `actionsDisabled`(`deviceOffline || anotherApprovalResolving`)禁用——与该屏选项按钮同源。审批中心无会话上下文,故不传 `sessionId`/`projectPath`(语音录音归属为空,可接受)。

- [ ] **Step 3: tsc**

Run: `npx tsc --noEmit`
Expected: 退出码 0。

- [ ] **Step 4: Commit**

```bash
git add src/screens/operations/ApprovalCenterScreen.tsx
git commit -m "feat(operations): 审批中心方案选择接入自定义回复"
```

---

## Task 5: 全量回归

- [ ] **Step 1: 全量 tsc**

Run: `npx tsc --noEmit`
Expected: 退出码 0(忽略仓库既有 LSP stale;若有新增 approval 相关错误必须修)。

- [ ] **Step 2: 全量 jest**

Run: `npx jest`
Expected: 不新增失败(以当前 terminal 基线为准;既有 flake 记录在案)。

- [ ] **Step 3: lint(可选)**

Run: `npx eslint src/components/vibecoding/ApprovalCustomReply.tsx`
Expected: 无 error。

- [ ] **Step 4: 若回归有调整则补一个提交;否则计划完成**

```bash
git log --oneline -6
```
Expected: 看到 Task 1–4 的四个中文提交 + 本 spec/plan 文档提交,全在 `feat/approval-custom-reply` 分支。

---

## 完成定义(DoD)

- [ ] 会话屏与审批中心的 `client_response` 方案选择卡片出现「自己回复」触发器;点开展开输入(文本+语音)、发送、✕ 收起。
- [ ] 发送后用户的自由文本经 `resolve(id,'approved',{message})` 回传,AI 收到并开新回合;发送即收起+清空,卡片转 resolved。
- [ ] ✕ 收起保留已输入文本,选项按钮始终可点。
- [ ] `ApprovalCustomReply` 单测 6 条全绿;`tsc` 0;全量 jest 不新增失败。
- [ ] 仅改 phone 端;server / agent / 契约零改动。
