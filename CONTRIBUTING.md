# 贡献指南

感谢关注 aliang · Vibe Coding Phone！欢迎通过 issue 反馈问题、通过 PR 贡献代码。

## 开发环境

见 [README · 快速开始](README.md#快速开始)。克隆后：

```sh
npm install
npm test           # 确认基线全绿
```

## 分支约定

- 新功能：`feat/<短描述>`（如 `feat/goal-criteria-ui`）
- 缺陷修复：`fix/<短描述>`

## 提交信息

使用 `类型(范围): 描述` 的中文提交风格，一行说清"改了什么、为什么"：

```
功能(目标): 规划阶段新增 awaiting_user_input 状态显示「等待你的回答」
修复(通知): 非汇总通知传了 groupSummary:undefined 被 Notifee 校验拒
```

常见类型：`功能` / `修复` / `重构` / `测试` / `文档` / `清理` / `诊断`。

## 提交 PR 前

以下三项必须全部通过（也是 CI 检查项）：

```sh
npm run lint
npm run typecheck
npm test
```

要求：

1. **测试**：新功能 / 缺陷修复需附带测试（测试放 `__tests__/` 或就近 `__tests__` 子目录，参考现有用例风格）。
2. **文案**：面向用户的文案必须走 i18n（`src/i18n/locales/<domain>/{zh,en}.json`），中英同步添加。
3. **设计文档**：较大的功能请先在 `docs/superpowers/specs/` 写设计文档（背景、方案、取舍），再动手实现。

## 代码风格

- TypeScript strict；ESLint + Prettier 配置已就位，遵守现有约定即可。
- 注释解释"为什么"，而不是复述"做了什么"。
- 服务地址等环境相关配置只改 `src/config/localService.ts`，不要在别处硬编码 URL。
