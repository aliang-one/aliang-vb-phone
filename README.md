# aliang · Vibe Coding Phone

**English** | [简体中文](README.zh-CN.md)

> AI coding agents in your pocket — take over the Claude Code / Codex / OpenCode sessions running on your computer, right from your phone.

![React Native](https://img.shields.io/badge/React%20Native-0.85-61dafb?logo=react&labelColor=20232a)
![React](https://img.shields.io/badge/React-19-61dafb?logo=react&labelColor=20232a)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&labelColor=20232a)
![License](https://img.shields.io/badge/License-MIT-green)

**aliang** is a mobile client built with React Native. It talks to a self-hosted platform service, which bridges — through a desktop agent on your computer — to the AI coding CLIs installed there (Claude Code / Codex / OpenCode), so the vibe coding continues even when you step away:

- 🧠 Agent stuck waiting for approval while you're away → get a phone notification and **allow / deny / reply with a custom message** in one tap
- 🚇 On your commute, watch the agent's live progress (thinking / editing files / running commands) and dictate the next instruction by voice
- ⌨️ Open a remote terminal on your computer any time, browse project files, and review uncommitted diffs

## Features

### 🤖 Vibecoding sessions
- Drive the agent with **Goals**; planning phases (exploring the workspace / emitting a plan / awaiting your answer…) and per-turn activity summaries are shown live
- Override **model and effort (EFFORT)** per session — changes take effect on your next message
- Built-in slash commands: `/goal` `/compact` `/review` `/diff` `/undo` `/redo` `/cost` `/memory` `/init` `/help` …
- Create sessions per provider (claude code / codex / opencode), bound to an existing project or a custom working directory

### ✅ Approvals & permissions
- Four approval policies: inherit / allow all / ask every time / read-only
- Capability-level permissions: read files / modify files / run commands — pick individually
- An Approval Center batches every pending operation, with **custom replies** and a quick policy toggle

### ⌨️ Remote terminals
- Full terminal powered by xterm.js; manage multiple terminals, plus a RECENT section
- Presence heartbeat keeps your terminals alive so the server's idle reaper doesn't close them

### 📁 Projects & files
- Project list / detail / settings, and a file browser
- **Change review**: inspect the uncommitted changes an agent left behind
- A Command Center (dashboard) overviewing devices, sessions, and projects

### 🎤 Voice input
- Streaming speech-to-text over a WebSocket; voice-to-bash — say it, and it becomes a terminal command

### 🔔 Background notifications (Android)
- Approval requests and turn settlements arrive as system notifications; tapping one jumps straight to the session
- Quick actions and grouped summaries supported

### 🔐 Sign-in & security
- Scan-to-bind devices / confirm login on the desktop
- Biometric unlock (Android fingerprint); credentials stored in the Keychain

### 🧩 More
- Port-mapping management + WebView preview of your dev server
- English & Chinese (i18next), dark mode

## Architecture

```
┌───────────────┐  HTTPS / WSS  ┌───────────────┐             ┌──────────────────┐
│   Phone app   │ ◄──────────► │    Platform    │ ◄─────────► │  Desktop agent   │
│ (this repo)   │  auth/session │    service     │  device     │  Claude Code /   │
│ React Native  │  approvals/   │   (gateway)    │  channel    │  Codex / OpenCode│
│               │  notifications│                │             │                  │
└───────────────┘               └───────────────┘             └──────────────────┘
```

> This repository contains **only the mobile client**. The platform service and the desktop agent are separately deployed pieces of the aliang stack and live outside this repo.
> The client reaches the platform service through a single URL — `PLATFORM_SERVICE_BASE_URL` in [`src/config/localService.ts`](src/config/localService.ts). Change that one line to retarget an environment.

## Tech stack

| Area | Choice |
| --- | --- |
| Framework | React Native 0.85 (New Architecture) + React 19 |
| Language | TypeScript (strict) |
| Navigation | @react-navigation v7 (native-stack + bottom-tabs) |
| State | zustand (persisted + hydration) |
| Terminal | @xterm/xterm + addon-fit |
| Native | Nitro Modules, react-native-vision-camera (scanning), react-native-keychain (credentials), react-native-notify-kit (notifications), react-native-live-audio-stream (voice) |
| Motion | react-native-reanimated 4 + worklets, react-native-gesture-handler |
| i18n | i18next (zh / en) |
| Testing | Jest + react-test-renderer (130+ suites, 1000+ cases) |

## Requirements

- Node ≥ 22.11 (see `package.json` engines)
- **Android**: JDK 17, Android SDK (compileSdk 36); the app supports Android 7.0+ (minSdk 24)
- **iOS**: macOS, Xcode, CocoaPods (`bundle install` + `bundle exec pod install`)
- A reachable aliang platform service + desktop agent (see [Architecture](#architecture))

## Getting started

```sh
git clone <your-fork-url>
cd AliangVibeCodingPhone
npm install

# iOS only (first clone, or after native deps change)
bundle install
cd ios && bundle exec pod install && cd ..
```

### Run on Android

```sh
npm run android
```

### Run on iOS

```sh
npm run ios
```

Before launching, point `PLATFORM_SERVICE_BASE_URL` in [`src/config/localService.ts`](src/config/localService.ts) at your platform service.

### Building a release (Android)

Release builds **fail closed** when signing is missing or only partially configured. Provide signing via environment variables:

```bash
export ALIANG_RELEASE_STORE_FILE=/absolute/path/to/release.jks
export ALIANG_RELEASE_STORE_PASSWORD='<store-password>'
export ALIANG_RELEASE_KEY_ALIAS='<key-alias>'
export ALIANG_RELEASE_KEY_PASSWORD='<key-password>'

npm run android:release            # current architecture
npm run android:release:arm64      # arm64-v8a only
npm run android:release:full       # all architectures
```

> For internal testing only, `ALLOW_DEBUG_RELEASE_SIGNING=true` produces a debug-signed APK — that artifact must **not** ship as a production update.

### Tag-triggered release builds (CI)

Pushing a `v*` tag that points at a commit on `main` — e.g. `git tag v1.0.1 && git push github v1.0.1` — triggers the [Release APK workflow](.github/workflows/release.yml): an arm64-v8a release APK is built with `VERSION_NAME`/`VERSION_CODE` derived from the tag, then attached to the GitHub Release for that tag (and uploaded as a workflow artifact).

To get production-signed APKs, set these repository secrets:

| Secret | Value |
| --- | --- |
| `ALIANG_RELEASE_KEYSTORE_BASE64` | base64 of your release `.jks` keystore |
| `ALIANG_RELEASE_STORE_PASSWORD` | keystore password |
| `ALIANG_RELEASE_KEY_ALIAS` | key alias |
| `ALIANG_RELEASE_KEY_PASSWORD` | key password |

Without them the workflow still succeeds but produces a clearly-labelled **debug-signed internal APK** — fine for testing, not for distribution.

## Development

```sh
npm start          # start Metro
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
npm test           # full Jest suite
```

Helper scripts live in `scripts/` (`run-android.js` / `run-ios.js` / `build-android-release.js` / `generate-icons.mjs` / `stop-metro.js`), wired up through package.json scripts.

## Project layout

```
├── App.tsx                  # app entry (navigation, notifications, presence heartbeat)
├── src/
│   ├── api/                 # platform-service API client (REST + WebSocket + STT)
│   ├── app/                 # navigation setup
│   ├── components/          # shared components
│   ├── config/              # single source of truth for service endpoints
│   ├── i18n/                # UI copy (locales/<domain>/<lang>.json)
│   ├── screens/             # screens: auth / devices / projects / vibecoding / operations / preview / settings / terminals
│   ├── services/            # WebSocket, notifications, credentials, file cache, voice
│   ├── store/               # feature stores (zustand)
│   └── theme/               # theming (dark mode)
├── stores/                  # global settings store
├── docs/superpowers/        # design specs & implementation plans
├── __tests__/               # Jest tests
└── scripts/                 # dev helper scripts
```

## Design docs

Every major feature has its own design spec and step-by-step plan under [`docs/superpowers/`](docs/superpowers/):

- `specs/` — design documents (background, approach, trade-offs), e.g. [biometric login](docs/superpowers/specs/2026-07-28-biometric-login-design.md), [voice-to-bash](docs/superpowers/specs/2026-06-30-voice-to-bash-design.md), [tiered MCP auto-approval](docs/superpowers/specs/2026-07-04-mcp-tiered-auto-approve-design.md)
- `plans/` — the corresponding implementation plans

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) (in Chinese).

## License

[MIT](LICENSE)
