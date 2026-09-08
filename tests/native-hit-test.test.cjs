const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const filename = path.resolve(__dirname, '../node_modules/react-native-gesture-handler/apple/RNGestureHandlerButton.mm');
const source = fs.readFileSync(filename, 'utf8');

function methodBody() {
  const marker = '- (RNGHUIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event';
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, 'Missing installed native button hitTest implementation');
  const opening = source.indexOf('{', start);
  // Comments have no behavioral effect and may contain braces in future edits.
  const rest = source.slice(opening).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '{') depth++;
    if (rest[i] === '}' && --depth === 0) return rest.slice(1, i);
  }
  assert.fail('Unbalanced native hitTest body');
}

// Run the installed Objective-C method's control flow on every platform. Only
// Objective-C declarations/message syntax are lowered; UIKit hit results and
// the unchanged shouldHandleTouch predicate are supplied by each scenario.
// This does not simulate SwiftUI rendering or replace an iOS build/device test.
function nativeBuildBody(body, { debug = false, macOS = false } = {}) {
  return body.replace(/#if RCT_DEBUG && !TARGET_OS_OSX\s*([\s\S]*?)#endif/g,
    (_match, debugBranch) => debug && !macOS ? debugBranch : '');
}

function executable(body) {
  const lowered = body
    .replace('RNGestureHandlerPointerEvents pointerEvents = _pointerEvents;', 'const pointerEvents = self.pointerEvents;')
    .replaceAll('RNGestureHandlerPointerEventsNone', '"none"')
    .replaceAll('RNGestureHandlerPointerEventsBoxNone', '"box-none"')
    .replaceAll('RNGestureHandlerPointerEventsBoxOnly', '"box-only"')
    .replace('for (UIView *subview in [self.subviews reverseObjectEnumerator])', 'for (const subview of [...self.subviews].reverse())')
    .replace('CGPoint convertedPoint = [subview convertPoint:point fromView:self];', 'const convertedPoint = native.convertPoint(subview, point, self);')
    .replace('UIView *hitView = [subview hitTest:convertedPoint withEvent:event];', 'const hitView = native.hitTest(subview, convertedPoint, event);')
    .replace('[self shouldHandleTouch:hitView atPoint:point]', 'native.shouldHandleTouch(hitView, point)')
    .replace('[self pointInside:point withEvent:event]', 'native.pointInside(point, event)')
    .replace('RNGHUIView *inner = [super hitTest:point withEvent:event];', 'let inner = native.superHitTest(point, event);')
    .replace('[self shouldHandleTouch:inner atPoint:point]', 'native.shouldHandleTouch(inner, point)')
    .replace('[self.accessibilityIdentifier isEqualToString:@"rngh-hit-test-lab-unbounded"]', 'self.accessibilityIdentifier === "rngh-hit-test-lab-unbounded"')
    .replace(/\bnil\b/g, 'null');
  return new Function('self', 'native', 'point', 'event', lowered);
}

const body = nativeBuildBody(methodBody());
const hitTest = executable(body);
const debugHitTest = executable(nativeBuildBody(methodBody(), { debug: true }));
// Restore only the previously unbounded walk, retaining all other installed
// branches. This negative control must return the forbidden SwiftUI ancestor.
const oldBody = body.replace(/\s*if \(inner == self\) \{\s*return nil;\s*\}/, '');
assert.notEqual(oldBody, body, 'Missing native walk boundary for the negative control');
const unboundedHitTest = executable(oldBody);

function view(name, parent = null) {
  const node = { name, superview: parent, subviews: [], isHidden: false, alpha: 1, pointerEvents: 'auto' };
  parent?.subviews.push(node);
  return node;
}

function run(self, deepest, eligible = [], { execute = hitTest, inside = true, childResults = new Map() } = {}) {
  const queried = [];
  const childQueries = [];
  let superCalls = 0;
  const result = execute(self, {
    superHitTest() { superCalls++; return deepest; },
    shouldHandleTouch(candidate) { queried.push(candidate); return eligible.includes(candidate); },
    pointInside: () => inside,
    convertPoint: (_view, point) => point,
    hitTest(child) { childQueries.push(child); return childResults.get(child) ?? null; },
  }, { x: 5, y: 5 }, null);
  return { result, queried, childQueries, superCalls };
}

test('enabled buttons still resolve decorative descendants to the button itself', () => {
  const button = view('enabled button');
  const label = view('label', button);
  assert.equal(run(button, label, [button]).result, button);
  assert.equal(run(button, button, [button]).result, button);
  assert.equal(run(button, null, [button]).result, null);
});

test('a disabled button returns nil without querying or returning the enclosing SwiftUI host', () => {
  const host = view('SwiftUI host with enabled gesture recognizers');
  const wrapper = view('Fabric button wrapper', host);
  const button = view('disabled button', wrapper);
  const label = view('label', button);
  for (const deepest of [label, button]) {
    const actual = run(button, deepest, [host]);
    assert.equal(actual.result, null);
    assert.equal(actual.queried.includes(wrapper), false);
    assert.equal(actual.queried.includes(host), false);
    assert.equal(run(button, deepest, [host], { execute: unboundedHitTest }).result, host,
      'the old code must reproduce the ancestor escape from the crash');
  }
});

test('the diagnostic bypass restores the original walk only for the marked debug button', () => {
  const host = view('SwiftUI host');
  const button = view('test button', host);
  const label = view('label', button);
  button.accessibilityIdentifier = 'rngh-hit-test-lab-fixed';
  assert.equal(run(button, label, [host], { execute: debugHitTest }).result, null);
  button.accessibilityIdentifier = 'rngh-hit-test-lab-unbounded';
  assert.equal(run(button, label, [host], { execute: debugHitTest }).result, host);
  const ordinaryButton = view('ordinary app button', host);
  assert.equal(run(ordinaryButton, ordinaryButton, [host], { execute: debugHitTest }).result, null);
  button.accessibilityIdentifier = 'rngh-hit-test-lab-fixed';
  assert.equal(run(button, label, [host], { execute: debugHitTest }).result, null);
});

test('preprocessing strips the diagnostic branch when RCT_DEBUG is false or TARGET_OS_OSX is true', () => {
  const host = view('host');
  const button = view('test button', host);
  button.accessibilityIdentifier = 'rngh-hit-test-lab-unbounded';
  assert.equal(run(button, button, [host]).result, null);
  const macOSHitTest = executable(nativeBuildBody(methodBody(), { debug: true, macOS: true }));
  assert.equal(run(button, button, [host], { execute: macOSHitTest }).result, null);
});

test('both debug modes preserve enabled descendants within a disabled outer button', () => {
  const host = view('host');
  const outer = view('disabled outer button', host);
  const inner = view('enabled inner button', outer);
  const label = view('label', inner);
  for (const mode of ['fixed', 'unbounded']) {
    outer.accessibilityIdentifier = `rngh-hit-test-lab-${mode}`;
    assert.equal(run(outer, label, [inner, host], { execute: debugHitTest }).result, inner);
  }
});

test('enabled child controls and gesture targets still win inside an enabled or disabled parent button', () => {
  const parent = view('parent button');
  const control = view('child control', parent);
  const label = view('control label', control);
  for (const eligible of [[control], [control, parent]]) {
    assert.equal(run(parent, label, eligible).result, control);
  }
  const gestureView = view('child with a native gesture recognizer', parent);
  assert.equal(run(parent, gestureView, [gestureView, parent]).result, gestureView);
});

test('a disabled nested button lets UIKit resolve its enabled parent without returning an ancestor from the child call', () => {
  const parent = view('enabled parent');
  const child = view('disabled child', parent);
  const label = view('child label', child);
  assert.equal(run(child, label, [parent]).result, null);
  // UIKit sees the child's nil result and falls back to the parent itself.
  assert.equal(run(parent, parent, [parent]).result, parent);
  assert.equal(run(child, label, [parent], { execute: unboundedHitTest }).result, parent);
});

test('none, box-only and box-none retain their existing native hit-test behavior', () => {
  const parent = view('button');
  const bottom = view('bottom child', parent);
  const top = view('top child', parent);
  const hidden = view('hidden child', parent);
  hidden.isHidden = true;
  const transparent = view('transparent child', parent);
  transparent.alpha = 0;
  const childResults = new Map([[bottom, bottom], [top, top]]);
  for (const mode of ['none', 'box-only', 'box-none']) {
    parent.pointerEvents = mode;
    for (const inside of [true, false]) {
      const options = { inside, childResults };
      const current = run(parent, parent, [bottom, top], options);
      const previous = run(parent, parent, [bottom, top], { ...options, execute: unboundedHitTest });
      assert.deepEqual(current, previous, `${mode} changed`);
      assert.equal(current.superCalls, 0, `${mode} must bypass the ancestor-walk branch`);
      if (mode === 'box-none') {
        assert.equal(current.result, top);
        assert.deepEqual(current.childQueries, [top]);
      }
    }
  }
});
