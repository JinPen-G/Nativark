'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/lane-a-business-consumption.cjs');
test('AIN16 member difference and submission material retain the checked closing observation', async () => {
  for (const operation of ['prepare', 'submissionMaterial']) {
    const h = await setup(), service = h.tools.memberProfileDifference, reader = service.members;
    h.membershipRows.customer.email = 'private-ordinary-source@example.invalid';
    const originalRead = reader.read, originalClock = reader.clock, sourceName = h.membershipRows.customer.name;
    const input = { customerId: 'customer-a', expectedName: sourceName, name: 'Requested ordinary name' };
    const invoke = value => operation === 'prepare' ? service.prepare(value) : h.tools.memberProfileSubmissionMaterial(value);
    let ticks = 0, observations = [], changeAfterFirst = false, withdrawAfterSecond = false, writes = 0;
    // Only the injected per-instance observation clock and explicit source-row
    // timing change. Original MembershipService, both Guards and ALS still run.
    reader.clock = () => new Date(Date.parse('2026-11-07T00:00:00Z') + ++ticks * 1000);
    reader.read = async function(...args) {
      const row = await originalRead.apply(this, args); observations.push(structuredClone(row));
      if (changeAfterFirst && observations.length === 1) h.membershipRows.customer.name = 'Concurrent ordinary name';
      if (withdrawAfterSecond && observations.length === 2) h.h.identity.user.permissions = [];
      return row;
    };
    h.memberships.savePersonalMember = async () => { writes++; throw Error('no formal partial-profile writer is authorized here'); };
    try {
      const result = await invoke(input), closing = observations.at(-1), first = observations[0];
      assert.equal(observations.length, 2); assert.notEqual(closing.observedAt, first.observedAt);
      const fields = operation === 'prepare' ? result.changes : result.fields;
      assert.equal(result.status, operation === 'prepare' ? 'candidate_only' : 'prepared_not_submitted');
      assert.equal(fields.length, 1); assert.equal(fields[0].field, 'name');
      assert.equal(fields[0].before, closing.candidates[0].name); assert.equal(fields[0].after, input.name);
      assert.deepEqual(fields[0].source, { resourceType: 'membership_candidate', resourceId: input.customerId, observedAt: closing.observedAt });
      if (operation === 'prepare') {
        assert.equal(result.observedAt, closing.observedAt); assert.deepEqual(result.scope, closing.scope);
        assert.equal(result.revision, 'not_loaded'); assert.equal(result.writeAuthorization, 'not_granted');
        assert.equal(result.persistence, 'not_attempted_no_verified_proposal_port');
      } else {
        assert.deepEqual(result.target, { scope: closing.scope, customerId: input.customerId });
        assert.deepEqual(result.sources, [fields[0].source]); assert.equal(result.objectVersion, 'not_loaded');
        assert.equal(result.approval, 'not_created'); assert.equal(result.businessUpdate, 'not_attempted');
        assert.equal(result.persistence, 'not_attempted_no_formal_profile_proposal_port');
      }
      assert.equal(JSON.stringify(result).includes('private-ordinary-source'), false);
      assert.equal(h.membershipRows.customer.name, sourceName); assert.equal(writes, 0);
      observations = []; changeAfterFirst = true;
      const changed = await invoke(input);
      assert.equal(observations.length, 2); assert.equal(changed.status, 'revision_conflict');
      assert.equal(changed.reason, 'member_projection_changed_during_read');
      assert.equal(changed.currentName, observations.at(-1).candidates[0].name);
      assert.equal(changed.observedAt, observations.at(-1).observedAt);
      assert.equal(changed.fields, undefined); assert.equal(changed.changes, undefined);
      assert.equal(changed.businessUpdate, 'not_attempted');
      observations = []; changeAfterFirst = false; withdrawAfterSecond = true;
      await assert.rejects(invoke({ ...input, expectedName: h.membershipRows.customer.name }), error => error.code === 'FORBIDDEN');
      assert.equal(observations.length, 2, 'closing evidence cannot bypass subsequent current withdrawal');
      assert.equal(writes, 0); assert.equal(h.businessFacts.writes.length, 0);
      assert.equal(h.membershipRows.customer.email, 'private-ordinary-source@example.invalid');
    } finally { reader.read = originalRead; reader.clock = originalClock; }
  }
});

test('AIN14 non-notification fields use the real opening Core source without configuration writes', async () => {
  const h = await setup(), before = structuredClone(h.openingConfiguration);
  const item = before.groups[0]; assert.ok(item);
  const product = await h.tools.openingFieldDifference({ key: 'item_groups', targetId: item.id,
    expectedVersion: before.settings.configVersion, changes: [{ field: 'status', value: 'disabled' }] });
  assert.equal(product.status, 'difference_ready'); assert.equal(product.changes[0].before, item.status);
  assert.equal(product.source, 'original_persisted_opening_configuration');
  const pricing = await h.tools.openingFieldDifference({ key: 'pricing_groups_rates', expectedVersion: before.settings.configVersion,
    changes: [{ field: 'defaultUnit', value: before.settings.pricing.defaultUnit }] });
  assert.equal(pricing.status, 'no_change'); assert.deepEqual(pricing.changes, []);
  const fulfillment = await h.tools.openingFieldDifference({ key: 'fulfillment_network', expectedVersion: before.settings.configVersion,
    changes: [{ field: 'enabledModes', value: before.settings.fulfillment.enabledModes }] });
  assert.equal(fulfillment.status, 'no_change'); assert.equal(fulfillment.activeConfiguration, 'unchanged');
  assert.deepEqual(h.openingConfiguration, before); assert.equal(h.tools.openingProposals.availability, 'unavailable');
  assert.equal(h.businessFacts.writes.length, 0);
});

test('real composition prepares current terminology and member name differences without persisting', async () => {
  const h = await setup();
  const profile = h.core.getProfile('tenant_001');
  const section = await h.tools.openingSection({ key: 'workspace_profile' });
  assert.equal(section.status, 'ready_for_human_review');
  assert.equal(section.persistence, 'not_attempted');
  assert.deepEqual(section.manual.navigation, 'host_existing_section');
  await assert.rejects(h.tools.openingSection({ key: '../../secrets' }));
  const out = await h.tools.openingActions.prepareDifference({ expectedVersion: profile.configVersion,
    changes: [{ field: 'itemLabel', value: '合成展示名称' }] });
  assert.equal(out.changes[0].before, profile.terminology.itemLabel); assert.equal(out.changes[0].after, '合成展示名称');
  assert.equal(h.core.getProfile('tenant_001').terminology.itemLabel, profile.terminology.itemLabel);
  const materials = await h.tools.openingActions.requiredMaterials();
  assert.ok(materials.rows.every(row => row.materialDefinition === 'not_loaded_use_original_form'));
  const member = await h.tools.memberProfileDifference.prepare({ customerId: 'customer-a', expectedName: 'Synthetic customer', name: 'Synthetic revised' });
  assert.equal(member.changes[0].before, 'Synthetic customer'); assert.equal(member.writeAuthorization, 'not_granted');
  assert.equal(member.revision, 'not_loaded');
});
test('AIN16 explicit member target is not lost behind the first page and name matches the original DTO', async () => {
  const h = await setup(), queries = [];
  const target = { id: 'customer-a', tenantId: 'tenant_001', name: 'ZZZ selected member', phoneMasked: '138****0000', membership: { status: 'active' } };
  const rows = [...Array.from({ length: 50 }, (_unused, index) => ({ ...target, id: `member-${index}`, name: `Name-${String(index).padStart(2, '0')}` })), target];
  // Declared returned rows over the original service query, not SQL/pagination
  // emulation. Keep the real MembershipService, original Guard and projection.
  h.memberships.prisma.customerProfile.findMany = async query => {
    queries.push(structuredClone(query));
    assert.equal(query.where.tenantId, 'tenant_001');
    return structuredClone((query.where.id ? rows.filter(row => row.id === query.where.id) : rows).slice(0, query.take));
  };
  const material = await h.tools.memberProfileSubmissionMaterial({ customerId: target.id, expectedName: target.name, name: 'N'.repeat(120) });
  assert.equal(material.status, 'prepared_not_submitted');
  assert.equal(material.target.customerId, target.id);
  assert.equal(material.fields[0].before, target.name);
  assert.equal(material.fields[0].after.length, 120);
  assert.equal(material.objectVersion, 'not_loaded');
  assert.equal(material.businessUpdate, 'not_attempted');
  assert.ok(queries.every(query => query.where.id === target.id));
  const reads = queries.length;
  await assert.rejects(h.tools.memberProfileDifference.prepare({ customerId: target.id, expectedName: target.name, name: 'N'.repeat(121) }), error => error.code === 'INVALID_REQUEST');
  assert.equal(queries.length, reads);
});

test('AIN16 changed member names require refreshed differences, never submission or revived access', async () => {
  const h = await setup(), service = h.tools.memberProfileDifference;
  const input = { customerId: 'customer-a', expectedName: 'Synthetic customer', name: 'Requested ordinary name' };
  h.membershipRows.customer.name = 'Current edited name';
  const stale = await service.prepare(input);
  assert.equal(stale.status, 'revision_conflict');
  assert.equal(stale.reason, 'expected_name_mismatch');
  assert.equal(stale.currentName, h.membershipRows.customer.name);
  assert.equal(stale.nextAction, 'refresh_difference_and_reconfirm');
  assert.equal(stale.revision, 'not_loaded');
  assert.equal(stale.comparisonBasis, 'name_only_not_object_revision');
  assert.equal(stale.writeAuthorization, 'not_granted');
  assert.equal(stale.persistence, 'not_attempted');
  assert.equal(stale.approval, 'not_created');
  assert.equal(stale.businessUpdate, 'not_attempted');
  assert.equal(stale.changes, undefined);
  const withheld = await h.tools.memberProfileSubmissionMaterial(input);
  assert.equal(withheld.status, 'revision_conflict');
  assert.equal(withheld.fields, undefined);
  const refreshed = { ...input, expectedName: stale.currentName };
  const candidate = await service.prepare(refreshed);
  assert.equal(candidate.status, 'candidate_only');
  assert.equal(candidate.changes[0].before, stale.currentName);
  assert.equal(candidate.changes[0].after, input.name);
  assert.equal(candidate.persistence, 'not_attempted_no_verified_proposal_port');
  assert.equal(h.membershipRows.customer.name, stale.currentName);
  const find = h.memberships.prisma.customerProfile.findMany.bind(h.memberships.prisma.customerProfile);
  let reads = 0;
  h.memberships.prisma.customerProfile.findMany = async (...args) => {
    const rows = await find(...args);
    if (++reads === 1) h.membershipRows.customer.name = 'Changed during protected read';
    return rows;
  };
  const drift = await service.prepare(refreshed);
  assert.equal(drift.status, 'revision_conflict');
  assert.equal(drift.reason, 'member_projection_changed_during_read');
  assert.equal(drift.currentName, h.membershipRows.customer.name);
  assert.equal(drift.changes, undefined);
  assert.equal(drift.businessUpdate, 'not_attempted');
  reads = 0;
  h.memberships.prisma.customerProfile.findMany = async (...args) => ++reads === 1 ? find(...args) : [];
  await assert.rejects(service.prepare({ ...input, expectedName: h.membershipRows.customer.name }), error => error.code === 'FORBIDDEN');
  reads = 0;
  h.memberships.prisma.customerProfile.findMany = async (...args) => {
    const rows = await find(...args);
    if (++reads === 2) h.h.identity.user.permissions = [];
    return rows;
  };
  await assert.rejects(h.tools.memberProfileSubmissionMaterial(input), error => error.code === 'FORBIDDEN');
});

test('unknown/sensitive fields, stale context and withdrawal refuse difference preparation', async () => {
  const h = await setup();
  await assert.rejects(h.tools.openingActions.prepareDifference({ expectedVersion: 'old', changes: [{ field: 'itemLabel', value: 'new' }] }));
  await assert.rejects(h.tools.openingActions.prepareDifference({ expectedVersion: h.core.getProfile('tenant_001').configVersion, changes: [{ field: 'apiKey', value: 'fake' }] }));
  await assert.rejects(h.tools.memberProfileDifference.prepare({ customerId: 'customer-a', expectedName: 'Synthetic customer', name: 'new', phone: 'fake' }));
  h.h.identity.user.permissions = [];
  await assert.rejects(h.tools.memberProfileDifference.prepare({ customerId: 'customer-a', expectedName: 'Synthetic customer', name: 'new' }));
  await assert.rejects(h.tools.openingActions.requiredMaterials());
});

test('AIN16 unchanged ordinary names are observed without proposal, submission or revived access', async () => {
  const h = await setup(), service = h.tools.memberProfileDifference;
  const originalName = h.membershipRows.customer.name;
  const input = { customerId: 'customer-a', expectedName: originalName, name: originalName };
  h.membershipRows.customer.email = 'preserved-ordinary-profile@example.invalid';
  const find = h.memberships.prisma.customerProfile.findMany.bind(h.memberships.prisma.customerProfile);
  let reads = 0, writes = 0;
  h.memberships.savePersonalMember = async () => { writes++; throw Error('never borrow the original full-profile writer'); };
  h.memberships.prisma.customerProfile.findMany = async query => {
    reads++; assert.equal(query.where.id, input.customerId); return find(query);
  };
  const assertObservation = result => {
    assert.equal(result.status, 'no_change'); assert.equal(result.currentName, originalName);
    assert.deepEqual(result.changes, []); assert.equal(result.revision, 'not_loaded');
    assert.equal(result.comparisonBasis, 'name_only_not_object_revision');
    assert.equal(result.persistence, 'not_attempted'); assert.equal(result.approval, 'not_created');
    assert.equal(result.businessUpdate, 'not_attempted'); assert.equal(result.writeAuthorization, 'not_granted');
    assert.equal(result.sharing, 'tenant_member_master_not_workspace_order_access');
    assert.equal(result.source.resourceId, input.customerId);
    assert.equal(JSON.stringify(result).includes(h.membershipRows.customer.email), false);
  };
  for (const name of [originalName, `  ${originalName}  `]) {
    assertObservation(await service.prepare({ ...input, name }));
    const material = await h.tools.memberProfileSubmissionMaterial({ ...input, name });
    assertObservation(material); assert.equal(material.fields, undefined, 'no prepared submission fields');
  }
  assert.equal(reads, 8, 'each observation retains both original exact member reads');
  await assert.rejects(service.prepare({ ...input, email: 'not-authorized@example.invalid' }), error => error.code === 'INVALID_REQUEST');
  assert.equal(reads, 8, 'matching names do not admit extra fields');
  const stale = await h.tools.memberProfileSubmissionMaterial({ ...input, expectedName: 'Old observed name' });
  assert.equal(stale.status, 'revision_conflict'); assert.equal(stale.changes, undefined);
  reads = 0;
  h.memberships.prisma.customerProfile.findMany = async query => {
    const rows = await find(query); if (++reads === 1) h.membershipRows.customer.name = 'Changed while observing'; return rows;
  };
  const changed = await service.prepare({ ...input, name: 'Changed while observing' });
  assert.equal(changed.status, 'revision_conflict'); assert.equal(changed.reason, 'member_projection_changed_during_read');
  assert.equal(changed.changes, undefined, 'proposed name matching only the closing read is not no-change evidence');
  const current = { ...input, expectedName: h.membershipRows.customer.name, name: h.membershipRows.customer.name };
  reads = 0;
  h.memberships.prisma.customerProfile.findMany = async query => ++reads === 1 ? find(query) : [];
  await assert.rejects(service.prepare(current), error => error.code === 'FORBIDDEN');
  reads = 0;
  h.memberships.prisma.customerProfile.findMany = async query => {
    const rows = await find(query); if (++reads === 2) h.h.identity.user.permissions = []; return rows;
  };
  await assert.rejects(h.tools.memberProfileSubmissionMaterial(current), error => error.code === 'FORBIDDEN');
  assert.equal(writes, 0); assert.equal(h.membershipRows.customer.email, 'preserved-ordinary-profile@example.invalid');
});

test('AIN14 terminology differences retain only changed fields without authorizing a no-op write', async () => {
  const h = await setup(), opening = h.tools.openingActions;
  const profile = structuredClone(h.openingConfiguration.profile), activeProfile = structuredClone(h.core.getProfile('tenant_001'));
  const source = h.core.readOpeningConfiguration.bind(h.core); let reads = 0;
  h.core.readOpeningConfiguration = async (...args) => { reads++; return source(...args); };
  const unchanged = { expectedVersion: profile.configVersion,
    changes: [{ field: 'itemLabel', value: profile.terminology.itemLabel }] };
  const noDifference = await opening.prepareDifference(unchanged);
  assert.deepEqual(noDifference.changes, [], 'equal terminology must not be presented as a business change');
  assert.equal(noDifference.status, 'candidate_only'); assert.equal(noDifference.currentVersion, profile.configVersion);
  assert.equal(noDifference.persistence, 'not_attempted_no_verified_proposal_port');
  assert.equal(noDifference.publication, 'not_attempted');
  assert.equal(noDifference.authorization, 'write_requires_original_permissions_and_approval');
  assert.equal(reads, 2, 'empty output still retains both original protected configuration reads');

  const mixedInput = { ...unchanged, changes: [{ field: 'itemLabel', value: ` ${profile.terminology.itemLabel} ` },
    { field: 'pickupLabel', value: '待确认的普通显示词' }] }, preservedInput = structuredClone(mixedInput);
  const mixed = await opening.prepareDifference(mixedInput);
  assert.deepEqual(mixed.changes.map(row => row.field), ['terminology.pickupLabel']);
  assert.equal(mixed.changes[0].before, profile.terminology.pickupLabel);
  assert.equal(mixed.changes[0].after, '待确认的普通显示词');
  assert.equal(mixed.changes[0].source.version, profile.configVersion);
  assert.equal(mixed.changes[0].impact, 'display_terminology_only_not_business_rules');
  assert.deepEqual(mixedInput, preservedInput, 'trimming does not rewrite the original candidate');
  const batch = await h.tools.openingSectionDifferences({ sections: [{ key: 'workspace_profile', ...unchanged }] });
  assert.equal(batch.rows[0].status, 'prepared'); assert.equal(batch.rows[0].candidate.status, 'candidate_only');
  assert.deepEqual(batch.rows[0].candidate.changes, []); assert.equal(batch.execution, 'not_attempted');
  assert.deepEqual(h.core.getProfile('tenant_001'), activeProfile); assert.equal(h.businessFacts.writes.length, 0);

  await assert.rejects(opening.prepareDifference({ ...unchanged, expectedVersion: 'old-version' }), error => error.code === 'CONFIG_INVALID');
  await assert.rejects(opening.prepareDifference({ ...unchanged, changes: [] }), error => error.code === 'INVALID_REQUEST');
  await assert.rejects(opening.prepareDifference({ ...unchanged, changes: [unchanged.changes[0], unchanged.changes[0]] }), error => error.code === 'INVALID_REQUEST');
  await assert.rejects(opening.prepareDifference({ ...unchanged, changes: [{ field: 'apiKey', value: 'not-authorized' }] }), error => error.code === 'INVALID_REQUEST');
  reads = 0;
  h.core.readOpeningConfiguration = async (...args) => {
    const current = await source(...args);
    if (++reads === 2) current.profile.terminology.itemLabel = 'Changed during protected observation';
    return current;
  };
  await assert.rejects(opening.prepareDifference(unchanged), error => error.code === 'CONFIG_INVALID',
    'equal initial fields cannot hide a changed closing source');
  assert.equal(reads, 2);
  h.core.readOpeningConfiguration = async (...args) => { const current = await source(...args); return { ...current, profile: null }; };
  await assert.rejects(opening.prepareDifference(unchanged), error => error.code === 'PROVIDER_UNAVAILABLE');
  reads = 0;
  h.core.readOpeningConfiguration = async (...args) => {
    const current = await source(...args); if (++reads === 2) h.h.identity.user.permissions = []; return current;
  };
  await assert.rejects(opening.prepareDifference(unchanged), error => error.code === 'FORBIDDEN');
  assert.deepEqual(h.core.getProfile('tenant_001'), activeProfile); assert.equal(h.businessFacts.writes.length, 0);
});
