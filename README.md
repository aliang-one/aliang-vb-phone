# aliang · Vibe Coding Phone

> 把 AI 编程代理装进口袋 —— 在手机上随时接管你电脑上的 Claude Code / Codex / OpenCode 会话。

![React Native](https://img.shields.io/badge/React%20Native-0.85-61dafb?logo=react&labelColor=20232a)
![React](https://img.shields.io/badge/React-19-61dafb?logo=react&labelColor=20232a)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&labelColor=20232a)
![License](https://img.shields.io/badge/License-MIT-green)

**aliang** 是一个用 React Native 编写的手机客户端。它连接自部署的平台服务（platform service），由电脑端的桌面 Agent 桥接本机安装的 AI 编程 CLI（Claude Code / Codex / OpenCode），让你离开电脑也能继续 vibe coding：

- 🧠 人不在电脑前，agent 卡在审批上 → 手机收到通知，一键**放行 / 驳回 / 自定义回复**
- 🚇 通勤路上查看 agent 的实时进度（思考中 / 编辑文件 / 运行命令），语音下发下一条指令
- ⌨️ 随时打开电脑上的远程终端敲命令，浏览项目文件、审查未提交的 diff

## 功能特性

### 🤖 Vibecoding 会话
- 以 **Goal（目标）** 驱动 agent，实时展示规划阶段（探索工作区 / 生成计划 / 等待回答…）与回合活动摘要
- 会话级覆盖**模型与推理强度（EFFORT）**，随时调整，下一条消息生效
- 内置 slash 命令：`/goal` `/compact` `/review` `/diff` `/undo` `/redo` `/cost` `/memory` `/init` `/help` …
- 按 provider（claude code / codex / opencode）创建会话，可绑定已有项目或自定义工作目录

### ✅ 审批与权限
- 审批策略四档：继承 / 全部放行 / 逐项确认 / 只读
- 能力级权限：读取文件 / 修改文件 / 运行命令，逐项勾选
- 审批中心集中处理所有待审批操作，支持**自定义回复**与快捷策略切换

### ⌨️ 远程终端
- 基于 xterm.js 的完整终端，多终端管理、RECENT 最近使用
- 在场心跳（presence heartbeat）保活，防止服务端闲置回收

### 📁 项目与文件
- 项目列表 / 详情 / 设置，文件浏览器
- **变更审查**：查看 agent 留下的未提交改动
- 命令中心（Dashboard）总览设备、会话与项目状态

### 🎤 语音输入
- 语音转文字（STT WebSocket 实时流式），voice-to-bash：说一句话变成终端命令

### 🔔 后台通知（Android）
- 审批请求、回合结算推送为系统本地通知，点击直达对应会话
- 通知支持快捷操作与分组汇总

### 🔐 登录与安全
- 扫码绑定设备 / 电脑端确认登录
- 生物识别解锁（Android 指纹），凭据存于 Keychain

### 🧩 其他
- 端口映射管理 + WebView 预览开发服务器
- 中英双语（i18next）、深色模式

## 架构

```
┌───────────────┐  HTTPS / WSS  ┌───────────────┐             ┌──────────────────┐
│   手机 App     │ ◄──────────► │   平台服务      │ ◄─────────► │  电脑端桌面 Agent  │
│  （本仓库）    │   认证/会话/   │  （网关）       │   设备通道    │  Claude Code /    │
│  React Native │   审批/通知    │                │             │  Codex / OpenCode │
└───────────────┘               └───────────────┘             └──────────────────┘
```

> 本仓库只包含**手机客户端**。平台服务与桌面 Agent 是 aliang 生态中独立部署的组件，不在本仓库内。
> 客户端通过 [`src/config/localService.ts`](src/config/localService.ts) 中的单一 URL（`PLATFORM_SERVICE_BASE_URL`）与平台服务通信 —— 改一行即可切换目标环境。

## 技术栈

| 领域 | 选型 |
| --- | --- |
| 框架 | React Native 0.85（New Architecture）+ React 19 |
| 语言 | TypeScript（strict） |
| 导航 | @react-navigation v7（native-stack + bottom-tabs） |
| 状态 | zustand（持久化 + 水合） |
| 终端 | @xterm/xterm + addon-fit |
| 原生能力 | Nitro Modules、react-native-vision-camera（扫码）、react-native-keychain（凭据）、react-native-notify-kit（通知）、react-native-live-audio-stream（语音） |
| 动画/手势 | react-native-reanimated 4 + worklets、react-native-gesture-handler |
| 国际化 | i18next（zh / en） |
| 测试 | Jest + react-test-renderer（130+ 套件，1000+ 用例） |

## 环境要求

- Node ≥ 22.11（见 `package.json` engines）
- **Android**：JDK 17、Android SDK（compileSdk 36）；App 最低支持 Android 7.0（minSdk 24）
- **iOS**：macOS、Xcode、CocoaPods（`bundle install` + `bundle exec pod install`）
- 一个可达的 aliang 平台服务 + 电脑端桌面 Agent（见[架构](#架构)）

## 快速开始

```sh
git clone <your-fork-url>
cd AliangVibeCodingPhone
npm install

# 仅 iOS 需要（首次或原生依赖变更后）
bundle install
cd ios && bundle exec pod install && cd ..
```

### 运行 Android

```sh
npm run android
```

### 运行 iOS

```sh
npm run ios
```

启动前请先把 [`src/config/localService.ts`](src/config/localService.ts) 的 `PLATFORM_SERVICE_BASE_URL` 指向你的平台服务。

### 构建 Release（Android）

Release 构建在签名配置缺失或不完整时会**硬失败**（fail closed）。通过环境变量提供签名信息：

```bash
export ALIANG_RELEASE_STORE_FILE=/absolute/path/to/release.jks
export ALIANG_RELEASE_STORE_PASSWORD='<store-password>'
export ALIANG_RELEASE_KEY_ALIAS='<key-alias>'
export ALIANG_RELEASE_KEY_PASSWORD='<key-password>'

npm run android:release            # 当前架构
npm run android:release:arm64      # 仅 arm64-v8a
npm run android:release:full       # 全架构
```

> 仅供内测时，可用 `ALLOW_DEBUG_RELEASE_SIGNING=true` 产出 debug 签名 APK —— 该产物**不得**作为正式版本分发。

## 开发

```sh
npm start          # 启动 Metro
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
npm test           # Jest 全量测试
```

常用辅助脚本见 `scripts/`（`run-android.js` / `run-ios.js` / `build-android-release.js` / `generate-icons.mjs` / `stop-metro.js`），由 package.json scripts 封装。

## 项目结构

```
├── App.tsx                  # 应用入口（导航、通知、在场心跳）
├── src/
│   ├── api/                 # 平台服务 API 客户端（REST + WebSocket + STT）
│   ├── app/                 # 导航配置
│   ├── components/          # 共享组件
│   ├── config/              # 服务地址等单一配置
│   ├── i18n/                # 中英文案（locales/<domain>/<lang>.json）
│   ├── screens/             # 页面：auth / devices / projects / vibecoding / operations / preview / settings / terminals
│   ├── services/            # WebSocket、通知、凭据、文件缓存、语音等服务
│   ├── store/               # 业务 store（zustand）
│   └── theme/               # 主题（深色模式）
├── stores/                  # 全局设置 store
├── docs/superpowers/        # 功能设计文档（specs）与实施计划（plans）
├── __tests__/               # Jest 测试
└── scripts/                 # 开发辅助脚本
```

## 设计文档

每个主要功能都有独立的设计文档与实施计划，位于 [`docs/superpowers/`](docs/superpowers/)：

- `specs/` —— 功能设计（背景、方案、取舍），如[生物识别登录](docs/superpowers/specs/2026-07-28-biometric-login-design.md)、[语音转命令](docs/superpowers/specs/2026-06-30-voice-to-bash-design.md)、[MCP 分级自动审批](docs/superpowers/specs/2026-07-04-mcp-tiered-auto-approve-design.md)
- `plans/` —— 对应的分步实施计划

## 贡献

欢迎 issue 与 PR，见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE)
