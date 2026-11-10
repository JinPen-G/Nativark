'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/lane-a-business-consumption.cjs');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
const { ModelGatewayError } = require('../apps/api/src/modules/ai-native/model-gateway.ports');
const { ServiceUnavailableException } = require('@nestjs/common');
test('AIN14 terminology candidate sources use the checked closing observation time', async () => {
  for (const operation of ['difference', 'sections']) {
    const h = await setup(), opening = h.tools.openingActions;
    const beforeConfiguration = structuredClone(h.openingConfiguration), beforeProfile = structuredClone(h.core.getProfile('tenant_001'));
    const read = h.core.readOpeningConfiguration, originalClock = opening.clock;
    let reads = 0, clockCalls = 0, lastReadAt, corruptClosing = false;
    // Only this fixture's metadata clock and returned transport row vary. Actual
    // Core/configuration port and all original current Guards/ALS remain live.
    h.core.readOpeningConfiguration = async function(...args) {
      const value = structuredClone(await read.apply(this, args)); reads++;
      lastReadAt = new Date(Date.parse('2026-11-07T00:00:00Z') + reads * 1000);
      if (corruptClosing && reads % 2 === 0) value.profile.terminology.itemLabel = 'Changed closing source';
      return value;
    };
    opening.clock = () => { clockCalls++; return new Date(lastReadAt); };
    const command = { expectedVersion: h.openingConfiguration.profile.configVersion,
      changes: [{ field: 'itemLabel', value: '已核对的物品名称' }, { field: 'pickupLabel', value: '已核对的取货词' }] };
    const invoke = () => operation === 'difference' ? opening.prepareDifference(command)
      : h.tools.openingSectionDifferences({ sections: [{ key: 'workspace_profile', ...command }] });
    try {
      const result = await invoke(), candidate = operation === 'difference' ? result : result.rows[0].candidate;
      assert.ok(reads >= 2); assert.equal(clockCalls, 1, 'sample one source observation only after protected equality');
      assert.equal(candidate.status, 'candidate_only'); assert.equal(candidate.currentVersion, command.expectedVersion);
      assert.equal(candidate.changes.length, 2);
      for (const change of candidate.changes) {
        const field = change.field.replace('terminology.', '');
        assert.equal(change.before, beforeConfiguration.profile.terminology[field]);
        assert.equal(change.source.observedAt, lastReadAt.toISOString(), 'source uses the actual closing observation, not Auth metadata');
        assert.equal(change.source.version, command.expectedVersion); assert.equal(change.source.scope.workspaceId, 'workspace-a');
        assert.equal(change.impact, 'display_terminology_only_not_business_rules');
      }
      assert.equal(candidate.persistence, 'not_attempted_no_verified_proposal_port'); assert.equal(candidate.publication, 'not_attempted');
      assert.equal(candidate.authorization, 'write_requires_original_permissions_and_approval');
      const beforeInvalidReads = reads;
      opening.clock = () => new Date(NaN);
      await assert.rejects(invoke(), error => error.code === 'CONFIG_INVALID', 'invalid observation metadata cannot become a section revision conflict');
      assert.ok(reads >= beforeInvalidReads + 2);
      corruptClosing = true; clockCalls = 0;
      opening.clock = () => { clockCalls++; return new Date(lastReadAt); };
      await assert.rejects(invoke(), error => error.code === 'CONFIG_INVALID');
      assert.equal(clockCalls, 0, 'do not stamp a changed source as checked');
      corruptClosing = false;
      opening.clock = () => { h.h.identity.user.permissions = []; return new Date(lastReadAt); };
      await assert.rejects(invoke(), error => error.code === 'FORBIDDEN', 'closing observation cannot renew current authority');
      assert.deepEqual(h.openingConfiguration, beforeConfiguration); assert.deepEqual(h.core.getProfile('tenant_001'), beforeProfile);
      assert.equal(h.businessFacts.writes.length, 0); assert.equal(command.expectedVersion, beforeConfiguration.profile.configVersion);
    } finally { h.core.readOpeningConfiguration = read; opening.clock = originalClock; }
  }
});

test('AIN14 all opening consumer paths retain original parents before current Guard waits', async () => {
  for (const operation of ['read', 'readSection', 'prepareSection', 'prepareDifference', 'prepareSections']) {
    const h = await setup(), opening = h.tools.openingActions, authority = opening.authority;
    const acquire = () => authority.withRead('opening', { limit: 50 }, async context => structuredClone(context));
    const parent = await acquire(), originalParent = structuredClone(parent), actor = h.h.identity.user.id;
    const profile = structuredClone(h.core.getProfile('tenant_001')), configuration = structuredClone(h.openingConfiguration);
    const writes = h.businessFacts.writes.length;
    const difference = { expectedVersion: configuration.profile.configVersion,
      changes: [{ field: 'itemLabel', value: '待人工确认的原主体术语' }] };
    const command = operation === 'read' ? {} : operation === 'prepareDifference' ? difference
      : operation === 'prepareSections' ? { sections: [{ key: 'workspace_profile', ...difference }] } : { key: 'workspace_profile' };
    const originalCommand = structuredClone(command), invoke = expected => opening[operation](command, expected);
    const check = value => {
      if (operation === 'read') {
        assert.equal(value.scope.workspaceId, 'workspace-a'); assert.ok(value.sections.some(row => row.key === 'workspace_profile'));
        assert.equal(value.configuration.inventory.coverage, 'not_loaded'); assert.equal(value.risks.coverage, 'not_loaded');
      } else if (operation === 'readSection') {
        assert.equal(value.key, 'workspace_profile'); assert.equal(value.evidence.scope.workspaceId, 'workspace-a');
        assert.equal(value.publication, 'not_attempted'); assert.equal(value.persistence, 'not_attempted');
        assert.equal(value.candidate.persistence, 'unavailable_no_formal_draft_port');
      } else if (operation === 'prepareSection') {
        assert.equal(value.status, 'prepared'); assert.equal(value.configVersion, configuration.profile.configVersion);
        assert.equal(value.persistence, 'not_attempted'); assert.equal(value.publication, 'not_attempted');
        assert.equal(value.sensitive.values, 'not_returned');
      } else {
        const candidate = operation === 'prepareDifference' ? value : value.rows[0].candidate;
        assert.equal(candidate.status, 'candidate_only'); assert.equal(candidate.changes[0].field, 'terminology.itemLabel');
        assert.equal(candidate.currentVersion, configuration.profile.configVersion);
        assert.equal(candidate.persistence, 'not_attempted_no_verified_proposal_port'); assert.equal(candidate.publication, 'not_attempted');
        assert.equal(candidate.authorization, 'write_requires_original_permissions_and_approval');
        if (operation === 'prepareSections') {
          assert.equal(value.status, 'section_candidates'); assert.equal(value.rows[0].status, 'prepared');
          assert.equal(value.atomicity, 'independent_section_results_not_transaction'); assert.equal(value.execution, 'not_attempted');
        }
      }
    };
    check(await invoke({ ...structuredClone(parent), requestId: 'fresh-opening-observation', authorizedAt: '2020-01-01T00:00:00Z' }));
    const originalRead = authority.withRead, coreRead = h.core.readOpeningConfiguration, readiness = h.business.readTenantReadiness;
    let intercepted = false, coreReads = 0, readinessReads = 0;
    h.core.readOpeningConfiguration = function(...args) { coreReads++; return coreRead.apply(this, args); };
    h.business.readTenantReadiness = function(...args) { readinessReads++; return readiness.apply(this, args); };
    authority.withRead = async function(...args) {
      await Promise.resolve();
      if (!intercepted) {
        intercepted = true;
        // Only this waiting caller and the independent synthetic current user
        // change before the original Guard. No grant, Core fact or live profile
        // is forged; the new user must get a genuinely fresh authorized binding.
        parent.actor.userId = 'new-opening-current-reader'; h.h.identity.user.id = parent.actor.userId;
      }
      return originalRead.apply(this, args);
    };
    try {
      await assert.rejects(invoke(parent), error => error.code === 'FORBIDDEN', operation);
      assert.equal(intercepted, true); assert.equal(coreReads, 0); assert.equal(readinessReads, 0);
      authority.withRead = originalRead;
      const current = await acquire(); assert.equal(current.actor.userId, 'new-opening-current-reader');
      check(await invoke(current)); assert.ok(coreReads > 0);
      h.h.identity.user.id = actor; check(await invoke(originalParent));
      h.h.identity.user.permissions = [];
      await assert.rejects(invoke(originalParent), error => error.code === 'FORBIDDEN', 'snapshot cannot survive current withdrawal');
      assert.deepEqual(command, originalCommand); assert.deepEqual(h.openingConfiguration, configuration);
      assert.deepEqual(h.core.getProfile('tenant_001'), profile); assert.equal(h.businessFacts.writes.length, writes);
    } finally { authority.withRead = originalRead; h.core.readOpeningConfiguration = coreRead;
      h.business.readTenantReadiness = readiness; h.h.identity.user.id = actor; }
  }
});

test('actual opening partitions and recheck use current Core/readiness, not the previous list or user assertion', async () => {
  const { tools, business, core } = await setup();
  const current = await tools.openingActions.read();
  assert.equal(current.configuration.products.rows[0].id, core.listItemGroups('tenant_001')[0].id);
  assert.equal(current.configuration.inventory.coverage, 'not_loaded');
  assert.equal(current.configuration.fulfillment.locations[0].id, core.listLocations('tenant_001')[0].id);
  const item = current.sections.find(row => row.key === 'item_groups'); assert.ok(item);
  const still = await tools.openingActions.recheck({ key: item.key });
  assert.equal(still.status, item.status === 'readiness_check_passed' ? 'resolved' : 'still_exists');
  // Inject the disappearance at the actual persisted-reader boundary; the old
  // tenantReadiness quote-context method is no longer on this R0 path.
  const original = business.readTenantReadiness.bind(business);
  business.readTenantReadiness = async (...args) => {
    const out = await original(...args); return { ...out, items: out.items.filter(row => row.key !== item.key) };
  };
  assert.equal((await tools.openingActions.recheck({ key: item.key })).status, 'cannot_determine');
  const pack = await tools.openingActions.prepare({}, 'unavailable');
  assert.equal(pack.payload.model.answer, 'not_generated'); assert.equal(pack.payload.execution, 'not_attempted');
  assert.equal(pack.payloadFingerprint, requestFingerprint(pack.payload));
  const probe = await setup(), query = { from: '2026-11-01T00:00:00Z', to: '2026-11-02T00:00:00Z' };
  const readReport = probe.reports.getBoundedOperationReport.bind(probe.reports);
  const readMetadata = probe.core.readReportConfiguration.bind(probe.core);
  let reportReads = 0;
  probe.reports.getBoundedOperationReport = async (...args) => { reportReads++; return readReport(...args); };
  assert.equal((await probe.tools.openingActions.read()).risks.coverage, 'not_loaded');
  assert.equal(reportReads, 0, 'unrequested risk source is never loaded');
  const requested = await probe.tools.openingActions.read({ risks: query });
  assert.equal(requested.risks.coverage, 'partial');
  assert.equal(requested.risks.value.currency, 'CNY');
  assert.equal(requested.risks.value.profit.status, 'unavailable');
  for (const source of ['report', 'metadata']) {
    for (const error of [new Error('unclassified raw risk source fault'), new ModelGatewayError('INVALID_RESPONSE'),
      new ModelGatewayError('FORBIDDEN'), new ModelGatewayError('RATE_LIMITED')]) {
      probe.reports.getBoundedOperationReport = source === 'report' ? async () => { throw error; } : readReport;
      probe.core.readReportConfiguration = source === 'metadata' ? async () => { throw error; } : readMetadata;
      // The original Guard's generic normalized error is not proof that the
      // explicitly requested source may be replaced by partial success.
      await assert.rejects(probe.tools.openingActions.read({ risks: query }),
        cause => cause.code === (error instanceof ModelGatewayError ? error.code : 'PROVIDER_UNAVAILABLE'));
    }
    for (const error of [new ServiceUnavailableException('synthetic declared risk source outage'), new ModelGatewayError('TIMEOUT')]) {
      probe.reports.getBoundedOperationReport = source === 'report' ? async () => { throw error; } : readReport;
      probe.core.readReportConfiguration = source === 'metadata' ? async () => { throw error; } : readMetadata;
      const partial = await probe.tools.openingActions.read({ risks: query });
      assert.equal(partial.risks.coverage, 'unavailable'); assert.equal(partial.risks.value, undefined);
      assert.equal(partial.ready, current.ready);
    }
  }
  probe.reports.getBoundedOperationReport = readReport;
  let reportFinished = false;
  probe.core.readReportConfiguration = async (...args) => {
    const metadata = await readMetadata(...args); return reportFinished ? { ...metadata, currency: 'USD' } : metadata;
  };
  probe.reports.getBoundedOperationReport = async (...args) => { const result = await readReport(...args); reportFinished = true; return result; };
  await assert.rejects(probe.tools.risks.read(query), error => error.code === 'CONFIG_INVALID');
  reportFinished = false;
  await assert.rejects(probe.tools.openingActions.read({ risks: query }), error => error.code === 'CONFIG_INVALID');
  probe.core.readReportConfiguration = readMetadata;
  probe.reports.getBoundedOperationReport = async () => {
    probe.h.identity.user.permissions = []; throw new ServiceUnavailableException('synthetic outage during withdrawal');
  };
  await assert.rejects(probe.tools.openingActions.read({ risks: query }), error => error.code === 'FORBIDDEN');
});
test('recheck and deterministic fallback cannot outlive current diagnostic permission', async () => {
  const { tools, h } = await setup(); h.identity.user.permissions = [];
  await assert.rejects(tools.openingActions.recheck({ key: 'item_groups' }));
  await assert.rejects(tools.openingActions.prepare({}, 'unavailable'));
  await assert.rejects(tools.openingActions.recheck({ key: 'item_groups', fixed: true }));
});
test('AIN14 section candidates retain one original principal across preparation and differences', async () => {
  const { tools, h, openingConfiguration } = await setup();
  const sections = [
    { key: 'workspace_profile', expectedVersion: openingConfiguration.profile.configVersion,
      changes: [{ field: 'itemLabel', value: '受控显示名称' }] },
    { key: 'item_groups', expectedVersion: openingConfiguration.settings.configVersion, changes: [] }
  ];
  const normal = await tools.openingActions.prepareSections({ sections });
  assert.equal(normal.rows[0].status, 'prepared');
  assert.equal(normal.rows[0].candidate.persistence, 'not_attempted_no_verified_proposal_port');
  assert.equal(normal.rows[1].status, 'unavailable');
  assert.equal(normal.execution, 'not_attempted');
  const prepare = tools.openingActions.prepareSection.bind(tools.openingActions);
  tools.openingActions.prepareSection = async (...args) => {
    const result = await prepare(...args);
    // Explicitly switch this synthetic Auth fixture between awaited stages;
    // same workspace/version is not proof this is the original principal.
    h.identity.user.id = 'another-current-reader';
    return result;
  };
  await assert.rejects(tools.openingActions.prepareSections({ sections }), error => error.code === 'FORBIDDEN');
});
test('AIN14 configuration leaf retains the enclosing principal for reads and terminology preparation', async () => {
  const { getRequestIdentity } = require('../apps/api/src/common/request-identity');
  const shared = require('@rental-os/shared'), contracts = require('./fixtures/ai-native/contract-consumer.cjs');
  const defs = Object.assign({}, ...Object.entries(shared).filter(([name]) => name.endsWith('_SCHEMAS')).map(([, schemas]) => schemas));
  const validate = contracts.validatorsFor({ AiOpeningSectionObservationDraft:
    shared.AI_SCENE_MODEL_OBSERVATION_SCHEMAS.AiOpeningSectionObservationDraft }, defs);
  for (const operation of ['read', 'readSection', 'prepareDifference', 'prepareSections']) {
    const { tools, core, h, openingConfiguration } = await setup(), opening = tools.openingActions;
    const change = { expectedVersion: openingConfiguration.profile.configVersion,
      changes: [{ field: 'itemLabel', value: '原主体待确认的术语' }] };
    const consume = () => operation === 'read' ? opening.read()
      : operation === 'readSection' ? opening.readSection({ key: 'workspace_profile' })
      : operation === 'prepareDifference' ? opening.prepareDifference(change)
      : opening.prepareSections({ sections: [{ key: 'workspace_profile', ...change }] });
    const normal = await consume();
    if (operation === 'readSection') assert.equal(validate.AiOpeningSectionObservationDraft(normal), true,
      JSON.stringify(validate.AiOpeningSectionObservationDraft.errors));
    if (operation === 'prepareDifference') assert.equal(normal.persistence, 'not_attempted_no_verified_proposal_port');
    if (operation === 'prepareSections') assert.equal(normal.rows[0].candidate.persistence, 'not_attempted_no_verified_proposal_port');
    const unchangedProfile = structuredClone(core.getProfile('tenant_001'));
    const source = opening.contexts, current = source.current.bind(source), read = core.readOpeningConfiguration.bind(core);
    const actor = h.identity.user.id; let leafReads = 0, coreReads = 0;
    core.readOpeningConfiguration = async (...args) => {
      coreReads++; assert.equal(getRequestIdentity().userId, 'another-config-leaf-reader');
      return read(...args);
    };
    source.current = async (...args) => {
      // Only this real nested configuration Guard sees B. It completes its own
      // before/after checks as B, then A is restored before enclosing rereads.
      // Equal scope/configuration and the final owner cannot attest that source.
      leafReads++; h.identity.user.id = 'another-config-leaf-reader';
      try { return await current(...args); }
      finally { h.identity.user.id = actor; }
    };
    await assert.rejects(consume(), error => error.code === 'FORBIDDEN', operation);
    assert.equal(leafReads, 1, 'reject at the first actual nested configuration Guard');
    assert.equal(coreReads, 0, 'another principal must not enter the Core configuration reader');
    assert.equal(h.identity.user.id, actor);
    assert.deepEqual(core.getProfile('tenant_001'), unchangedProfile, 'no active configuration write');
    source.current = current; core.readOpeningConfiguration = read;
  }
});

test('AIN14 independent sections retain revision conflicts and declared availability failures without execution', async () => {
  const { tools, core, business, openingConfiguration } = await setup();
  const opening = tools.openingActions;
  const profile = { key: 'workspace_profile', expectedVersion: openingConfiguration.profile.configVersion,
    changes: [{ field: 'itemLabel', value: '等待重新确认的名称' }] };
  const item = { key: 'item_groups', expectedVersion: openingConfiguration.settings.configVersion, changes: [] };
  const stale = await opening.prepareSections({ sections: [{ ...profile, expectedVersion: 'old-version' }, item] });
  assert.deepEqual(stale.rows.map(row => row.status), ['revision_conflict', 'unavailable']);
  assert.equal(stale.rows[0].reason, 'expected_version_mismatch');
  assert.equal(stale.rows[0].nextAction, 'refresh_difference_and_reconfirm');
  assert.equal(stale.rows[0].candidate, undefined);
  assert.equal(stale.rows[0].persistence, 'not_attempted');
  assert.equal(stale.rows[0].publication, 'not_attempted');
  assert.equal(stale.atomicity, 'independent_section_results_not_transaction');
  assert.equal(stale.execution, 'not_attempted');
  const prepare = opening.prepareSection.bind(opening), read = core.readOpeningConfiguration.bind(core);
  const readiness = business.readTenantReadiness.bind(business);
  const failures = ['CAPABILITY_UNSUPPORTED', 'PROVIDER_UNAVAILABLE', 'TIMEOUT'].map(code => ({ code, error: new ModelGatewayError(code) }));
  failures.push({ code: 'PROVIDER_UNAVAILABLE', error: new ServiceUnavailableException('synthetic declared source outage') });
  // Faults originate inside the real source callback, before original Guard
  // normalization; replacing prepareSection itself would miss this boundary.
  for (const source of ['configuration', 'readiness']) for (const { code, error } of failures) {
    opening.prepareSection = async (...args) => {
      core.readOpeningConfiguration = source === 'configuration' && args[0].key === item.key ? async () => { throw error; } : read;
      business.readTenantReadiness = source === 'readiness' && args[0].key === item.key ? async () => { throw error; } : readiness;
      return prepare(...args);
    };
    const partial = await opening.prepareSections({ sections: [item, profile] });
    assert.deepEqual(partial.rows.map(row => row.status), ['unavailable', 'prepared']);
    assert.equal(partial.rows[0].reason, 'section_source_unavailable');
    assert.equal(partial.rows[0].sourceError, code);
    assert.equal(partial.rows[0].candidate, undefined);
    assert.equal(partial.rows[1].candidate.persistence, 'not_attempted_no_verified_proposal_port');
    assert.equal(partial.execution, 'not_attempted');
  }
  core.readOpeningConfiguration = read; business.readTenantReadiness = readiness;
  opening.prepareSection = async (...args) => {
    const result = await prepare(...args);
    let reads = 0;
    core.readOpeningConfiguration = async (...query) => {
      const snapshot = await read(...query);
      if (++reads === 2) snapshot.profile.configVersion = 'changed-during-read';
      return snapshot;
    };
    return result;
  };
  const changed = await opening.prepareSections({ sections: [profile] });
  assert.equal(changed.rows[0].status, 'revision_conflict');
  assert.equal(changed.rows[0].reason, 'configuration_changed_during_read');
  assert.equal(changed.rows[0].candidate, undefined);
  assert.equal(openingConfiguration.profile.terminology.itemLabel, core.getProfile('tenant_001').terminology.itemLabel);
});
test('AIN14 partial results never mask invalid sources, malformed changes or current withdrawal', async () => {
  const { tools, core, business, h, openingConfiguration } = await setup();
  const opening = tools.openingActions;
  const profile = { key: 'workspace_profile', expectedVersion: openingConfiguration.profile.configVersion,
    changes: [{ field: 'itemLabel', value: '保持原权限' }] };
  const item = { key: 'item_groups', expectedVersion: openingConfiguration.settings.configVersion, changes: [] };
  const prepare = opening.prepareSection.bind(opening), read = core.readOpeningConfiguration.bind(core);
  const readiness = business.readTenantReadiness.bind(business);
  for (const source of ['configuration', 'readiness']) for (const error of [new ModelGatewayError('FORBIDDEN'), new ModelGatewayError('INVALID_RESPONSE'),
    new ModelGatewayError('CONFIG_INVALID'), new Error('unclassified failure')]) {
    opening.prepareSection = async (...args) => {
      core.readOpeningConfiguration = source === 'configuration' && args[0].key === item.key ? async () => { throw error; } : read;
      business.readTenantReadiness = source === 'readiness' && args[0].key === item.key ? async () => { throw error; } : readiness;
      return prepare(...args);
    };
    // The original route authority normalizes unknown errors. Its generic
    // PROVIDER_UNAVAILABLE is not a declared-source partial-result witness.
    await assert.rejects(opening.prepareSections({ sections: [profile, item] }),
      cause => cause.code === (error instanceof ModelGatewayError ? error.code : 'PROVIDER_UNAVAILABLE'));
  }
  core.readOpeningConfiguration = read; business.readTenantReadiness = readiness; opening.prepareSection = prepare;
  await assert.rejects(opening.prepareSections({ sections: [{ ...item, changes: [profile.changes[0], profile.changes[0]] }] }),
    error => error.code === 'INVALID_REQUEST');
  opening.prepareSection = async (...args) => {
    core.readOpeningConfiguration = args[0].key === item.key ? async () => {
      h.identity.user.permissions = []; throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
    } : read;
    return prepare(...args);
  };
  await assert.rejects(opening.prepareSections({ sections: [profile, item] }));
});

test('AIN14 absent persisted workspace profile preserves independent unavailable sections without borrowing defaults', async () => {
  const h = await setup(), opening = h.tools.openingActions;
  const cachedProfile = structuredClone(h.core.getProfile('tenant_001'));
  const profile = { key: 'workspace_profile', expectedVersion: h.openingConfiguration.profile.configVersion,
    changes: [{ field: 'itemLabel', value: '等待真实术语来源' }] };
  const item = { key: 'item_groups', expectedVersion: h.openingConfiguration.settings.configVersion, changes: [] };
  h.openingConfiguration.profile = null;
  await assert.rejects(opening.prepareDifference({ expectedVersion: profile.expectedVersion, changes: profile.changes }),
    error => error.code === 'PROVIDER_UNAVAILABLE', 'direct difference remains unavailable, never a default-profile draft');
  const partial = await opening.prepareSections({ sections: [profile, item] });
  assert.equal(partial.status, 'section_candidates'); assert.deepEqual(partial.rows.map(row => row.status), ['unavailable', 'unavailable']);
  assert.equal(partial.rows[0].reason, 'section_source_unavailable'); assert.equal(partial.rows[0].sourceError, 'PROVIDER_UNAVAILABLE');
  assert.equal(partial.rows[0].candidate, undefined); assert.equal(partial.rows[0].persistence, 'not_attempted');
  assert.equal(partial.rows[0].publication, 'not_attempted'); assert.equal(partial.rows[0].expectedVersion, profile.expectedVersion);
  assert.equal(partial.rows[1].reason, 'formal_section_field_reader_not_exposed');
  assert.equal(partial.atomicity, 'independent_section_results_not_transaction'); assert.equal(partial.execution, 'not_attempted');
  assert.deepEqual(h.core.getProfile('tenant_001'), cachedProfile, 'a cached default profile is not this missing persisted source');
  const source = opening.contexts, current = source.current.bind(source);
  for (const fault of ['same_code', 'missing_property']) {
    source.current = async (...args) => {
      const snapshot = await current(...args);
      // These are outside the real source callback: a generic same-code fault
      // or corrupt projection is not an actual-null profile availability marker.
      if (fault === 'same_code') throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
      return { ...snapshot, profile: undefined };
    };
    await assert.rejects(opening.prepareSections({ sections: [profile, item] }), error => error.code === 'PROVIDER_UNAVAILABLE');
  }
  source.current = current;
  const read = h.core.readOpeningConfiguration.bind(h.core);
  h.core.readOpeningConfiguration = async (...args) => {
    const snapshot = await read(...args); h.h.identity.user.permissions = []; return snapshot;
  };
  await assert.rejects(opening.prepareSections({ sections: [profile, item] }), error => error.code === 'FORBIDDEN',
    'late withdrawal cannot be replaced by independent unavailable rows');
});

test('AIN14 readiness is reobserved after waits instead of treating stable config as stable checks', async () => {
  const query = { from: '2026-11-01T00:00:00Z', to: '2026-11-02T00:00:00Z' };
  for (const operation of ['read', 'recheck', 'readSection', 'prepareSection', 'requiredMaterials']) {
    const h = await setup(), opening = h.tools.openingActions, profile = structuredClone(h.core.getProfile('tenant_001'));
    const readiness = h.business.readTenantReadiness.bind(h.business), configuration = h.core.readOpeningConfiguration.bind(h.core);
    const report = h.reports.getBoundedOperationReport.bind(h.reports);
    let changed = false, readinessReads = 0, configurationReads = 0;
    h.business.readTenantReadiness = async (...args) => {
      readinessReads++; const current = await readiness(...args);
      if (!changed) return current;
      return { ...current, items: current.items.map(row => row.key === 'accounts_roles'
        ? { ...row, done: !row.done, missing: 'Changed original account/role readiness' } : row) };
    };
    h.reports.getBoundedOperationReport = async (...args) => { const result = await report(...args); changed = true; return result; };
    h.core.readOpeningConfiguration = async (...args) => {
      const result = await configuration(...args); if (++configurationReads === 2 && operation !== 'read') changed = true; return result;
    };
    const consume = () => operation === 'read' ? opening.read({ risks: query })
      : operation === 'recheck' ? opening.recheck({ key: 'accounts_roles' })
      : operation === 'readSection' ? h.tools.openingSection({ key: 'accounts_roles' })
      : operation === 'prepareSection' ? opening.prepareSection({ key: 'accounts_roles' }) : opening.requiredMaterials();
    await assert.rejects(consume(), error => error.code === 'CONFIG_INVALID', `${operation}: reject changed current readiness, not stale status`);
    assert.equal(readinessReads, 2, 'same bounded readiness source, one closing observation only');
    assert.equal(configurationReads, 2, 'no extra configuration scans or version replacement');
    assert.deepEqual(h.core.getProfile('tenant_001'), profile); assert.equal(h.businessFacts.writes.length, 0);
  }
  const stable = await setup(), opening = stable.tools.openingActions;
  const readiness = stable.business.readTenantReadiness.bind(stable.business); let reads = 0, at = Date.parse('2026-11-01T00:00:00Z');
  opening.opening.clock = () => new Date(at += 1000);
  stable.business.readTenantReadiness = async (...args) => { const current = await readiness(...args); return ++reads === 2
    ? { ...current, items: current.items.slice().reverse() } : current; };
  const result = await opening.read();
  assert.equal(reads, 2, 'changed observation time/presentation order is not a changed readiness fact');
  assert.equal(result.observedAt, new Date(at).toISOString(), 'use the closing original source observation time');
  assert.equal(result.atomicity, 'independent_sections_not_a_transaction');

  for (const [fault, code] of [['invalid_response', 'INVALID_RESPONSE'], ['unknown', 'PROVIDER_UNAVAILABLE'], ['withdrawal', 'FORBIDDEN']]) {
    const h = await setup(), read = h.business.readTenantReadiness.bind(h.business); let calls = 0;
    h.business.readTenantReadiness = async (...args) => {
      const current = await read(...args); if (++calls !== 2) return current;
      if (fault === 'invalid_response') return { ...current, items: [...current.items, current.items[0]] };
      if (fault === 'unknown') throw new Error('unclassified closing readiness failure');
      h.h.identity.user.permissions = []; return current;
    };
    await assert.rejects(h.tools.openingActions.read(), error => error.code === code, `${fault}: closing failure does not become solved/partial success`);
  }
  const partial = await setup(), read = partial.business.readTenantReadiness.bind(partial.business); let calls = 0;
  partial.business.readTenantReadiness = async (...args) => {
    if (++calls === 2) throw new ServiceUnavailableException('declared closing readiness outage'); return read(...args);
  };
  const batch = await partial.tools.openingActions.prepareSections({ sections: [
    { key: 'workspace_profile', expectedVersion: partial.openingConfiguration.profile.configVersion,
      changes: [{ field: 'itemLabel', value: 'Explicit ordinary terminology' }] },
    { key: 'item_groups', expectedVersion: partial.openingConfiguration.settings.configVersion, changes: [] }
  ] });
  assert.deepEqual(batch.rows.map(row => row.status), ['unavailable', 'unavailable']);
  assert.equal(batch.rows[0].reason, 'section_source_unavailable'); assert.equal(batch.rows[0].candidate, undefined);
  assert.equal(batch.rows[1].reason, 'formal_section_field_reader_not_exposed'); assert.equal(batch.execution, 'not_attempted');
});
