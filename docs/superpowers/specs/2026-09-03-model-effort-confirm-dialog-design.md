# 创建 VibeCoding 模型/Effort 二次确认弹窗 — 设计文档

日期:2026-09-03
范围:AliangVibeCodingPhone(手机端为主)+ AliangPhoneServer(resolver 一处门控修复)
关联背景:创建页 model/effort 留空时,实际生效值由 server 端
`resolveEffectiveModelConfig` 按「session → user(Me 页)→ CLI 默认」逐字段解析;
用户对此无感知,偶发跑在非预期模型上。

## 0. 目标与非目标

**目标**

1. 创建页点击 Start 后,若 model 或 effort 任一未手动指定,弹出确认弹窗:
   展示将生效的 model/effort 及其来源(本次选择 / Me 页默认 / CLI 默认),
   提供返回修改与确认两个出口。
2. 修复核查发现的缺陷 A(跨 provider 污染)与 B(Me 默认 provider 对新建会话不生效),
   使弹窗展示值 = 实际执行值。
3. Me 页完全未设置默认时,弹窗引导用户去 Me 页配置。

**非目标**

- 不改 server 会话创建 API 契约(draftConfig/POST /api/ai/sessions 语义不变)。
- 不做「记住本次选择为默认」类新功能。
- 不动 device/project 层配置(已知死配置,另行处理)。
- 不改 SessionSettings 会话内模型切换。

## 1. 链路核查结论(2026-09-03 现状)

主链路正确,端到端贯通:

1. `CreateVibeCodingScreen.tsx:85-86` model/effort 默认 `''`;
   `handleCreate`(L196)→ `draftConfig.model = model.trim() || undefined`。
2. 草稿模式首条消息 → `startAgentSession`(`aiSessionSlice.ts:131-133`)→
   空值不发,`POST /api/ai/sessions` 不带 model/effort。
3. server session 存原始值(undefined)。
4. 派发 agent 前 `agentPublish.ts` 的 `aiSessionCreatePayload` /
   `publishAiMessageToAgent` 走 `effectiveConfigForSession` →
   `resolveEffectiveModelConfig`(`server/src/modelConfig.ts:71`):
   逐字段 session → user(Me 页 defaultModel/defaultEffort)→ CLI 默认;
   provider 额外可从 device.tools 推断。
5. `publicAiSession` 已下发 `effective_model_config`(含 source 来源)。

**缺陷(同根因:resolver 逐字段独立解析,不校验 provider 一致性):**

- **A 跨 provider 污染**:Me 默认 = claude_code + glm-5.2 + high 时,创建页选
  codex 且 model/effort 留空 → 解析出 `codex + glm-5.2 + high` → agent 给
  codex CLI 传 `--model glm-5.2`(agent 端 `agent_ai.go` 原样透传,零校验);
  effort 档位也可能不在所选 provider 的档位表。
- **B Me 默认 provider 永不生效**:provider 链 session→user,但手机创建页
  provider 芯片总是显式选择(默认 codex,按可用性自动切)→ 永远停在 session 层。

## 2. 统一解析规则(两端共享语义)

```
已选 provider(创建页总是显式)
meApplies = Me.provider 未设  或  normalize(Me.provider) === normalize(已选 provider)

effective.model  = 手动model || (meApplies ? Me.model : 无) || CLI默认
effective.effort = 手动effort || (meApplies ? Me.effort : 无) || CLI默认
source(逐字段独立)= manual(本次选择) / me(Me 页默认) / cli(CLI 默认)
```

要点:`Me.provider/model/effort` 是一个整体偏好三元组;用户所选 provider 与
Me 偏好 provider 不一致时,Me 的 model/effort 偏好**不适用**(它们是针对那个
provider 配的),落 CLI 默认。Me.provider 未设时视为全局偏好,仍然适用。

## 3. Server 修复(缺陷 A)

`server/src/modelConfig.ts` `resolveEffectiveModelConfig`:

- provider 循环(现有)解析出 `providerValue` 后,构建 valueLayers 时,
  若 `user.defaultProvider` 存在且 `normalizeProvider(user.defaultProvider)` 与
  `providerValue` 不一致 → user 层替换为空层(model/effort 均不应用)。
- provider 链本身不动(session → user.defaultProvider → device 推断)。

新增 vitest 用例:

| 场景 | 期望 |
|------|------|
| Me=claude_code+glm-5.2,session.provider=codex,model 空 | model/effort 均 cli 来源 |
| Me=claude_code+glm-5.2,session.provider=claude_code,model 空 | model=glm-5.2,来源 user |
| Me 无 provider 但有 model,session.provider=任意 | model=Me.model,来源 user |
| session 显式 model | 恒 session 来源(门控不影响) |

## 4. 手机端镜像 resolver

新文件 `src/utils/effectiveModelConfig.ts`,纯函数:

```ts
export type ModelChoiceSource = 'manual' | 'me' | 'cli';
export interface ResolvedModelChoice {
  provider: EffortProvider;
  model: string | undefined;      // undefined = CLI 默认
  effort: string | undefined;
  modelSource: ModelChoiceSource;
  effortSource: ModelChoiceSource;
  meApplies: boolean;
}
export const resolveEffectiveModelChoice = (
  provider: EffortProvider,
  manualModel: string | undefined,
  manualEffort: string | undefined,
  meDefault:
    | { provider?: string | null; model?: string | null; effort?: string | null }
    | undefined,
): ResolvedModelChoice;
```

- 表驱动单测与 server 用例对齐(同输入同输出)——「弹窗不骗人」的根基。
- provider 归一化复用 `normalizeProvider`(`utils/modelIntensity.ts`)。
- 创建页 provider 恒显式,手机侧无需 server 的 `inferred` 分支。

## 5. 修缺陷 B:创建页 provider 预填 Me 默认

`CreateVibeCodingScreen`:

- provider 初始仍 `'codex'`(避免闪变)。
- 新增 effect:`userDefault.provider` 到达、用户未手动点过 provider 芯片
  (`providerTouchedRef`)、且该 provider 在本设备 `availability` 为 true → 预填;
  不可用则不干预,由现有 availability 自动切换兜底。
- 效果:Me 偏好三元组(provider+model+effort)真正整体生效。

## 6. ModelConfirmSheet(确认弹窗)

载体:复用 `src/components/shared/BottomSheet.tsx`(项目标准弹层,
`ApprovalQuickPolicySheet` 先例)。新组件
`src/components/vibecoding/ModelConfirmSheet.tsx`。

Props:

```ts
{
  open: boolean;
  onClose: () => void;            // 下滑/scrim/系统返回 = 返回修改
  provider: EffortProvider;
  manualModel: string;            // '' = 未指定
  manualEffort: string;
  onConfirm: () => void;          // 确认开始 / 仍用默认开始 共用
  onGoToMeSettings: () => void;   // 仅 Me 全空时出现
}
```

内容:

- 标题「确认模型配置」+ 已选 provider 副标题。
- 两行,值取镜像 resolver 现算,来源 chip 逐字段标注:
  - `Model: glm-5.2 ·〔Me 页默认〕`
  - `Effort: high ·〔CLI 默认〕`
  - 未指定时显示解析值或「provider 内置默认」。
- Me 全空时附提示行:「你还没有设置个人默认模型,可在 Me 页配置」。

按钮组:

| 场景 | 主按钮 | 次按钮 |
|------|--------|--------|
| 解析后任一字段来源为 me | 确认开始 | 返回修改 |
| Me 全空(无任何 me 来源) | 去 Me 页设置 | 仍用默认开始 |

数据流:弹窗自持 `useModelOptions()`(模块级缓存,零额外请求)+
镜像 resolver。`draftConfig` 构造逻辑零改;server 规则已对齐,
实际执行值 = 弹窗展示值。

## 7. 创建页集成

`handleCreate` 改造:

```
点击 Start →
  model 与 effort 都已手动选 → 现状直通 navigate.replace(零打扰)
  任一留空 → setConfirmOpen(true)
    ├─ 返回修改/关闭 → 仅关弹窗
    ├─ 确认开始 / 仍用默认开始 → 原 navigate.replace(抽 startSession() 复用)
    └─ 去 Me 页设置 → navigation.navigate('MainTabs', { screen: 'Account' })
        创建页保留在栈内;UserModelDefaultCard 保存成功即 refreshModelOptions,
        订阅端(含创建页)自动拿到新默认,返回后重开弹窗即反映。
```

## 8. 错误与边界

- model-options 加载失败/404 → meDefault 视为全空 → 走「Me 空」分支
  (引导去设置),不阻塞创建。
- 快速双击:现有 `creating` guard 保留;sheet 按钮点击即 navigate。
- 现有 `__tests__/CreateVibeCodingScreen.test.tsx` 13 个用例未选 model/effort
  直接点 Create → 会撞上弹窗,统一适配为「先点确认再断言 draftConfig」
  (断言本体不变)。

## 9. 测试计划

- **server**(vitest):§3 门控 4 用例。
- **phone**:
  - `effectiveModelConfig` 表驱动单测(与 server 用例对齐)。
  - `CreateVibeCodingScreen.test` 扩展:任一未指定→sheet 出现;
    确认→navigate 且 draftConfig 不变;返回修改→仅关闭;
    Me 空→引导按钮+跳转 Account;provider 预填三态(可用预填 /
    不可用落 codex / 手动点过不覆盖)。
  - `ModelConfirmSheet` 组件测试:两行来源标注、两种按钮组、关闭回调。
- **i18n**:vibecoding namespace en+zh 全量补 key。

## 10. 交付顺序

1. server 门控修复 + vitest
2. 手机镜像 resolver + 单测
3. ModelConfirmSheet + 创建页集成 + provider 预填 + 测试适配
4. i18n 补齐;两端各自 tsc/test 全绿
