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
assert.match(button, /#if RCT_DEBUG && !TARGET_OS_OSX[\s\S]*?isEqualToString:@"rngh-hit-test-lab-unbounded"/,
  'Missing Debug-only original hit-test switch: run npm ci');
assert.match(button, /while \(inner && inner != self && !\[self shouldHandleTouch:inner atPoint:point\]\) \{\s*inner = inner\.superview;\s*\}\s*return inner;/,
  'Missing revised boundary that preserves the button as the hit target: run npm ci');
assert.match(button, /beginTrackingWithTouch:\(UITouch \*\)touch withEvent:\(UIEvent \*\)event\s*\{\s*if \(!_userEnabled\) \{\s*return NO;/,
  'Missing disabled iOS tracking guard: run npm ci');
for (const method of ['mouseDown', 'mouseUp', 'mouseDragged']) {
  assert.match(button, new RegExp(`${method}:\\(NSEvent \\*\\)event\\s*\\{\\s*if \\(!_userEnabled\\) \\{\\s*return;`),
    `Missing disabled ${method} guard: run npm ci`);
}

const config = JSON.parse(read('app.json')).expo;
const build = config.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === 'expo-build-properties')[1];
assert.equal(build.ios.buildReactNativeFromSource, true);
assert.equal(build.ios.reactNativeReleaseLevel, 'stable');
assert.equal(JSON.parse(read('eas.json')).build.development.ios.buildConfiguration, 'Debug');

console.log('Pinned dependencies, SwiftUI flag, revised hit target, disabled event guards, and Debug configuration verified.');
console.log('This verifies source/configuration only; rebuild and test on iOS to check native behaviour.');
