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
const corePolicy = loadSource('packages/rental-core/admin/work-orders/workOrderBoardPolicy.ts');
const policy = loadSource('apps/admin/src/features/rental-core/workOrderBoardPolicy.ts', {
  '@rental-os/rental-core/admin/work-orders/policy': corePolicy,
});

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

test('work-order forms keep their target through exit, discard cancelled drafts, and lock while submitting', async () => {
  const React = require('react');
  const slots = [], forms = [], effects = [];
  let cursor = 0, formCursor = 0, changed = false, pending = false;
  let executeMutation = () => { throw Error('Unexpected business write'); };
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], next => { const value = typeof next === 'function' ? next(slots[index]) : next; if (!Object.is(value, slots[index])) { slots[index] = value; changed = true; } }];
    },
    useEffect(effect, dependencies) {
      const index = cursor++, previous = slots[index];
      if (!previous || dependencies.some((value, at) => !Object.is(value, previous[at]))) effects.push(effect);
      slots[index] = dependencies;
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
  };
  hooks.useLayoutEffect = hooks.useEffect;
  hooks.useCallback = callback => callback;
  const Form = Object.assign(() => null, {
    useForm() {
      const index = formCursor++;
      forms[index] ??= { values: {}, resetFields() { this.values = {}; }, setFieldsValue(next) { this.values = { ...this.values, ...next }; },
        getFieldsValue() { return { ...this.values }; }, validateFields() { return Promise.resolve({ ...this.values }); } };
      return [forms[index]];
    },
    useWatch: (name, form) => form.values[name], Item: 'field',
  });
  const rows = ['first', 'second'].map(id => ({ id, workNo: `WO-${id}`, status: 'pending', reason: id, updatedAt: '2026-11-09', type: 'repair', attachments: [] }));
  const dismissal = loadSource('packages/platform-admin/src/components/ui/useModalDismissal.ts', { react: hooks });
  const ui = Object.fromEntries(['ActionButton', 'AnimatedNumber', 'Segmented', 'ListFilterItem', 'ListSection', 'Empty', 'Modal', 'Alert', 'Table', 'Input', 'Button', 'DataTableRowActions', 'DataTableStatus', 'DataTableText', 'SearchField', 'Select', 'Tabs'].map(name => [name, name]));
  const auth = { sessionVerified: true, tenant: { tenantId: 'tenant' }, user: { id: 'operator', permissions: ['*'] }, currentWorkspaceId: 'workspace', hasPermission: () => true };
  const authStore = Object.assign(select => select(auth), { getState: () => auth });
  const router = { useNavigate: () => () => {}, useParams: () => ({}), useSearchParams: () => [new URLSearchParams(), () => {}] };
  const pageMetadata = loadSource('packages/rental-core/admin/work-orders/pages.ts', {
    '@rental-os/rental-core/permissions': loadSource('packages/rental-core/src/permissions.ts', {
      './core-identity': loadSource('packages/rental-core/src/core-identity.ts'),
    }),
  });
  const coreContracts = { corePageKey: (coreId, pageId) => `${coreId}:${pageId}`, resolveCorePageLocation: () => '' };
  let pageHost;
  const { useCoreForm } = loadSource('packages/platform-admin/src/core/useCoreForm.ts', {
    react: hooks,
    '../app/serverFormSnapshot': loadSource('packages/platform-admin/src/app/serverFormSnapshot.ts'),
    '../app/locale': { useLocale: () => ({ t: text => text }) },
    '../components/ui': { useFeedback: () => ({ toast() {} }) },
    './CorePage': { useCorePageHost: () => pageHost },
  });
  const { MaintenanceWorkOrdersPage: CoreWorkOrdersPage } = loadSource('packages/rental-core/admin/work-orders/MaintenanceWorkOrdersPage.tsx', {
    'react/jsx-runtime': require('react/jsx-runtime'), react: hooks,
    './WorkOrderBoard': { WorkOrderBoard: 'Board' }, './workOrderBoardPolicy': policy,
    '@rental-os/platform-admin/ui': { ...ui, Form, App: { useApp: () => ({ message: { success() {}, warning() {}, error() {} } }) },
      RecordDisclosure: 'Disclosure', RecordDetailLayout: 'Detail', RecordDetailStack: 'Stack', RecordFacts: 'Facts',
      QueryState: 'QueryState', ContentTransition: 'Transition', useModalDismissal: dismissal.useModalDismissal },
    '@rental-os/platform-admin/core': { CorePage: 'CorePage', useCorePageHost: () => pageHost, useCoreForm },
    '@rental-os/core-contracts': coreContracts,
    './pages': pageMetadata,
    'react-router-dom': router,
    '@tanstack/react-query': {
      useQuery: ({ queryKey }) => ({ data: queryKey[1] === 'work-orders' ? rows : [], isLoading: false, isFetching: false, isError: false }),
      useQueryClient: () => ({ invalidateQueries: async () => {} }),
      useMutation: () => ({ isPending: pending, mutate: input => { void executeMutation(input); }, mutateAsync: input => executeMutation(input) }),
    },
    antd: { Descriptions: 'Descriptions', Space: 'Space', Tag: 'Tag', Typography: { Text: 'Text' } },
    'lucide-react': Object.fromEntries(['ArrowLeft', 'ClipboardCheck', 'Columns3', 'FileText', 'History', 'List', 'Play', 'Plus', 'UserRoundPen', 'X'].map(name => [name, name])),
    '@rental-os/platform-admin/forms': { useServerFormSync() {} },
    '@rental-os/platform-admin/locale': { useLocale: () => ({ locale: 'zh-CN', t: text => text }) },
    './WorkOrderBoard.module.css': { default: {} },
  });
  const { MaintenanceWorkOrdersPage } = loadSource('apps/admin/src/features/rental-core/MaintenanceWorkOrdersPage.tsx', {
    'react/jsx-runtime': require('react/jsx-runtime'),
    '@rental-os/platform-admin/core': { CorePageHostProvider: 'CorePageHostProvider' },
    '@rental-os/core-contracts': coreContracts,
    '@rental-os/rental-core/admin/work-orders': { ...pageMetadata, MaintenanceWorkOrdersPage: CoreWorkOrdersPage },
    '@rental-os/rental-core/admin/work-orders/pages': pageMetadata,
    'react-router-dom': router, '@/api/rentalCore': { rentalCoreApi: {} },
    '@/app/branding': { resolveAdminBrandName: () => 'Rental' },
    '@/app/queryClient': { currentSessionEpoch: () => 0 },
    '@/features/auth/authStore': { useAuthStore: authStore },
  });
  const elements = node => !React.isValidElement(node) ? [] : [node, ...React.Children.toArray(node.props.children).flatMap(elements)];
  const render = () => {
    let tree, attempts = 0;
    do {
      assert.ok(attempts++ < 10, 'Rendering must settle'); cursor = 0; formCursor = 0; changed = false;
      const hosted = MaintenanceWorkOrdersPage();
      pageHost = hosted.props.host;
      tree = hosted.props.children.type(hosted.props.children.props);
      while (effects.length) effects.shift()();
    } while (changed);
    return elements(tree);
  };
  const openCancel = row => render().find(node => node.type === 'Board').props.actions(row).props.actions.find(action => action.id === 'cancel').onSelect();
  const cancelModal = () => render().find(node => node.type === 'Modal' && node.props.title.startsWith('取消工单'));
  openCancel(rows[0]);
  assert.equal(cancelModal().props.open, true);
  forms[4].setFieldsValue({ reason: 'previous work order draft' });
  cancelModal().props.onCancel();
  const closing = cancelModal();
  assert.equal(closing.props.open, false);
  assert.match(closing.props.title, /WO-first/);
  assert.equal(forms[4].values.reason, 'previous work order draft', 'The exit animation retains the original form.');
  closing.props.afterClose();
  openCancel(rows[1]);
  assert.equal(cancelModal().props.open, true);
  assert.match(cancelModal().props.title, /WO-second/);
  assert.deepEqual(forms[4].values, {}, 'A cancelled reason cannot carry into a different work order.');
  pending = true;
  const saving = cancelModal();
  for (const name of ['closable', 'keyboard', 'maskClosable']) assert.equal(saving.props[name], false, name);
  assert.equal(saving.props.cancelButtonProps.disabled, true);
  assert.equal(elements(saving).find(node => node.props.form === forms[4]).props.disabled, true);

  pending = false;
  forms[4].setFieldsValue({ reason: 'same validated cancellation' });
  const inputs = [];
  let finish;
  const request = new Promise(resolve => { finish = resolve; });
  executeMutation = input => { inputs.push(input); return request; };
  const currentModal = cancelModal();
  const currentForm = elements(currentModal).find(node => node.props.form === forms[4]);
  const confirmed = currentModal.props.onConfirm();
  currentForm.props.onFinish({ ...forms[4].values });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(inputs.length, 1, 'The modal confirm and native form submission share one business request.');
  assert.deepEqual(inputs[0], { kind: 'cancel', id: 'second', data: { reason: 'same validated cancellation' } });
  finish({ id: 'second', status: 'cancelled' });
  await confirmed;

  let validated;
  forms[4].validateFields = () => new Promise(resolve => { validated = resolve; });
  const previousModal = cancelModal();
  const previousConfirm = previousModal.props.onConfirm();
  previousModal.props.onCancel();
  cancelModal().props.afterClose();
  openCancel(rows[0]);
  validated({ reason: 'previous work order validation' });
  await assert.rejects(previousConfirm, { name: 'AbortError' });
  assert.equal(inputs.length, 1, 'Late validation cannot submit to a different work-order dialog.');
  assert.match(cancelModal().props.title, /WO-first/);
});

test('archived native keyboard drag commits once on drop and never on preview or Escape', () => {
  const archive = 'packages/platform-admin/src/components/kanban-board/archive/';
  const original = fs.readFileSync(path.join(root, archive, 'reference-runtime.js'));
  assert.equal(crypto.createHash('sha256').update(original).digest('hex'), '017b7cdda46945ab120afc39ddcc833c805dac9948c73c41b84a7727b4b50e13');
  const sharedBoardAdapter = loadSource('packages/platform-admin/config/kanbanBoardAdapter.ts');
  const { adaptKanbanRuntime } = loadSource('apps/admin/config/kanbanBoardAdapter.ts', {
    '@rental-os/platform-admin/vite': sharedBoardAdapter,
  });
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
