module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    // Inline drizzle's .sql migration files as strings so the bundled
    // drizzle/migrations.js can import them (expo driver requirement).
    plugins: [['inline-import', { extensions: ['.sql'] }]],
  };
};
