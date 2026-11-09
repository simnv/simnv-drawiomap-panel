module.exports = {
  // Prettier configuration provided by Grafana scaffolding
  ...require('./.config/.prettierrc.js'),
  overrides: [
    // The code blocks of the docs are examples (some with "..." placeholders): keep them as written.
    { files: '*.md', options: { embeddedLanguageFormatting: 'off' } },
  ],
};
