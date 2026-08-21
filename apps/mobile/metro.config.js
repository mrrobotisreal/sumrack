const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Drizzle migration .sql files are imported as source (babel inline-import).
config.resolver.sourceExts.push('sql');
// Pack narration audio ships as Opus (design §3.3); bundled fixture audio
// must resolve as an asset (T02 handoff note).
config.resolver.assetExts.push('opus');

module.exports = withNativeWind(config, { input: './src/global.css' });
