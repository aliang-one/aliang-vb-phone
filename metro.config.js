const path = require('path');
const fs = require('fs');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const {
  wrapWithReanimatedMetroConfig,
} = require('react-native-reanimated/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {};

// git worktree 支持：worktree 里的 node_modules 常常是指向主检出的符号链接，
// Metro 按 realpath 建索引，而 realpath 落在 projectRoot 之外，于是
// "@babel/runtime could not be found" 之类的解析失败会出现在打包阶段。
// 主检出下 realpath 就在 projectRoot 内，这段不会改变任何行为。
const nodeModules = path.join(__dirname, 'node_modules');
let realNodeModules = null;
try {
  realNodeModules = fs.realpathSync(nodeModules);
} catch (err) {
  realNodeModules = null;
}
if (realNodeModules && !realNodeModules.startsWith(__dirname + path.sep)) {
  config.watchFolders = [realNodeModules];
  config.resolver = {
    nodeModulesPaths: [nodeModules, realNodeModules],
  };
}

module.exports = wrapWithReanimatedMetroConfig(
  mergeConfig(getDefaultConfig(__dirname), config),
);
