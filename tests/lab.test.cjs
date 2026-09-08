const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const element = (type, props) => ({ type, props: props ?? {} });
const compile = file => ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const screenSource = compile('src/TouchableLabScreen.tsx');

function harness() {
  const slots = [], logs = [];
  let cursor = 0, tree;
  const modules = {
    'react/jsx-runtime': { jsx: element, jsxs: element },
    react: { useRef(initial) {
      const index = cursor++;
      slots[index] ??= { current: initial };
      return slots[index];
    }, useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    } },
    'react-native': {
      ...Object.fromEntries(['Pressable', 'ScrollView', 'Switch', 'Text', 'View'].map(name => [name, name])),
      Platform: { OS: 'ios' }, StyleSheet: { create: styles => styles },
    },
    'react-native-gesture-handler': { Touchable: 'Touchable' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 62, bottom: 34 }) },
  };
  const exports = {};
  vm.runInNewContext(screenSource, { exports, console: { info: (...args) => logs.push(args) }, require: name => {
    assert.ok(name in modules, `Unmocked lab dependency: ${name}`); return modules[name];
  } });
  const render = () => { cursor = 0; tree = exports.default(); };
  const visit = (node, predicate) => Array.isArray(node) ? node.flatMap(child => visit(child, predicate)) : !node?.props ? [] : [
    ...(predicate(node) ? [node] : []), ...visit(node.props.children, predicate),
  ];
  const text = node => Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : String(node ?? '');
  const find = predicate => {
    const matches = visit(tree, predicate);
    assert.equal(matches.length, 1, 'Expected one lab control'); return matches[0];
  };
  render();
  return {
    logs, render, find,
    button(label) { return find(node => node.type === 'Pressable' && text(node) === label); },
    press(label) { this.button(label).props.onPress(); render(); },
    toggle(label, value) {
      find(node => node.type === 'Switch' && node.props.accessibilityLabel === label).props.onValueChange(value); render();
    },
    outer: () => find(node => node.props.accessibilityLabel === 'Outer test Touchable'),
    contains(root, label) {
      return visit(root, node => node.props.accessibilityLabel === label).length > 0;
    },
    gate() {
      return find(node => node.type === 'View' && node.props.collapsable === false &&
        node.props.pointerEvents !== undefined && this.contains(node, 'Outer test Touchable'));
    },
    siblingGate() {
      return find(node => node.type === 'View' && node.props.collapsable === false &&
        node.props.pointerEvents !== undefined && this.contains(node, 'Enabled sibling Touchable'));
    },
    filterHost() {
      return find(node => node.type === 'View' && node.props.collapsable === false &&
        node.props.pointerEvents === undefined && this.contains(node, 'Outer test Touchable'));
    },
  };
}

test('the lab starts inert with the native fix on and the pointer workaround off', () => {
  const h = harness();
  assert.equal(h.gate().props.pointerEvents, 'none');
  assert.equal(h.outer().props.testID, 'rngh-hit-test-lab-fixed');
  assert.equal(h.outer().props.disabled, true);
  assert.equal(h.outer().props.pointerEvents, 'auto');
  assert.equal(h.filterHost().props.style.filter[0].blur, 0);
  assert.equal(h.logs.length, 0);
});

test('original and patched presets change the native identifier while requiring explicit re-arming', () => {
  const h = harness(); h.press('Enable test area');
  assert.equal(h.gate().props.pointerEvents, 'auto');
  h.press('Original case');
  assert.equal(h.gate().props.pointerEvents, 'none');
  assert.equal(h.outer().props.testID, 'rngh-hit-test-lab-unbounded');
  assert.equal(h.outer().props.pointerEvents, 'auto');
  h.press('Enable test area');
  const config = JSON.parse(h.logs.at(-1)[1]);
  assert.equal(config.boundaryFix, false);
  assert.equal(config.blurHost, true);
  assert.equal(config.disabled, true);
  assert.equal(config.pointerWorkaround, false);
  h.press('Patched case');
  assert.equal(h.outer().props.testID, 'rngh-hit-test-lab-fixed');
  assert.equal(h.gate().props.pointerEvents, 'none');
});

test('changing controls disarms the test and independently changes filter and pointer handling', () => {
  const h = harness(); h.press('Enable test area');
  h.toggle('SwiftUI blur host', false);
  assert.equal(h.filterHost().props.style, undefined);
  assert.equal(h.gate().props.pointerEvents, 'none');
  h.toggle('Pointer-events workaround', true);
  assert.equal(h.outer().props.pointerEvents, 'none');
  h.toggle('Disable outer Touchable', false);
  assert.equal(h.outer().props.pointerEvents, 'auto');
  assert.equal(h.outer().props.disabled, false);
  h.toggle('Visible blur (6 pt)', true); h.toggle('SwiftUI blur host', true);
  assert.equal(h.filterHost().props.style.filter[0].blur, 6);
});

test('the optional nested Touchable stays enabled and does not carry the bypass identifier', () => {
  const h = harness(); h.toggle('Enabled inner Touchable', true);
  const inner = h.find(node => node.props.accessibilityLabel === 'Enabled inner test Touchable');
  assert.equal(h.outer().props.disabled, true);
  assert.notEqual(inner.props.disabled, true);
  assert.equal(inner.props.testID, 'rngh-hit-test-lab-inner');
});

test('reopening the lab never retains an armed or unpatched configuration', () => {
  const h = harness(); h.press('Original case'); h.press('Enable test area');
  const reopened = harness();
  assert.equal(reopened.outer().props.testID, 'rngh-hit-test-lab-fixed');
  assert.equal(reopened.gate().props.pointerEvents, 'none');
});

test('the sibling overlay case stacks a disabled button on top of an enabled sibling', () => {
  const h = harness();
  const sibling = h.find(node => node.props.accessibilityLabel === 'Enabled sibling Touchable');
  const overlay = h.find(node => node.props.accessibilityLabel === 'Disabled overlay Touchable');
  assert.notEqual(sibling.props.disabled, true);
  assert.equal(overlay.props.disabled, true);
  assert.equal(overlay.props.style.left, 40);
  assert.equal(overlay.props.style.top, 20);
  assert.equal(overlay.props.style.width, 200);
  assert.equal(overlay.props.style.height, 80);
  assert.equal(sibling.props.style.inset, 0);
  assert.equal(h.siblingGate().props.pointerEvents, 'none');
  h.press('Enable sibling test');
  assert.equal(h.siblingGate().props.pointerEvents, 'auto');
  assert.equal(h.gate().props.pointerEvents, 'none');
});
