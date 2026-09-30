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
  const saved = await f.appearance.save({ adminContainerRadius: 24, expectedRevision: 3 }, user);
  assert.equal(saved.adminContainerRadius, 24);
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
  const saved = await f.appearance.save({ adminContainerRadius: 24, expectedRevision: 0 }, user);
  assert.equal(saved.brandName, 'Legacy brand');
  assert.equal(saved.themeColor, '#111111');
  assert.equal(saved.adminButtonRadius, 999);
  assert.equal(saved.adminContainerRadius, 24);
});

test('stale revision and a revision change between read and write are rejected', async () => {
  const f = fixture();
  await assert.rejects(f.appearance.save({ adminInputRadius: 18, expectedRevision: 2 }, user), e => e.getStatus() === 409);
  const update = f.db.tenantAppearanceProfile.update.bind(f.db.tenantAppearanceProfile);
  f.db.tenantAppearanceProfile.update = async args => {
    f.state.appearance.revision += 1;
    return update(args);
  };
  await assert.rejects(f.appearance.save({ adminInputRadius: 18, expectedRevision: 3 }, user), e => e.getStatus() === 409);
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
  await assert.rejects(f.appearance.save({ adminInputRadius: 18, expectedRevision: 3 }, user), e => e.getStatus() === 409);
});

test('brand sync failure rolls back the channel write in the transaction', async () => {
  const f = fixture();
  f.db.tenantAppearanceProfile.upsert = async () => { throw new Error('sync failed'); };
  await assert.rejects(f.channel.save({ brandName: 'New brand', publishedWorkspaceIds: [] }, user), /sync failed/);
  assert.equal(f.state.channel.brandName, 'Legacy brand');
  assert.equal(f.state.channel.revision, 1);
  assert.equal(f.state.appearance.brandName, initial.brandName);
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
