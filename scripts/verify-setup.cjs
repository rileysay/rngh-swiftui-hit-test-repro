const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
assert.equal(pkg.overrides['react-native-worklets'], '$react-native-worklets');

for (const [name, version] of Object.entries(pkg.dependencies)) {
  const installed = JSON.parse(read(`node_modules/${name}/package.json`));
  assert.equal(installed.version, version, `${name}: use the pinned version`);
}

const flags = read('node_modules/react-native/ReactCommon/react/featureflags/ReactNativeFeatureFlagsOverridesOSSStable.h');
assert.match(flags, /bool enableSwiftUIBasedFilters\(\) override\s*\{\s*return true;/,
  'Missing SwiftUI filter flag patch: run npm ci');
const button = read('node_modules/react-native-gesture-handler/apple/RNGestureHandlerButton.mm');
assert.match(button, /if \(inner == self\) \{\s*#if RCT_DEBUG && !TARGET_OS_OSX/,
  'Missing native boundary guard and debug switch: run npm ci');
assert.match(button, /isEqualToString:@"rngh-hit-test-lab-unbounded"/);
assert.match(button, /continue;\s*\}\s*#endif\s*return nil;/);

const config = JSON.parse(read('app.json')).expo;
const build = config.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === 'expo-build-properties')[1];
assert.equal(build.ios.buildReactNativeFromSource, true);
assert.equal(build.ios.reactNativeReleaseLevel, 'stable');
assert.equal(JSON.parse(read('eas.json')).build.development.ios.buildConfiguration, 'Debug');

console.log('Pinned dependencies, SwiftUI flag source patch, guard switch, and Debug/source-build configuration verified.');
console.log('This verifies source/configuration only; rebuild and test on iOS to check native behaviour.');
