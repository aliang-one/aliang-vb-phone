# Me 页「关于」子页重构 + 检查更新审计修复 — 设计

日期:2026-10-15
分支:feat/about-screen(worktree `AliangVibeCodingPhone.worktrees/feat-about-screen`)
状态:已获用户批准(单「关于」页方案;审计缺陷直接修)

## 目标

1. Me 页(SettingsScreen)瘦身:版本、检查更新、隐私政策、删除账号全部移入独立「关于」页;Me 页只留一行入口(右侧带当前版本号)。
2. 对「检查更新」全链做多 agent 对抗审计,确认的缺陷当场修复并补测试。

## 非目标(保持 scoped)

- 清除凭据 / 退出登录留在 Me 页不动。
- 主题 / 语言 / 通知等区块不迁移。
- 检查更新的业务语义(判定只信本地复算、失败不锁人、强制不可关)不变,只修缺陷。

## 新页面 AboutScreen

- 文件:`src/screens/settings/AboutScreen.tsx`
- 导航:`RootStackParamList` 增 `About: undefined`;`RootNavigator` 注册 `<Stack.Screen name="About">`(headerShown:false,页内自带 TopAppBar + 返回)。
- 内容(自上而下):
  - 「关于」面板:版本行(保留 testID `settings-app-version`)、检查更新行(保留 `settings-check-update-row`,迁入 handleCheckAppUpdate + toast 逻辑)、隐私政策行(Linking.openURL,保持 best-effort 静默)。
  - 「账号危险区」面板:删除账号行(保留 `settings-delete-account-row`)+ 密码确认 Modal 整体迁入(含 401→wrongPassword 内显、deleting 中禁止关闭、成功后 toast + 翻 Login,逻辑一行不动)。
- 复用组件:SafeAreaWrapper / TopAppBar / GlassPanel / GlowButton / StatusChip。

## Me 页改动

- 删除:关于区、危险区、删除 Modal 及相关 state/handlers/checks(约 -170 行)。
- 新增:原位置一行入口 —— 左「关于」,右侧当前版本号(versionName)+ `›`,navigate('About'),新 testID `settings-about-entry`。

## i18n(settings 命名空间,en/zh 同步)

- 复用:`about.version / about.checkUpdate / about.privacyPolicy / about.update.* / dangerZone.*`。
- 新增:`about.entry`(Me 页入口行标题)、`about.appbarTitle`(页内标题,纯文案不带 "ABOUT" 尾缀)、`about.entryHint`(入口行副文案,可空则省)。

## 检查更新审计(workflow,后台)

- 六维并行查找:store 状态机 / API 层(信封+白名单)/ semver 纯函数 / UI 层(toast 盲区+i18n)/ 生命周期+原生桥 / 测试覆盖与 mock 漂移。
- medium+ 发现逐条对抗证伪(默认证伪),确认项修复 + 补测试;low 项列入报告由人裁决。

## 错误处理

- 全部沿用现状:检查失败 toast、删除失败留弹窗、隐私政策打开失败静默;不新增错误面。

## 测试与交付

- 迁移受影响测试(settings 相关套件中关于/删除行断言 → AboutScreen 新套件)。
- worktree 内单文件 jest 验证(node_modules symlink;worktree 内全量跑会被 `\.worktrees` ignore —— 已知坑)。
- 合回 main 后主树裸 `npx jest` 全量绿为验收线;commit 中文;不加标签不部署(部署另议)。
