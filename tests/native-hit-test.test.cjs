const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const filename = path.resolve(__dirname, '../node_modules/react-native-gesture-handler/apple/RNGestureHandlerButton.mm');
const source = fs.readFileSync(filename, 'utf8');

function methodBody(marker = '- (RNGHUIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event') {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing installed native method: ${marker}`);
  const opening = source.indexOf('{', start);
  // Comments have no behavioral effect and may contain braces in future edits.
  const rest = source.slice(opening).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '{') depth++;
    if (rest[i] === '}' && --depth === 0) return rest.slice(1, i);
  }
  assert.fail(`Unbalanced native method body: ${marker}`);
}

// Run the installed Objective-C method's control flow on every platform. Only
// Objective-C declarations/message syntax are lowered; UIKit/AppKit hit results,
// geometry, eligibility and event delivery are mocked by each scenario. These
// are not Apple-platform builds or native integration/device tests.
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
    .replaceAll('[self shouldHandleTouch:inner atPoint:point]', 'native.shouldHandleTouch(inner, point)')
    .replace('[self.accessibilityIdentifier isEqualToString:@"rngh-hit-test-lab-unbounded"]', 'self.accessibilityIdentifier === "rngh-hit-test-lab-unbounded"')
    .replace(/\bnil\b/g, 'null');
  return new Function('self', 'native', 'point', 'event', lowered);
}

const body = nativeBuildBody(methodBody());
const hitTest = executable(body);
const debugHitTest = executable(nativeBuildBody(methodBody(), { debug: true }));
const revisedLoop = 'while (inner && inner != self && ![self shouldHandleTouch:inner atPoint:point]) {';
assert.equal(body.split(revisedLoop).length, 2, 'Expected one canonical self-boundary loop');
// Restore only the ancestor-walk portion for negative controls, leaving all
// other pointer-events branches intact. Neither variant is installed.
const oldLoop = 'while (inner && ![self shouldHandleTouch:inner atPoint:point]) {';
const unboundedHitTest = executable(body.replace(revisedLoop, oldLoop));
const nilBoundaryHitTest = executable(body.replace(revisedLoop, `${oldLoop}
  if (inner == self) {
    return nil;
  }`));
const variants = [
  ['original', unboundedHitTest],
  ['prior nil guard', nilBoundaryHitTest],
  ['revised self guard', hitTest],
];

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

test('all three loops preserve enabled buttons and empty superclass hit results', () => {
  const button = view('enabled button');
  const label = view('label', button);
  for (const [name, execute] of variants) {
    assert.equal(run(button, label, [button], { execute }).result, button, name);
    assert.equal(run(button, button, [button], { execute }).result, button, name);
    assert.equal(run(button, null, [button], { execute }).result, null, name);
  }
});

test('a disabled button returns itself without querying its wrapper or enclosing SwiftUI host', () => {
  const host = view('SwiftUI host with enabled gesture recognizers');
  const wrapper = view('Fabric button wrapper', host);
  const button = view('disabled button', wrapper);
  const label = view('label', button);
  for (const deepest of [label, button]) {
    const actual = run(button, deepest, [host]);
    assert.equal(actual.result, button);
    assert.equal(actual.queried.includes(button), false, 'stop before the self eligibility check');
    assert.equal(actual.queried.includes(wrapper), false);
    assert.equal(actual.queried.includes(host), false);
    assert.equal(run(button, deepest, [host], { execute: nilBoundaryHitTest }).result, null);
    assert.equal(run(button, deepest, [host], { execute: unboundedHitTest }).result, host,
      'the old code must reproduce the ancestor escape from the crash');
  }
});

test('the diagnostic bypass restores the original walk only for the marked debug button', () => {
  const host = view('SwiftUI host');
  const button = view('test button', host);
  const label = view('label', button);
  button.accessibilityIdentifier = 'rngh-hit-test-lab-fixed';
  assert.equal(run(button, label, [host], { execute: debugHitTest }).result, button);
  button.accessibilityIdentifier = 'rngh-hit-test-lab-unbounded';
  assert.equal(run(button, label, [host], { execute: debugHitTest }).result, host);
  const ordinaryButton = view('ordinary app button', host);
  assert.equal(run(ordinaryButton, ordinaryButton, [host], { execute: debugHitTest }).result, ordinaryButton);
  button.accessibilityIdentifier = 'rngh-hit-test-lab-fixed';
  assert.equal(run(button, label, [host], { execute: debugHitTest }).result, button);
});

test('preprocessing strips the diagnostic branch when RCT_DEBUG is false or TARGET_OS_OSX is true', () => {
  const host = view('host');
  const button = view('test button', host);
  button.accessibilityIdentifier = 'rngh-hit-test-lab-unbounded';
  assert.equal(run(button, button, [host]).result, button);
  // This checks only the debug preprocessor condition. hitTest itself belongs
  // to the iOS branch; this is not a macOS hit-test implementation test.
  const strippedBody = nativeBuildBody(methodBody(), { debug: true, macOS: true });
  assert.equal(strippedBody.includes('rngh-hit-test-lab-unbounded'), false);
  assert.equal(run(button, button, [host], { execute: executable(strippedBody) }).result, button);
});

test('all loops and both debug modes preserve enabled descendants within a disabled button', () => {
  const host = view('host');
  const outer = view('disabled outer button', host);
  const inner = view('enabled inner button', outer);
  const label = view('label', inner);
  for (const [name, execute] of variants) {
    assert.equal(run(outer, label, [inner, host], { execute }).result, inner, name);
  }
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

test('an enabled RNGH parent can still resolve a disabled nested child to itself', () => {
  const parent = view('enabled RNGH parent');
  const child = view('disabled RNGH child', parent);
  const label = view('child label', child);
  const expectedChildResults = [parent, null, child];
  for (const [index, [name, execute]] of variants.entries()) {
    const childResult = run(child, label, [parent], { execute }).result;
    assert.equal(childResult, expectedChildResults[index], `${name}: child call`);
    // Explicit mocked superclass fallback: nil falls back to the containing
    // button; otherwise the child's hit result reaches the parent's loop.
    assert.equal(run(parent, childResult ?? parent, [parent], { execute }).result, parent, `${name}: parent call`);
  }
});

test('the nil guard leaks an overlapping tap to a sibling; the self guard retains the disabled overlay', () => {
  const host = view('container with eligible ancestor recognizer');
  const sibling = view('enabled green sibling', host);
  const overlay = view('disabled gray overlay', host);
  // Mock the parent's front-to-back traversal and supplied geometry, not UIKit:
  // a non-null target ends the search; only nil allows the next sibling.
  function parentHit(execute, withinOverlay) {
    const visited = [], results = [];
    for (const candidate of [overlay, sibling]) {
      visited.push(candidate);
      const deepest = candidate === overlay && !withinOverlay ? null : candidate;
      const actual = run(candidate, deepest, [host, sibling], { execute });
      results.push(actual);
      if (actual.result !== null) return { result: actual.result, visited, results };
    }
    return { result: host, visited, results };
  }
  const original = parentHit(unboundedHitTest, true);
  assert.equal(original.result, host);
  assert.deepEqual(original.visited, [overlay]);
  const prior = parentHit(nilBoundaryHitTest, true);
  assert.equal(prior.result, sibling);
  assert.deepEqual(prior.visited, [overlay, sibling]);
  const revised = parentHit(hitTest, true);
  assert.equal(revised.result, overlay);
  assert.deepEqual(revised.visited, [overlay]);
  assert.equal(revised.results[0].queried.includes(host), false);
  for (const [name, execute] of variants) {
    assert.equal(parentHit(execute, false).result, sibling, `${name}: exposed green area`);
  }
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
      for (const [name, execute] of variants) {
        assert.deepEqual(run(parent, parent, [bottom, top], { ...options, execute }), current, `${name}: ${mode} changed`);
      }
      assert.equal(current.superCalls, 0, `${mode} must bypass the ancestor-walk branch`);
      if (mode === 'box-none') {
        assert.equal(current.result, top);
        assert.deepEqual(current.childQueries, [top]);
      }
    }
  }
});

function eventEntry(marker) {
  const lowered = methodBody(marker)
    .replace('NSPoint locationInView = [self convertPoint:[event locationInWindow] fromView:nil];',
      'const locationInView = native.convertPoint(native.locationInWindow(event));')
    .replace('NSPoint locationInWindow = [event locationInWindow];', 'const locationInWindow = native.locationInWindow(event);')
    .replace('NSPoint locationInView = [self convertPoint:locationInWindow fromView:nil];',
      'const locationInView = native.convertPoint(locationInWindow);')
    .replace('BOOL currentlyInside = NSPointInRect(locationInView, self.bounds);',
      'const currentlyInside = native.pointInRect(locationInView, self.bounds);')
    .replace('NSPointInRect(locationInView, self.bounds)', 'native.pointInRect(locationInView, self.bounds)')
    .replace('[self isHoveringTouch:touch]', 'native.isHoveringTouch(touch)')
    .replace('[super beginTrackingWithTouch:touch withEvent:event]', 'native.superBeginTracking(touch, event)')
    .replace('[self recordHoverSampleForMouseEvent:event]', 'native.recordHoverSample(event)')
    .replace('[self dispatchHoverEventIfNeeded]', 'native.dispatchHover()')
    .replaceAll('[self handleAnimatePressIn]', 'native.pressIn()')
    .replaceAll('[self handleAnimatePressOut]', 'native.pressOut()')
    .replace('[super mouseDown:event]', 'native.superMouseDown(event)')
    .replace('[super mouseUp:event]', 'native.superMouseUp(event)')
    .replace(/\b(_[A-Za-z]\w*)\b/g, 'self.$1')
    .replace(/\bYES\b/g, 'true')
    .replace(/\bNO\b/g, 'false');
  return new Function('self', 'native', 'touch', 'event', lowered);
}

const beginTracking = eventEntry('- (BOOL)beginTrackingWithTouch:(UITouch *)touch withEvent:(UIEvent *)event');
const mouseDown = eventEntry('- (void)mouseDown:(NSEvent *)event');
const mouseUp = eventEntry('- (void)mouseUp:(NSEvent *)event');
const mouseDragged = eventEntry('- (void)mouseDragged:(NSEvent *)event');

function eventScenario(execute, { enabled, inside = true, alreadyInside = false, superResult = true } = {}) {
  const actions = [];
  const state = {
    _userEnabled: enabled,
    _isTouchInsideBounds: alreadyInside,
    _isHovered: true,
    _hoverActiveAtPressStart: false,
    _pressTouchIsHovering: false,
    bounds: { x: 0, y: 0, width: 100, height: 40 },
  };
  const before = { ...state };
  const reads = [], writes = [];
  const self = new Proxy(state, {
    get(target, key) { reads.push(key); return target[key]; },
    set(target, key, value) { writes.push(key); target[key] = value; return true; },
  });
  const native = Object.fromEntries([
    'recordHoverSample', 'dispatchHover', 'pressIn', 'pressOut', 'superMouseDown', 'superMouseUp',
  ].map(name => [name, () => actions.push(name)]));
  native.locationInWindow = () => { actions.push('locationInWindow'); return { x: 5, y: 5 }; };
  native.convertPoint = point => { actions.push('convertPoint'); return point; };
  native.pointInRect = () => { actions.push('pointInRect'); return inside; };
  native.isHoveringTouch = () => { actions.push('isHoveringTouch'); return true; };
  native.superBeginTracking = () => { actions.push('superBeginTracking'); return superResult; };
  const result = execute(self, native, {}, {});
  return { result, actions, state, before, reads, writes };
}

test('disabled iOS tracking and macOS mouse entry points return before touching state or calling actions', () => {
  for (const [name, execute, expected] of [
    ['beginTracking', beginTracking, false],
    ['mouseDown', mouseDown, undefined],
    ['mouseUp', mouseUp, undefined],
    ['mouseDragged', mouseDragged, undefined],
  ]) {
    const actual = eventScenario(execute, { enabled: false });
    assert.equal(actual.result, expected, name);
    assert.deepEqual(actual.state, actual.before, name);
    assert.deepEqual(actual.reads, ['_userEnabled'], name);
    assert.deepEqual(actual.writes, [], name);
    assert.deepEqual(actual.actions, [], name);
  }
});

test('enabled iOS tracking still captures hover state and returns the superclass result', () => {
  for (const superResult of [true, false]) {
    const actual = eventScenario(beginTracking, { enabled: true, superResult });
    assert.equal(actual.result, superResult);
    assert.equal(actual.state._isTouchInsideBounds, true);
    assert.equal(actual.state._hoverActiveAtPressStart, true);
    assert.equal(actual.state._pressTouchIsHovering, true);
    assert.deepEqual(actual.actions, ['isHoveringTouch', 'superBeginTracking']);
  }
});

test('enabled macOS mouse-down and mouse-up retain press and superclass actions in the mocked flow', () => {
  const down = eventScenario(mouseDown, { enabled: true });
  assert.equal(down.state._isTouchInsideBounds, true);
  assert.deepEqual(down.actions, ['pressIn', 'superMouseDown']);
  const up = eventScenario(mouseUp, { enabled: true, alreadyInside: true, inside: false });
  assert.equal(up.state._isTouchInsideBounds, false);
  assert.equal(up.state._isHovered, false);
  assert.deepEqual(up.actions, [
    'locationInWindow', 'convertPoint', 'pointInRect', 'recordHoverSample', 'dispatchHover', 'pressOut', 'superMouseUp',
  ]);
});

test('enabled macOS drag entry and exit retain their animation action in the mocked flow', () => {
  for (const [inside, alreadyInside, expectedAction] of [
    [true, false, 'pressIn'],
    [false, true, 'pressOut'],
    [true, true, undefined],
    [false, false, undefined],
  ]) {
    const actual = eventScenario(mouseDragged, { enabled: true, inside, alreadyInside });
    assert.equal(actual.state._isTouchInsideBounds, inside);
    assert.equal(actual.state._isHovered, inside);
    assert.deepEqual(actual.actions, [
      'locationInWindow', 'convertPoint', 'pointInRect', 'recordHoverSample', 'dispatchHover',
      ...(expectedAction ? [expectedAction] : []),
    ]);
  }
});
