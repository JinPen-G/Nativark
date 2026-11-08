const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');

function loadSource(filename, dependencies = {}) {
  const source = fs.readFileSync(path.join(root, filename), 'utf8');
  return evaluate(source, filename, dependencies);
}
function evaluate(source, filename, dependencies) {
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => {
    assert.ok(name in dependencies, `Unexpected import ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}
const policy = loadSource('apps/admin/src/features/rental-core/workOrderBoardPolicy.ts');

test('work-order drops preserve start, submit, review, assignment and terminal gates', () => {
  const permissions = { manage: true, review: true };
  const row = { id: 'work-1', status: 'pending', assigneeId: 'operator-1' };
  const move = (status, column, rights = permissions, assignee = row.assigneeId) => policy.resolveWorkOrderBoardMove({ ...row, status }, column, assignee, rights);
  assert.deepEqual(move('pending', 'in_progress'), { kind: 'start' });
  assert.deepEqual(move('in_progress', 'pending_review'), { kind: 'submit' });
  assert.deepEqual(move('pending_review', 'closed'), { kind: 'review', decision: 'approved' });
  assert.deepEqual(move('pending_review', 'in_progress'), { kind: 'review', decision: 'rejected' });
  assert.deepEqual(move('pending', 'closed'), { kind: 'cancel' });
  assert.deepEqual(move('pending', 'pending', permissions, 'operator-2'), { kind: 'assign', assigneeId: 'operator-2' });
  assert.deepEqual(move('pending', 'pending', permissions, 'unassigned'), { kind: 'assign', assigneeId: undefined });
  assert.equal(move('pending', 'in_progress', { manage: false, review: true }).kind, 'denied');
  assert.equal(move('pending_review', 'closed', { manage: true, review: false }).kind, 'denied');
  assert.equal(move('pending', 'pending_review').kind, 'denied');
  assert.equal(move('pending', 'in_progress', permissions, 'operator-2').kind, 'denied');
  for (const status of ['completed', 'cancelled', 'rejected']) assert.equal(move(status, 'in_progress').kind, 'denied');
  assert.equal(move('pending_review', 'pending_review', permissions, 'operator-2').kind, 'denied');
  assert.equal(move('completed', 'closed', { manage: false, review: false }).kind, 'reorder');
});

test('filtered personal ordering retains hidden cards and appends newly seen records', () => {
  const previous = ['first', 'hidden', 'second'];
  assert.deepEqual(policy.mergeWorkOrderDisplayOrder(previous, ['second', 'first', 'new']), ['second', 'hidden', 'first', 'new']);
  assert.deepEqual(previous, ['first', 'hidden', 'second']);
});

test('archived native keyboard drag commits once on drop and never on preview or Escape', () => {
  const archive = 'apps/admin/src/components/kanban-board/archive/';
  const original = fs.readFileSync(path.join(root, archive, 'reference-runtime.js'));
  assert.equal(crypto.createHash('sha256').update(original).digest('hex'), '017b7cdda46945ab120afc39ddcc833c805dac9948c73c41b84a7727b4b50e13');
  const { adaptKanbanRuntime } = loadSource('apps/admin/config/kanbanBoardAdapter.ts');
  const adapted = adaptKanbanRuntime(original.toString('utf8'), '/' + archive + 'reference-runtime.js');
  assert.ok(adapted.includes('onPointerDown') && adapted.includes('460 * (m - p)') && adapted.includes('scrollLeft += l'), 'Preserve the native drag, spring and edge-scroll implementation');
  const states = [];
  let cursor = 0;
  const react = {
    useState(initial) { const index = cursor++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }]; },
    useRef(initial) { const index = cursor++; if (!(index in states)) states[index] = { current: initial }; return states[index]; },
    useId: () => 'board', useMemo: callback => callback(), useCallback: callback => callback,
    useLayoutEffect: callback => { callback(); }, useEffect: () => {}, memo: component => component,
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const motionValue = value => ({ get: () => value, set: next => { value = next; } });
  const changes = [];
  const business = { disabled: false, t: value => value, cardLabel: card => card.id, canCreate: () => true, onCreate: () => {} };
  const runtime = evaluate(adapted, 'reference-runtime.js', {
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' }, react,
    'motion/react': { motion: new Proxy({}, { get: (_target, name) => `motion.${String(name)}` }), AnimatePresence: 'presence', useMotionValue: motionValue, useSpring: motionValue, MotionConfig: 'config', LayoutGroup: 'layout' },
    '@/lib/usePrefersReducedMotion': { usePrefersReducedMotion: () => false },
    './ReferenceImage': { ReferenceImage: 'image' },
    './ReferenceIcons': Object.fromEntries(['Calendar', 'ListChecks', 'Warning', 'Plus', 'Close'].map(name => [name, name])),
    './dropdown-runtime': { ReferenceDropdown: 'dropdown' },
    './motion-tokens.json': JSON.parse(fs.readFileSync(path.join(root, archive, 'motion-tokens.json'), 'utf8')),
    './classes.json': JSON.parse(fs.readFileSync(path.join(root, archive, 'classes.json'), 'utf8')),
    '../KanbanBridge': { useKanbanBridge: () => business, useKanbanAnnouncement: () => react.useState('') },
  });
  const cards = [{ id: 'work-1', title: 'Repair', column: 'pending', assignee: 'person-1' }];
  const props = { cards, columns: [{ id: 'pending', name: 'Pending' }, { id: 'in_progress', name: 'In progress' }], people: [{ id: 'person-1', name: 'Operator' }], onCardsChange: next => changes.push(next) };
  const render = () => { cursor = 0; return runtime.KanbanBoardRuntime(props); };
  const findCard = node => {
    if (!node || typeof node !== 'object') return undefined;
    if (node.props?.['data-card-id'] === 'work-1') return node;
    const children = Array.isArray(node) ? node : node.props?.children;
    for (const child of Array.isArray(children) ? children : [children]) { const found = findCard(child); if (found) return found; }
  };
  const previousRaf = global.requestAnimationFrame;
  global.requestAnimationFrame = () => 1;
  try {
    const key = name => { const card = findCard(render()); assert.ok(card); card.props.onKeyDown({ key: name, preventDefault() {}, shiftKey: false }); };
    key(' '); key('ArrowRight');
    assert.equal(changes.length, 0, 'Arrow navigation must not execute business actions');
    key('Escape');
    assert.equal(changes.length, 0, 'Escape must restore without executing an action');
    assert.equal(cards[0].column, 'pending');
    key(' '); key('ArrowRight'); key(' ');
    assert.equal(changes.length, 1);
    assert.equal(changes[0][0].column, 'in_progress');
    assert.equal(cards[0].column, 'pending', 'Controlled authoritative input is immutable');
  } finally { global.requestAnimationFrame = previousRaf; }
});
