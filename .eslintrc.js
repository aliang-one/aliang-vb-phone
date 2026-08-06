module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // 允许 _ 前缀表示"故意未使用"(catch err 不用、解构占位等),TS 项目惯例。
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
    ],
    // === Warning 预算:关闭在 RN 项目中产生大量误报的规则 ===
    // 1. no-inline-styles(114 warning):RN 的 StyleSheet.create 适合复用样式,
    //    但 inline style 用于动态值(flex、条件颜色等)是惯用法,逐个提取收益极低。
    'react-native/no-inline-styles': 'off',
    // 2. no-void(68 warning):`void asyncCall()` 是 TS 消除 floating promise 的
    //    惯用法,不是错误。规则要求 `undefined` 反而不清晰。
    'no-void': 'off',
    // 3. no-bitwise(33 warning):颜色运算(rgba 混合)、位标志(checksum/flag)
    //    合法使用 &, >>, | —— 这是 RN 项目的固有需求。
    'no-bitwise': 'off',
    // 4. no-shadow(15 warning):TS 编译器已对危险 shadowing 报错;剩余的是
    //    深嵌套回调里的同名参数(t, event, transcript)和测试 mock factory
    //    里的 React/View/TextInput 遮蔽 —— RN 通用模式,重命名收益极低。
    '@typescript-eslint/no-shadow': 'off',
  },
  overrides: [
    {
      // 依赖方向边界:store 是 domain/service 层,绝不能依赖 UI(components/screens)。
      // 历史上 controlCenterStore/terminalSlice 直接导入 TerminalEmulator 组件(反转),
      // 已由 services/terminalOutputRegistry 收口。此规则防止任何 store 文件再引入
      // component/screen 依赖 —— 共享关注点必须下沉到 services/,让 store 与 UI 都依赖它。
      files: ['src/store/**/*.ts', 'src/store/**/*.tsx'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: [
                  '../components/*',
                  '../../components/*',
                  '../../../components/*',
                  '../screens/*',
                  '../../screens/*',
                  '../../../screens/*',
                ],
                message:
                  "Store must not import UI (components/screens). Extract the shared concern into a service (e.g. services/terminalOutputRegistry) and have BOTH the store and the UI depend on it.",
              },
            ],
          },
        ],
      },
    },
  ],
};
