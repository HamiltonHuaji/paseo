const { withAppBuildGradle } = require("expo/config-plugins");

const FORK_HERMES_FLAGS = '    hermesFlags = ["-O0", "-output-source-map"]';

function configureForkHermesFlags(contents) {
  if (contents.includes(FORK_HERMES_FLAGS.trim())) {
    return contents;
  }

  const reactBlock = "react {";
  if (!contents.includes(reactBlock)) {
    throw new Error("Could not configure fork Hermes flags in app/build.gradle");
  }

  return contents.replace(reactBlock, `${reactBlock}\n${FORK_HERMES_FLAGS}`);
}

function withForkHermesFlags(config) {
  return withAppBuildGradle(config, (modConfig) => {
    modConfig.modResults.contents = configureForkHermesFlags(modConfig.modResults.contents);
    return modConfig;
  });
}

module.exports = withForkHermesFlags;
module.exports.configureForkHermesFlags = configureForkHermesFlags;
