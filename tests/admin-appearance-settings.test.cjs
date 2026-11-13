const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { TenantAppearanceProfileService } = require('../apps/api/src/modules/client/tenant-appearance-profile.service');
const { ClientChannelProfileService } = require('../apps/api/src/modules/client/client-channel-profile.service');
const user = { tenantId: 'appearance-test' };
const now = new Date('2026-09-30T00:00:00Z');
const initial = { tenantId: user.tenantId, revision: 3, brandName: 'Existing brand', brandLogoUrl: '/logo.png', faviconUrl: '/icon.png', themeColor: '#336699', adminCornerRadius: 12, adminContainerRadius: 20, adminButtonRadius: 999, adminInputRadius: 16, updatedAt: now };

// Service/transaction-contract fixture; does not connect to or claim validation of a real database.
function fixture(appearance = initial) {
  const state = {
    appearance: appearance && structuredClone(appearance),
    channel: { id: 'channel', ...structuredClone(initial), brandName: 'Legacy brand', themeColor: '#111111', publishedWorkspaces: [], revision: 1 },
    writes: []
  };
  function model(key) {
    return {
      async findUnique({ where, select }) {
        const row = state[key];
        if (!row || row.tenantId !== where.tenantId) return null;
        return structuredClone(select ? Object.fromEntries(Object.keys(select).map(k => [k, row[k]])) : row);
      },
      async create({ data }) {
        if (state[key]) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
        state[key] = { ...Object.fromEntries(Object.keys(initial).map(k => [k, null])), updatedAt: now, revision: 1, ...structuredClone(data) };
        return structuredClone(state[key]);
      },
      async update({ where, data }) {
        const row = state[key];
        if (!row || Object.entries(where).some(([k, v]) => row[k] !== v)) throw Object.assign(new Error('conflict'), { code: 'P2025' });
        state.writes.push({ key, data: structuredClone(data) });
        for (const [k, v] of Object.entries(data)) if (v !== undefined) row[k] = v && typeof v === 'object' && 'increment' in v ? row[k] + v.increment : v;
        return structuredClone(row);
      },
      async upsert({ where, create, update }) {
        return state[key] ? this.update({ where, data: update }) : this.create({ data: create });
      }
    };
  }
  const db = {
    tenantAppearanceProfile: model('appearance'),
    clientChannelProfile: model('channel'),
    businessWorkspace: { findMany: async () => [] },
    clientChannelWorkspace: { deleteMany: async () => {}, upsert: async () => {} },
    async $transaction(work) {
      const before = structuredClone(state);
      try { return await work(db); } catch (e) { Object.assign(state, before); throw e; }
    }
  };
  return { db, state, appearance: new TenantAppearanceProfileService(db), channel: new ClientChannelProfileService(db) };
}

test('radius-only save preserves branding and omitted radius groups', async () => {
  const f = fixture();
  const saved = await f.appearance.save({ adminContainerRadius: 12, expectedRevision: 3 }, user);
  assert.equal(saved.adminContainerRadius, 12);
  for (const k of ['brandName', 'brandLogoUrl', 'faviconUrl', 'themeColor', 'adminCornerRadius', 'adminButtonRadius', 'adminInputRadius']) assert.equal(saved[k], initial[k], k);
  assert.equal(saved.revision, 4);
});

test('explicit clearing differs from omission and preserves unrelated fields', async () => {
  const f = fixture();
  await f.appearance.save({ themeColor: '', adminInputRadius: null, expectedRevision: 3 }, user);
  assert.equal(f.state.appearance.themeColor, null);
  assert.equal(f.state.appearance.adminInputRadius, null);
  assert.equal(f.state.appearance.brandName, initial.brandName);
  assert.equal(f.state.appearance.adminButtonRadius, 999);
});

test('first radius save retains legacy branding instead of creating empty branding', async () => {
  const f = fixture(null);
  const saved = await f.appearance.save({ adminContainerRadius: 12, expectedRevision: 0 }, user);
  assert.equal(saved.brandName, 'Legacy brand');
  assert.equal(saved.themeColor, '#111111');
  assert.equal(saved.adminButtonRadius, 999);
  assert.equal(saved.adminContainerRadius, 12);
});

test('stale revision and a revision change between read and write are rejected', async () => {
  const f = fixture();
  await assert.rejects(f.appearance.save({ adminInputRadius: 12, expectedRevision: 2 }, user), e => e.getStatus() === 409);
  const update = f.db.tenantAppearanceProfile.update.bind(f.db.tenantAppearanceProfile);
  f.db.tenantAppearanceProfile.update = async args => {
    f.state.appearance.revision += 1;
    return update(args);
  };
  await assert.rejects(f.appearance.save({ adminInputRadius: 12, expectedRevision: 3 }, user), e => e.getStatus() === 409);
  assert.equal(f.state.appearance.adminInputRadius, 16);
});

test('channel reads canonical branding and keeps non-brand channel fields', async () => {
  const f = fixture();
  const data = await f.channel.get(user);
  assert.equal(data.brandName, initial.brandName);
  assert.equal(data.themeColor, initial.themeColor);
  assert.equal(data.revision, 1);
  assert.equal(data.adminButtonRadius, 999);
  assert.deepEqual(data.publishedWorkspaceIds, []);
});

test('channel saves branding into the canonical profile without reverting new radii', async () => {
  const f = fixture();
  f.state.appearance.adminContainerRadius = 28;
  const data = await f.channel.save({ expectedRevision: 1, brandName: 'New brand', themeColor: '#abc', publishedWorkspaceIds: [] }, user);
  assert.equal(f.state.channel.brandName, 'New brand');
  assert.equal(f.state.appearance.brandName, 'New brand');
  assert.equal(data.themeColor, '#AABBCC');
  assert.equal(data.adminContainerRadius, 28);
  assert.equal(f.state.appearance.adminContainerRadius, 28);
  assert.equal(f.state.appearance.revision, 4);
  await assert.rejects(f.appearance.save({ adminInputRadius: 12, expectedRevision: 3 }, user), e => e.getStatus() === 409);
});

test('brand sync failure rolls back the channel write in the transaction', async () => {
  const f = fixture();
  f.db.tenantAppearanceProfile.upsert = async () => { throw new Error('sync failed'); };
  await assert.rejects(f.channel.save({ brandName: 'New brand', publishedWorkspaceIds: [] }, user), /sync failed/);
  assert.equal(f.state.channel.brandName, 'Legacy brand');
  assert.equal(f.state.channel.revision, 1);
  assert.equal(f.state.appearance.brandName, initial.brandName);
});

test('login branding round-trips through the channel facade without changing radii', async () => {
  const f = fixture();
  const backgroundImageUrl = '/api/client/v1/public/website-assets/login-test/login-bg';
  f.db.websiteAsset = { findFirst: async ({ where }) => {
    assert.equal(where.tenantId, user.tenantId);
    assert.equal(where.tenant.code, 'login-test');
    assert.equal(where.id, 'login-bg');
    assert.deepEqual(where.mimeType.in, ['image/jpeg', 'image/png', 'image/webp']);
    return { id: 'login-bg' };
  } };
  const adminLogin = { backgroundImageUrl, title: '  租赁\n更简单  ', description: ' 租户说明 ', highlights: [{}, { title: ' 中间项 ', description: ' 第二项说明 ' }, {}], footerText: ' 欢迎回来 ' };
  const saved = await f.channel.save({ expectedRevision: 1, publishedWorkspaceIds: [], adminLogin }, user);
  const expected = { backgroundImageUrl, title: '租赁\n更简单', description: '租户说明', highlights: [{}, { title: '中间项', description: '第二项说明' }, {}], footerText: '欢迎回来' };
  assert.deepEqual(saved.adminLogin, expected);
  assert.deepEqual((await f.channel.get(user)).adminLogin, expected);
  assert.equal(f.state.channel.adminLoginJson, undefined, 'only the canonical appearance stores login branding');
  assert.equal(f.state.appearance.adminButtonRadius, 999);
  assert.equal(f.state.appearance.adminContainerRadius, 20);
  await f.appearance.save({ expectedRevision: 4, adminInputRadius: 12 }, user);
  assert.deepEqual(f.state.appearance.adminLoginJson, expected);
  await assert.rejects(f.channel.save({ expectedRevision: 1, publishedWorkspaceIds: [], adminLogin: {} }, user), e => e.getStatus() === 409);
  assert.deepEqual(f.state.appearance.adminLoginJson, expected);
});

test('login branding omission preserves, replacement clears fields, and empty object resets', async () => {
  const f = fixture({ ...initial, adminLoginJson: { title: '原始标题', backgroundImageUrl: '/api/client/v1/public/website-assets/login-test/login-bg' } });
  await f.channel.save({ publishedWorkspaceIds: [] }, user);
  assert.equal(f.state.appearance.adminLoginJson.title, '原始标题');
  await f.channel.save({ publishedWorkspaceIds: [], adminLogin: { backgroundImageUrl: '', title: ' 新标题 ', highlights: [{ title: ' ' }, {}, { description: '第三项' }] } }, user);
  assert.deepEqual(f.state.appearance.adminLoginJson, { title: '新标题', highlights: [{}, {}, { description: '第三项' }] });
  await f.channel.save({ publishedWorkspaceIds: [], adminLogin: {} }, user);
  assert.deepEqual((await f.channel.get(user)).adminLogin, {});
});

test('login visibility survives save and read without clearing copy, and can be restored', async () => {
  const f = fixture();
  const adminLogin = { title: '保留的自定义标题', showTitle: false, showDescription: false, showHighlights: false, showFooter: false };
  await f.channel.save({ publishedWorkspaceIds: [], adminLogin }, user);
  assert.deepEqual((await f.channel.get(user)).adminLogin, adminLogin);
  await f.appearance.save({ expectedRevision: 4, adminInputRadius: 12 }, user);
  assert.deepEqual(f.state.appearance.adminLoginJson, adminLogin);
  const restored = { ...adminLogin, showTitle: true };
  await f.channel.save({ publishedWorkspaceIds: [], adminLogin: restored }, user);
  assert.deepEqual((await f.channel.get(user)).adminLogin, restored);
});

test('login branding rejects malformed objects and oversized text before any write', async () => {
  for (const adminLogin of [null, [], 'text', { unknown: 'x' }, { showTitle: 'false' }, { showDescription: 0 }, { showHighlights: null }, { showFooter: [] }, { title: 42 }, { title: 'a'.repeat(81) }, { description: 'a'.repeat(301) }, { footerText: 'a'.repeat(161) }, { highlights: {} }, { highlights: [{}, {}, {}, {}] }, { highlights: [null] }, { highlights: [{ other: 'x' }] }, { highlights: [{ title: 'a'.repeat(25) }] }, { highlights: [{ description: 'a'.repeat(81) }] }]) {
    const f = fixture();
    await assert.rejects(f.channel.save({ publishedWorkspaceIds: [], adminLogin }, user), e => e.getStatus() === 400);
    assert.deepEqual(f.state.writes, []);
  }
});

test('login background accepts only existing same-tenant uploaded images', async () => {
  const f = fixture();
  let lookups = 0;
  f.db.websiteAsset = { findFirst: async ({ where }) => {
    lookups += 1;
    assert.equal(where.tenantId, user.tenantId);
    return null;
  } };
  for (const backgroundImageUrl of ['https://foreign.example/bg.png', '//foreign.example/bg.png', '/api/client/v1/public/website-assets/other/asset?x=1', '/api/client/v1/public/website-assets/other/../asset', '/api/client/v1/public/website-assets/other/asset#fragment']) {
    await assert.rejects(f.channel.save({ publishedWorkspaceIds: [], adminLogin: { backgroundImageUrl } }, user), e => e.getStatus() === 400);
  }
  assert.equal(lookups, 0);
  await assert.rejects(f.channel.save({ publishedWorkspaceIds: [], adminLogin: { backgroundImageUrl: '/api/client/v1/public/website-assets/other/asset' } }, user), e => e.getStatus() === 400);
  assert.equal(lookups, 1);
  assert.deepEqual(f.state.writes, []);
});

test('first login branding save creates canonical config and transactional failure leaves it unchanged', async () => {
  const f = fixture(null);
  await f.channel.save({ publishedWorkspaceIds: [], adminLogin: { title: '新建登录页' } }, user);
  assert.equal(f.state.appearance.adminLoginJson.title, '新建登录页');
  f.db.clientChannelWorkspace.deleteMany = async () => { throw new Error('rollback'); };
  await assert.rejects(f.channel.save({ publishedWorkspaceIds: [], adminLogin: { title: '不可保存' } }, user), /rollback/);
  assert.equal(f.state.appearance.adminLoginJson.title, '新建登录页');
});

test('current radius bounds reject new extremes in both DTOs and services while stored values remain readable', async () => {
  const { validateSync } = require('class-validator');
  const { SaveTenantAppearanceDto } = require('../apps/api/src/modules/client/tenant-appearance-profile.dto');
  const { SaveClientChannelProfileDto } = require('../apps/api/src/modules/client/client-channel-profile.dto');
  for (const Dto of [SaveTenantAppearanceDto, SaveClientChannelProfileDto]) {
    const base = { smsLoginEnabled: true, passwordLoginEnabled: true, publishedWorkspaceIds: [] };
    assert.equal(validateSync(Object.assign(new Dto(), base, { adminCornerRadius: 4, adminContainerRadius: 20, adminButtonRadius: 16, adminInputRadius: null })).length, 0);
    for (const [key, value] of [['adminContainerRadius', 24], ['adminCornerRadius', 40], ['adminButtonRadius', 999], ['adminInputRadius', 17], ['adminButtonRadius', 3], ['adminInputRadius', 8.5]]) {
      assert.ok(validateSync(Object.assign(new Dto(), base, { [key]: value })).some(error => error.property === key));
    }
  }
  for (const [key, value] of [['adminContainerRadius', 24], ['adminCornerRadius', 40], ['adminButtonRadius', 999], ['adminInputRadius', 17]]) {
    const f = fixture({ ...initial, adminCornerRadius: 40, adminContainerRadius: 24, adminInputRadius: 40 });
    assert.equal((await f.appearance.get(user))[key], f.state.appearance[key]);
    assert.equal((await f.channel.get(user))[key], f.state.appearance[key]);
    await assert.rejects(f.appearance.save({ [key]: value, expectedRevision: 3 }, user), error => error.getStatus() === 400);
    await assert.rejects(f.channel.save({ [key]: value, expectedRevision: 1, publishedWorkspaceIds: [] }, user), error => error.getStatus() === 400);
    assert.deepEqual(f.state.writes, []);
  }
});

test('channel radius changes and explicit clearing reach canonical appearance without copying omitted legacy radii', async () => {
  const f = fixture();
  const saved = await f.channel.save({ adminContainerRadius: 4, adminButtonRadius: 16, adminInputRadius: null, expectedRevision: 1, publishedWorkspaceIds: [] }, user);
  assert.equal(saved.adminContainerRadius, 4);
  assert.equal(saved.adminButtonRadius, 16);
  assert.equal(saved.adminInputRadius, undefined);
  for (const row of [f.state.channel, f.state.appearance]) {
    assert.equal(row.adminInputRadius, null);
    assert.equal(row.adminCornerRadius, initial.adminCornerRadius);
  }
  assert.equal(f.state.appearance.revision, 4);
});

test('appearance form maps old radii only into its draft and saves the original revision with radius fields only', async () => {
  const ts = require('typescript');
  const file = path.join(__dirname, '../apps/admin/src/features/appearance/AppearancePage.tsx');
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'AppearancePage');
  const code = ts.transpileModule(declaration.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const tokenCode = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../apps/admin/src/app/designTokens.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const tokenModule = { exports: {} };
  new Function('require', 'module', 'exports', tokenCode)(require, tokenModule, tokenModule.exports);
  const { resolveAdminCornerRadius, resolveAdminRadiusGroup, resolveAdminRadii } = tokenModule.exports;
  const { ADMIN_UI_CORNER_RADIUS_CONTROL_MAX, ADMIN_UI_CORNER_RADIUS_MAX, ADMIN_UI_CORNER_RADIUS_MIN } = require('@rental-os/shared');
  for (const stored of [{ revision: 7, adminCornerRadius: 999, adminContainerRadius: 24, adminButtonRadius: 40, adminInputRadius: 999 }, { revision: 8, adminCornerRadius: 40 }]) {
    const values = {}, saves = [];
    const form = { setFieldsValue: next => Object.assign(values, next), getFieldValue: key => values[key] };
    let save;
    const dependencies = {
      Form: Object.assign(() => null, { useForm: () => [form], useWatch: key => values[key] }),
      useLocale: () => ({ t: text => text }), App: { useApp: () => ({ message: {} }) },
      useQueryClient: () => ({}), useAuthStore: select => select({ tenant: { tenantId: 'appearance-test' }, setTenantBranding: () => assert.fail('reading cannot update applied branding') }),
      queryOptions: options => options, useQuery: () => ({ data: stored }),
      useServerFormSync: (_form, _source, apply) => apply(),
      useMutation: options => { save = options.mutationFn; return { isPending: false }; },
      appearanceApi: { getProfile() {}, saveProfile: payload => { saves.push(payload); return payload; } },
      resolveAdminCornerRadius, resolveAdminRadiusGroup, resolveAdminRadii,
      ADMIN_UI_CORNER_RADIUS_CONTROL_MAX, ADMIN_UI_CORNER_RADIUS_MAX, ADMIN_UI_CORNER_RADIUS_MIN,
      isTransientRefreshError: () => false, Typography: { Paragraph: 'p' },
      ...Object.fromEntries(['PageHeader','SettingsWorkspace','WorkspacePageActions','ThemeModeChoices','AccountThemeColorCard','LoadingState','Alert','Button','CopilotSection','Card','Row','Col','AdminRadiusSlider','RadiusPreview','SaveButton','MotionSettingCard','SoundSettingCard'].map(name => [name, name]))
    };
    const exports = {};
    new Function('require','exports',...Object.keys(dependencies),code)(require,exports,...Object.values(dependencies));
    exports.AppearancePage();
    assert.deepEqual(saves, [], 'initializing the draft never saves');
    assert.deepEqual(values, stored.revision === 7
      ? { adminContainerRadius: 20, adminButtonRadius: 16, adminInputRadius: 16, expectedRevision: 7 }
      : { adminContainerRadius: undefined, adminButtonRadius: undefined, adminInputRadius: undefined, expectedRevision: 8 });
    await save({ ...values, adminInputRadius: null, expectedRevision: 999, brandName: 'unrelated' });
    assert.deepEqual(saves[0], { adminContainerRadius: values.adminContainerRadius, adminButtonRadius: values.adminButtonRadius, adminInputRadius: null, expectedRevision: stored.revision });
    assert.equal(stored.adminCornerRadius, stored.revision === 7 ? 999 : 40, 'the source snapshot remains untouched');
  }
});

test('settings are mounted in the requested pages and sound has an unambiguous module path', () => {
  const read = rel => fs.readFileSync(path.join(__dirname, '..', 'apps/admin/src', rel), 'utf8');
  const appearance = read('features/appearance/AppearancePage.tsx');
  const channel = read('features/channel/ClientChannelPage.tsx');
  for (const name of ['brandName', 'brandLogoUrl', 'faviconUrl', 'themeColor']) {
    assert.match(channel, new RegExp('name="' + name + '"'));
    assert.doesNotMatch(appearance, new RegExp('name="' + name + '"'));
  }
  for (const name of ['adminContainerRadius', 'adminButtonRadius', 'adminInputRadius']) {
    assert.match(appearance, new RegExp('name="' + name + '"'));
    assert.doesNotMatch(channel, new RegExp('name="' + name + '"'));
  }
  assert.match(appearance, /<SoundSettingCard\s*\/>/);
  assert.doesNotMatch(channel, /SoundSettingCard/);
  assert.match(read('app/navigation.tsx'), /label: "外观与音效"/);
  assert.match(read('app/App.tsx'), /features\/sound\/GlobalInteractionSounds/);
});
