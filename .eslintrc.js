module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // 允许 _ 前缀表示"故意未使用"(catch err 不用、解构占位等),TS 项目惯例。
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
    ],
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
