const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Configurar resolver
config.resolver = {
  ...config.resolver,
  sourceExts: [...config.resolver.sourceExts, 'jpg', 'jpeg', 'png', 'gif', 'webp'],
  // Resolver yoga-layout para um stub vazio no web
  resolveRequest: (context, moduleName, platform) => {
    if (moduleName === 'yoga-layout' && platform === 'web') {
      return {
        filePath: require.resolve('./metro-yoga-stub.js'),
        type: 'sourceFile',
      };
    }
    // Usar resolução padrão para outros módulos
    return context.resolveRequest(context, moduleName, platform);
  },
};

module.exports = config;
