module.exports = {
  preset: '@react-native/jest-preset',
  resolver: '<rootDir>/jest.resolver.js',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|@react-native-async-storage|react-native-safe-area-context|react-native-screens|react-native-gesture-handler|react-native-reanimated|react-native-worklets|react-native-svg)/)',
  ],
  // Don't discover tests inside git worktrees (e.g. .worktrees/*) — they duplicate
  // the main suite and re-run the known terminal flakes once per worktree.
  testPathIgnorePatterns: ['/node_modules/', '\\.worktrees'],
};
