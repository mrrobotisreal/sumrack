// @ts-check
/**
 * T102: Google Sign-In needs the Firebase project's WEB OAuth client id
 * (client_type 3 in google-services.json) as `webClientId`. That file is
 * gitignored (it carries an API key), so the id is never hardcoded in
 * source: on every prebuild this plugin reads it from the file and writes
 * it to an Android string resource, `sumrak_google_web_client_id`, which
 * features/account/google-config.ts reads at runtime through expo-constants
 * extra (`googleWebClientId`) — set here too, from the same read.
 */
const fs = require('fs');
const path = require('path');
const { AndroidConfig, withStringsXml } = require('expo/config-plugins');

/** @param {string} projectRoot */
function readWebClientId(projectRoot) {
  const file = path.join(projectRoot, 'google-services.json');
  if (!fs.existsSync(file)) return null;
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const client of json.client ?? []) {
    for (const oauth of client.oauth_client ?? []) {
      if (oauth.client_type === 3 && oauth.client_id) return String(oauth.client_id);
    }
  }
  return null;
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withGoogleWebClientId = (config) => {
  const id = readWebClientId(config._internal?.projectRoot ?? process.cwd());
  config.extra = { ...config.extra, googleWebClientId: id };
  return withStringsXml(config, (cfg) => {
    if (id) {
      cfg.modResults = AndroidConfig.Strings.setStringItem(
        [{ $: { name: 'sumrak_google_web_client_id', translatable: 'false' }, _: id }],
        cfg.modResults,
      );
    }
    return cfg;
  });
};

module.exports = withGoogleWebClientId;
