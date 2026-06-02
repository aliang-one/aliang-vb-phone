const reactNativeResolver = require('@react-native/jest-preset/jest/resolver');

module.exports = (request, options) => {
  const resolverOptions = { ...options };

  if (
    resolverOptions.basedir.includes('react-native-worklets') ||
    request.includes('react-native-worklets')
  ) {
    resolverOptions.extensions = resolverOptions.extensions?.filter(
      ext => !ext.includes('native'),
    );
  }

  return reactNativeResolver(request, resolverOptions);
};
