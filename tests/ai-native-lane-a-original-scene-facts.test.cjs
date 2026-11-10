'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
require('ts-node').register({ transpileOnly: false, compilerOptions: { rootDir: path.resolve(__dirname, '..'), module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/lane-a-original-request.cjs');

test('AIN15 original quote comparison reports final ownership receipts across expiry without quote or approval renewal', async () => {
  const shared = require('@rental-os/shared');
  const defs = Object.assign({}, ...Object.entries(shared).filter(([name]) => name.endsWith('_SCHEMAS') || name.endsWith('_SCHEMAS_V2')).map(([, schemas]) => schemas));
  const valid = require('./fixtures/ai-native/contract-consumer.cjs').validatorsFor(shared.AI_SCENE_QUOTE_HTTP_SCHEMAS, defs);
  for (const boundary of ['expiry', 'current_access']) {
    const h = await setup({}, true), savedQuotes = [];
    h.b.businessFacts.findQuoteForOriginalOperation = async (tenantId, proof) => {
      const row = savedQuotes.find(row => row.quote.tenantId === tenantId && row.key === proof.key);
      if (row && row.inputHash !== proof.inputHash) throw Error('Original quote input conflict');
      return row && structuredClone(row.quote);
    };
    h.b.businessFacts.findQuoteForOriginalReference = async (tenantId, key) => {
      const row = savedQuotes.find(row => row.quote.tenantId === tenantId && row.key === key); return row && structuredClone(row.quote);
    };
    h.b.businessFacts.saveQuoteForOriginalOperation = async (quote, proof) => {
      const original = await h.b.businessFacts.findQuoteForOriginalOperation(quote.tenantId, proof);
      if (original) return original;
      savedQuotes.push({ ...proof, quote: structuredClone(quote) }); return structuredClone(quote);
    };
    h.b.facts.listAssets = async () => [{ id: 'final-comparison-asset', tenantId: 'tenant_001', workspaceId: 'workspace-a',
      itemGroupId: h.b.group.id, locationId: h.b.location.id, status: 'available' }];
    h.b.facts.listStockBalances = async () => [{ itemGroupId: h.b.group.id, locationId: h.b.location.id, onHandQuantity: 3, maintenanceQuantity: 0 }];
    const build = async (candidate, key) => {
      const prepared = await h.b.tools.quote.candidates.prepare(candidate), command = h.command('quote_clarification', key);
      command.input.candidate = { ...candidate, selectionRevision: prepared.selectionRevision };
      const created = await h.app.create(command), ref = h.ref(created.receipt.inputRef), review = await h.app.reviewQuote(ref);
      const result = await h.app.confirmQuote({ ...ref, selectionRevision: review.sources.selectionRevision,
        inputFingerprint: review.sources.inputFingerprint, confirmQuote: true });
      assert.equal(result.result.status, 'quoted'); assert.equal(result.result.quotePersistence, 'saved');
      return { ref, receipt: await h.app.readQuoteReceipt(ref) };
    };
    const candidate = { ...h.b.candidate, bookingIdentity: { bookingIdentity: 'personal' } };
    const previous = await build(candidate, 'final-owner-previous');
    const current = await build({ ...candidate, end: '2026-11-12T09:00:00+08:00' }, 'final-owner-current');
    assert.equal(savedQuotes.length, 2);
    const query = { previous: previous.ref, current: current.ref }, originalQuery = structuredClone(query), beforeQuotes = structuredClone(savedQuotes);
    const stateHash = () => require('../apps/api/src/modules/rental-core/rental-idempotency.repository').requestFingerprint(
      JSON.parse(JSON.stringify(h.state, (_key, value) => typeof value === 'bigint' ? value.toString() : value)));
    const beforeState = stateHash(), writes = h.b.businessFacts.writes.length;
    const expiry = Math.max(Date.parse(previous.receipt.original.expiresAt), Date.parse(current.receipt.original.expiresAt)) + 1;
    const history = h.app.requests.readHistorical, last = new Map(); let reads = 0;
    h.app.requests.readHistorical = async function(...args) {
      reads++;
      // Eight quote-source history observations follow two original-owner reads.
      // Cross expiry only AFTER all four Core observations, at the final owner
      // window. No request/quote expiry, amount, hash or stored row is changed.
      if (boundary === 'current_access' && reads === 12) h.b.h.identity.session = false;
      const observed = await history.apply(this, args);
      if (reads <= 10) assert.equal(observed.receipt.state, 'stored');
      if (reads === 10) h.b.h.control.now = expiry;
      if (reads >= 11) last.set(observed.receipt.inputRef, observed.receipt);
      return observed;
    };
    try {
      if (boundary === 'expiry') {
        const result = await h.app.compareOriginalQuotes(query);
        assert.equal(reads, 12); assert.equal(result.status, 'compared');
        for (const [value, original] of [[result.previous, previous], [result.current, current]]) {
          assert.equal(value.original.state, 'expired'); assert.deepEqual(value.original, last.get(original.ref.inputRef));
          assert.equal(value.original.expiresAt, original.receipt.original.expiresAt); assert.equal(value.original.contentHash, original.receipt.original.contentHash);
          assert.deepEqual(value.result.quote, original.receipt.result.quote);
          assert.equal(value.result.quotePersistence, 'saved'); assert.equal(value.result.status, original.receipt.result.status,
            'final original ownership reads do not manufacture a new Core quote observation');
        }
        assert.equal(result.comparison.inputChanges.period, true); assert.equal(result.comparison.coreAmounts.arithmetic, 'not_recomputed_by_ai_layer');
        assert.equal(result.comparison.approvalReuse, 'forbidden_new_quote_requires_new_confirmation');
        assert.equal(result.quotation, 'not_attempted'); assert.equal(result.inventoryReservation, 'not_attempted'); assert.equal(result.orderApproval, 'not_granted');
        assert.equal(valid.AiOriginalQuotesCompareResponseDraft(result), true, JSON.stringify(valid.AiOriginalQuotesCompareResponseDraft.errors));
        await assert.rejects(h.app.requests.read(current.ref), error => error.code === 'AI_ACCESS_DENIED');
      } else {
        await assert.rejects(h.app.compareOriginalQuotes(query), error => error.code === 'AI_ACCESS_DENIED');
        assert.equal(reads, 12, 'the final owner cannot be withdrawn while old quote comparison escapes');
      }
      assert.equal(stateHash(), beforeState); assert.equal(h.b.businessFacts.writes.length, writes);
      assert.deepEqual(savedQuotes, beforeQuotes); assert.deepEqual(query, originalQuery); assert.equal(savedQuotes.length, 2);
    } finally { h.app.requests.readHistorical = history; }
  }
});

test('AIN15 original quote history returns the closing receipt across natural expiry without renewing execution', async () => {
  for (const boundary of ['expiry', 'current_access']) {
    const h = await setup({}, true), storedQuotes = [];
    h.b.businessFacts.findQuoteForOriginalOperation = async (tenantId, proof) => {
      const row = storedQuotes.find(row => row.quote.tenantId === tenantId && row.key === proof.key);
      if (row && row.inputHash !== proof.inputHash) throw Error('original quote input conflict');
      return row && structuredClone(row.quote);
    };
    h.b.businessFacts.findQuoteForOriginalReference = async (tenantId, key) => {
      const row = storedQuotes.find(row => row.quote.tenantId === tenantId && row.key === key); return row && structuredClone(row.quote);
    };
    h.b.businessFacts.saveQuoteForOriginalOperation = async (quote, proof) => {
      const previous = await h.b.businessFacts.findQuoteForOriginalOperation(quote.tenantId, proof);
      if (previous) return previous;
      storedQuotes.push({ ...proof, quote: structuredClone(quote) }); return structuredClone(quote);
    };
    // Same original Core operation; only storage/inventory leaves are the
    // existing isolated fixture. Never substitute a latest or invented quote.
    h.b.facts.listAssets = async () => [{ id: 'closing-quote-asset', tenantId: 'tenant_001', workspaceId: 'workspace-a',
      itemGroupId: h.b.group.id, locationId: h.b.location.id, status: 'available' }];
    h.b.facts.listStockBalances = async () => [{ itemGroupId: h.b.group.id, locationId: h.b.location.id, onHandQuantity: 3, maintenanceQuantity: 0 }];
    const candidate = { ...h.b.candidate, bookingIdentity: { bookingIdentity: 'personal' } };
    const prepared = await h.b.tools.quote.candidates.prepare(candidate), command = h.command('quote_clarification');
    command.input.candidate = { ...candidate, selectionRevision: prepared.selectionRevision };
    const created = await h.app.create(command), ref = h.ref(created.receipt.inputRef), review = await h.app.reviewQuote(ref);
    const confirm = { ...ref, selectionRevision: review.sources.selectionRevision, inputFingerprint: review.sources.inputFingerprint, confirmQuote: true };
    const saved = await h.app.confirmQuote(confirm); assert.equal(saved.result.status, 'quoted'); assert.equal(storedQuotes.length, 1);
    const baseline = await h.app.readQuoteReceipt(ref); assert.equal(baseline.original.state, 'stored');
    const row = h.state.aiTaskOriginalRequest.find(row => row.id === ref.inputRef), beforeRow = structuredClone(row);
    const beforeTasks = structuredClone(h.state.aiTask), beforeQuotes = structuredClone(storedQuotes), writes = h.b.businessFacts.writes.length;
    const historical = h.app.requests.readHistorical; let reads = 0, first, closing;
    h.app.requests.readHistorical = async function(...args) {
      reads++;
      // The Core observation has returned before this closing call. Withdraw
      // the synthetic session at the existing repository, not the frozen facade.
      if (boundary === 'current_access' && reads === 2) h.b.h.identity.session = false;
      const observed = await historical.apply(this, args);
      if (reads === 1) {
        first = observed.receipt;
        // Advance only the existing trusted clock; do not change a real expired
        // request, this stored row's expiry/status/hash, or the saved Core quote.
        if (boundary === 'expiry') h.b.h.control.now = row.expiresAt.getTime() + 1;
      } else closing = observed.receipt;
      return observed;
    };
    try {
      if (boundary === 'expiry') {
        const current = await h.app.readQuoteReceipt(ref);
        assert.equal(reads, 2); assert.equal(first.state, 'stored'); assert.equal(closing.state, 'expired');
        assert.deepEqual(current.original, closing);
        assert.equal(current.original.expiresAt, created.receipt.expiresAt); assert.equal(current.original.contentHash, created.receipt.contentHash);
        assert.equal(current.result.quote.id, baseline.result.quote.id); assert.equal(current.result.quotePersistence, 'saved');
        assert.equal(current.observation, 'original_operation_only'); assert.equal(current.selection, 'historical_not_current_confirmation');
        assert.equal(current.orderApproval, 'not_granted'); assert.equal(current.inventoryReservation, 'not_attempted');
        await assert.rejects(h.app.requests.read(ref), error => error.code === 'AI_ACCESS_DENIED');
        await assert.rejects(h.app.confirmQuote(confirm), error => error.code === 'AI_ACCESS_DENIED');
      } else {
        await assert.rejects(h.app.readQuoteReceipt(ref), error => error.code === 'AI_ACCESS_DENIED');
        assert.equal(reads, 2, 'closing current access is checked after the original Core receipt read');
      }
      assert.deepEqual(row, beforeRow); assert.deepEqual(h.state.aiTask, beforeTasks);
      assert.deepEqual(storedQuotes, beforeQuotes); assert.equal(h.b.businessFacts.writes.length, writes);
    } finally { h.app.requests.readHistorical = historical; }
  }
});

test('AIN13 AIN14 historical observations return closing receipts across natural expiry', async () => {
  const shared = require('@rental-os/shared');
  const invoke = (h, kind, reference) => kind === 'opening'
    ? h.app.readOpeningSection({ ...reference, key: 'item_groups' })
    : kind === 'citation_v1' ? h.app.reopenOrderCitation({ ...reference, version: '2026-01-01T00:00:00Z', field: 'order' })
    : h.app.reopenOrderCitationV2({ ...reference, materialVersion: shared.AI_ORDER_EXPLANATION_MATERIAL_V2_VERSION,
      version: '2026-01-01T00:00:00Z', field: 'order' });
  for (const kind of ['opening', 'citation_v1', 'citation_v2']) {
    const h = await setup(); if (kind !== 'opening') declareOriginalOrderProjection(h);
    const created = await h.app.create(h.command(kind === 'opening' ? 'opening_diagnosis' : 'order_explanation'));
    const reference = h.ref(created.receipt.inputRef), row = h.state.aiTaskOriginalRequest.find(value => value.id === reference.inputRef);
    const beforeRow = structuredClone(row), beforeTasks = structuredClone(h.state.aiTask), writes = h.b.businessFacts.writes.length;
    const normal = await invoke(h, kind, reference);
    assert.equal(normal.original.state, 'stored'); assert.equal(normal.execution, 'not_attempted');
    const read = h.app.requests.readHistorical; let reads = 0, first, last;
    // Advance only the fixture's existing trusted server clock after the first
    // real historical read. Stored expiry/hash/status and all authorization
    // machinery remain unchanged; never edit the real expired requests or ACK.
    h.app.requests.readHistorical = async function(...args) {
      const observed = await read.apply(this, args);
      if (++reads === 1) { first = observed.receipt; h.b.h.control.now = new Date(row.expiresAt.getTime() + 1); }
      else last = observed.receipt;
      return observed;
    };
    let current;
    try { current = await invoke(h, kind, reference); }
    finally { h.app.requests.readHistorical = read; }
    assert.equal(reads, 2); assert.equal(first.state, 'stored'); assert.equal(last.state, 'expired');
    assert.deepEqual(current.original, last, `${kind}: publish the closing original receipt, not the first state`);
    assert.equal(current.original.expiresAt, created.receipt.expiresAt); assert.equal(current.original.contentHash, created.receipt.contentHash);
    assert.equal(current.execution, 'not_attempted');
    if (kind === 'opening') { assert.equal(current.section.key, 'item_groups'); assert.equal(current.proposalPersistence, 'unavailable_no_formal_section_proposal_port'); }
    else { assert.equal(current.source.status, 'available'); assert.equal(current.source.orderId, 'order-a'); }
    await assert.rejects(h.app.requests.read(reference), error => error.code === 'AI_ACCESS_DENIED', 'historical availability does not renew new-effect access');
    assert.deepEqual(row, beforeRow); assert.deepEqual(h.state.aiTask, beforeTasks); assert.equal(h.b.businessFacts.writes.length, writes);

    const revoked = await setup(); if (kind !== 'opening') declareOriginalOrderProjection(revoked);
    const old = await revoked.app.create(revoked.command(kind === 'opening' ? 'opening_diagnosis' : 'order_explanation'));
    const ref = revoked.ref(old.receipt.inputRef), originalRow = revoked.state.aiTaskOriginalRequest.find(value => value.id === ref.inputRef);
    const historical = revoked.app.requests.readHistorical; let closingReads = 0;
    revoked.app.requests.readHistorical = async function(...args) {
      if (++closingReads === 2) originalRow.status = 'REVOKED';
      const observed = await historical.apply(this, args);
      if (closingReads === 1) revoked.b.h.control.now = new Date(originalRow.expiresAt.getTime() + 1);
      return observed;
    };
    try { await assert.rejects(invoke(revoked, kind, ref), error => error.code === 'AI_ACCESS_DENIED', 'closing receipt cannot disclose an original revoked during the read'); }
    finally { revoked.app.requests.readHistorical = historical; }
    assert.equal(closingReads, 2); assert.equal(originalRow.status, 'REVOKED');
  }
});

test('AIN14 profile target version is consumed from the original partition rather than unrelated business settings', async () => {
  const h = await setup(), cfg = h.b.openingConfiguration;
  cfg.profile.configVersion = 'profile-ordinary-r17'; cfg.settings.configVersion = 'business-settings-r8';
  const body = h.command('opening_diagnosis'); body.input.sections = ['workspace_profile', 'item_groups'];
  const created = await h.app.create(body), reference = h.ref(created.receipt.inputRef);
  const opening = h.b.tools.openingActions, beforeCfg = structuredClone(cfg);
  const diagnostic = await opening.read(), profile = diagnostic.sections.find(row => row.key === 'workspace_profile');
  assert.equal(diagnostic.configVersion, cfg.settings.configVersion, 'global diagnosis keeps its business configuration version');
  assert.equal(profile.candidate.currentVersion, cfg.profile.configVersion, 'ordinary profile proposal must advertise its real target revision');
  const group = diagnostic.sections.find(row => row.key === 'item_groups');
  assert.equal(group.candidate.currentVersion, cfg.settings.configVersion);
  const read = await h.app.readOpeningSection({ ...reference, key: 'workspace_profile' });
  assert.equal(read.section.current.configVersion, cfg.profile.configVersion);
  assert.equal(read.section.candidate.currentVersion, cfg.profile.configVersion);
  const prepared = await opening.prepareSection({ key: 'workspace_profile' });
  assert.equal(prepared.configVersion, cfg.profile.configVersion);
  const shared = require('@rental-os/shared');
  const definitions = Object.assign({}, ...Object.entries(shared).filter(([key]) => key.endsWith('_SCHEMAS') || key.endsWith('_SCHEMAS_V2')).map(([, value]) => value));
  const validators = require('./fixtures/ai-native/contract-consumer.cjs').validatorsFor({
    AiOpeningSectionObservationDraft: definitions.AiOpeningSectionObservationDraft }, definitions);
  assert.equal(validators.AiOpeningSectionObservationDraft(read.section), true,
    JSON.stringify(validators.AiOpeningSectionObservationDraft.errors));
  const request = { ...reference, sections: [{ key: 'workspace_profile', expectedVersion: read.section.candidate.currentVersion,
    changes: [{ field: 'itemLabel', value: 'Original partition target label' }] }] };
  const candidate = await h.app.prepareOpeningSections(request);
  assert.equal(candidate.sections.rows[0].status, 'prepared');
  assert.equal(candidate.sections.rows[0].candidate.currentVersion, cfg.profile.configVersion);
  assert.equal(candidate.sections.rows[0].candidate.changes[0].source.version, cfg.profile.configVersion);
  assert.equal(candidate.sections.rows[0].candidate.changes[0].before, cfg.profile.terminology.itemLabel);
  assert.equal(candidate.sections.execution, 'not_attempted'); assert.equal(candidate.publication, 'not_attempted');
  assert.equal(candidate.proposalPersistence, 'unavailable_no_formal_section_proposal_port');
  assert.deepEqual(cfg, beforeCfg); assert.equal(h.b.businessFacts.writes.length, 0);
  const wrongTarget = await h.app.prepareOpeningSections({ ...request, sections: request.sections.map(row => ({ ...row,
    expectedVersion: cfg.settings.configVersion })) });
  assert.equal(wrongTarget.sections.rows[0].status, 'revision_conflict', 'business version must not authorize ordinary profile changes');
  cfg.profile.configVersion = 'profile-ordinary-r18';
  const stale = await h.app.prepareOpeningSections(request);
  assert.equal(stale.sections.rows[0].status, 'revision_conflict', 'profile-only edits still require refreshed review');
  const refreshed = await h.app.readOpeningSection({ ...reference, key: 'workspace_profile' });
  assert.equal(refreshed.section.current.configVersion, 'profile-ordinary-r18');
  assert.equal(refreshed.section.candidate.currentVersion, 'profile-ordinary-r18');
  assert.equal((await opening.read()).configVersion, 'business-settings-r8');
  assert.equal(h.b.businessFacts.writes.length, 0); assert.equal(h.state.aiTask.length, 1);
  for (const invalid of ['', 'x'.repeat(192)]) {
    cfg.profile.configVersion = invalid;
    await assert.rejects(opening.read(), error => error.code === 'INVALID_RESPONSE',
      'a corrupt profile revision cannot borrow the business settings version');
    const { AiTaskRepositoryError } = require('../apps/api/src/modules/ai-native/ai-task.repository');
    await assert.rejects(h.app.readOpeningSection({ ...reference, key: 'workspace_profile' }),
      error => error instanceof AiTaskRepositoryError && error.code === 'AI_RESOURCE_UNAVAILABLE',
      'the original request boundary keeps its existing masked source-fault response');
  }
  cfg.profile.configVersion = 'profile-ordinary-r18';
  const visibleProfile = cfg.profile; cfg.profile = null;
  const absent = await h.app.prepareOpeningSections({ ...request, sections: request.sections.map(row => ({ ...row,
    expectedVersion: 'profile-ordinary-r18' })) });
  assert.equal(absent.sections.rows[0].status, 'unavailable', 'an advertised version cannot replace the missing original profile dependency');
  cfg.profile = visibleProfile;
  h.b.h.identity.user.permissions = [];
  await assert.rejects(h.app.readOpeningSection({ ...reference, key: 'workspace_profile' }));
});

// Declared credential-source window, not a new authority adapter: real original
// requests, Auth/Guard/ALS and business tools run under a second synthetic actor
// after the original grant returns, then the owner is restored before final read.
async function withTransientPrincipal(h, consume, historical=false) {
  const repository=h.app.requests, identity=h.b.h.identity, user=identity.user;
  const read=repository.read, resolve=repository.resolve, readHistorical=repository.readHistorical;let switched=false, first=true;
  const switchActor=()=>{first=false;switched=true;identity.user={...user,id:'synthetic-other-actor'};};
  repository.resolve=async function(...args){
    const grant=await resolve.apply(this,args);if(!historical&&first)switchActor();return grant;
  };
  repository.read=async function(...args){if(switched){identity.user=user;switched=false;}return read.apply(this,args);};
  repository.readHistorical=async function(...args){
    if(historical&&switched){identity.user=user;switched=false;}
    const observed=await readHistorical.apply(this,args);if(historical&&first)switchActor();return observed;
  };
  try{const result=await consume();assert.equal(first,false,'the declared principal window must be reached');return result;}
  finally{identity.user=user;repository.read=read;repository.resolve=resolve;repository.readHistorical=readHistorical;}
}

// Same declared bounded order projection as the existing v2 host, not a SQL
// emulator or a production fallback. Original Guard and fact validation remain.
function declareOriginalOrderProjection(h) {
  h.b.facts.readOrderFacts=async(tenantId,workspaceId,orderId)=>{
    const row=await h.b.facts.findOrder(tenantId,orderId);return row?{...row,workspaceId}:undefined;
  };
}

test('original request source reopening derives order and scope server-side and survives AI shutdown without bypassing revocation', async () => {
  const h = await setup();declareOriginalOrderProjection(h);
  const created = await h.app.create(h.command());
  h.state.aiTaskPlanPolicy[0].enabled = false;
  const command = { ...h.ref(created.receipt.inputRef), version: '2026-01-01T00:00:00Z', field: 'order' };
  const result = await h.app.reopenOrderCitation(command);
  assert.equal(result.source.status, 'available'); assert.equal(result.source.orderId, 'order-a');
  assert.equal((await h.app.reopenOrderCitation({ ...command, version: 'old' })).source.status, 'stale');
  await assert.rejects(h.app.reopenOrderCitation({ ...command, scope: { workspaceId: 'other' } }), e => e.code === 'AI_INVALID_INPUT');
  const counts=[h.state.aiTaskOriginalRequest.length,h.state.aiTask.length,h.b.businessFacts.writes.length];
  await withTransientPrincipal(h,()=>assert.rejects(h.app.reopenOrderCitation(command),error=>error.code==='AI_ACCESS_DENIED',
    'v1 citation must retain the original owner, not a same-space temporary actor'),true);
  const row=h.state.aiTaskOriginalRequest.find(row=>row.id===created.receipt.inputRef);
  row.expiresAt=new Date('2020-01-01T00:00:00Z');
  const expired=await h.app.reopenOrderCitation(command);
  assert.equal(expired.original.state,'expired');assert.equal(expired.source.status,'available');
  assert.equal(expired.execution,'not_attempted');
  assert.deepEqual([h.state.aiTaskOriginalRequest.length,h.state.aiTask.length,h.b.businessFacts.writes.length],counts);
  // Separate new synthetic original: never reverse a revocation to obtain green.
  const revoked=await setup();declareOriginalOrderProjection(revoked);
  const original=await revoked.app.create(revoked.command());
  const originalRow=revoked.state.aiTaskOriginalRequest.find(row=>row.id===original.receipt.inputRef);
  const reference={...revoked.ref(original.receipt.inputRef),version:'2026-01-01T00:00:00Z',field:'order'};
  const readHistorical=revoked.app.requests.readHistorical;let reads=0;
  revoked.app.requests.readHistorical=async function(...args){
    if(++reads===2)originalRow.status='REVOKED';
    return readHistorical.apply(this,args);
  };
  try{await assert.rejects(revoked.app.reopenOrderCitation(reference),error=>error.code==='AI_ACCESS_DENIED',
    'revocation during source reopening withholds the observed source');assert.equal(reads,2);}
  finally{revoked.app.requests.readHistorical=readHistorical;}
  assert.equal(originalRow.status,'REVOKED');
  await assert.rejects(revoked.app.reopenOrderCitation(reference),error=>error.code==='AI_ACCESS_DENIED');
  h.b.h.identity.session = false;
  await assert.rejects(h.app.reopenOrderCitation(command), e => e.code === 'AI_ACCESS_DENIED');
});

test('original order resource authorization reads only the guarded minimal parent and prepares full material once at consumption', async () => {
  const h = await setup(); let parentReads = 0, fullPreparations = 0;
  const readParent = async (tenantId, workspaceId, orderId) => {
    parentReads++;
    const row = await h.b.facts.findOrder(tenantId, orderId);
    return row ? { ...row, workspaceId } : undefined;
  };
  h.b.facts.readOrderFacts = readParent;
  const originalPrepare = h.app.tools.scenes.prepareOrderExplanation.bind(h.app.tools.scenes);
  h.app.tools.scenes.prepareOrderExplanation = async (...args) => { fullPreparations++; return originalPrepare(...args); };
  const created = await h.app.create(h.command()), ref = h.ref(created.receipt.inputRef);
  assert.equal(fullPreparations, 0, 'request/resource authorization must not regenerate explanation materials');
  await h.app.read(ref); await h.app.requests.resolve('order_explanation', ref.inputRef);
  assert.equal(fullPreparations, 0); assert.ok(parentReads > 0, 'the real minimal parent reader still executes');
  const packet = await h.app.prepareTaskMaterial(ref);
  assert.equal(fullPreparations, 1, 'one actual material consumption, not one preparation per authorization recheck');
  assert.equal(packet.material.payload.orderId, 'order-a'); assert.equal(packet.model, 'not_called');
  h.b.facts.readOrderFacts = async (...args) => ({ ...await readParent(...args), id: 'foreign-order' });
  await assert.rejects(h.app.read(ref), error => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(error.code));
  assert.equal(fullPreparations, 1, 'malformed/foreign parent never falls back to a preparation');
  h.b.facts.readOrderFacts = async (...args) => { const row = await readParent(...args); h.b.h.identity.session = false; return row; };
  await assert.rejects(h.app.read(ref), error => error.code === 'AI_ACCESS_DENIED');
  assert.equal(fullPreparations, 1, 'late revocation is still checked without another full preparation');
});

test('named original-order v2 HTTP consumes real authorized material/source while v1 and original hashes remain intact', async () => {
  const h = await setup();
  // Explicit original order projection leaf, as in the existing fixed host.
  // It delegates the same spy; no production fallback or SQL emulator is used.
  h.b.facts.readOrderFacts = async (tenantId, workspaceId, orderId) => {
    const row = await h.b.facts.findOrder(tenantId, orderId);
    return row ? { ...row, workspaceId } : undefined;
  };
  const created = await h.app.create(h.command()), ref = h.ref(created.receipt.inputRef);
  const { credentials, ...dependencies } = h.dependencies;
  const { composeRequestBoundOriginalScenes } = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application');
  const { AiOriginalScenesController } = require('../apps/api/src/modules/ai-native/scenes/original-scenes.controller');
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const shared = require('@rental-os/shared'), app = composeRequestBoundOriginalScenes(dependencies, { enabled: true, audience: 'operator' });
  const http = new AiOriginalScenesController(app), request = { headers: { authorization: (await credentials.current()).authorization } };
  const original = await h.app.prepareTaskMaterial(ref), originalHash = requestFingerprint(original.material);
  const old = await http.material(request, ref), current = await http.materialV2(request, ref);
  assert.equal(old.material.version, 'lane-a-business-content-1');
  assert.equal(current.material.version, shared.AI_ORDER_EXPLANATION_MATERIAL_V2_VERSION);
  assert.equal(current.materialHash, requestFingerprint(current.material));
  assert.equal(current.material.payloadFingerprint, requestFingerprint(current.material.payload));
  assert.equal(current.material.payloadBytes, Buffer.byteLength(JSON.stringify(current.material.payload), 'utf8'));
  assert.equal(current.original.contentHash, original.original.contentHash);
  assert.equal(requestFingerprint(original.material), originalHash);
  assert.equal(h.state.aiTask.length, 1); assert.equal(h.state.aiTask[0].status, 'QUEUED');
  const defs = Object.assign({}, ...Object.entries(shared).filter(([name]) => name.endsWith('_SCHEMAS') || name.endsWith('_SCHEMAS_V2')).map(([, schemas]) => schemas));
  const validators = require('./fixtures/ai-native/contract-consumer.cjs').validatorsFor({ ...shared.AI_ORDER_EXPLANATION_HTTP_SCHEMAS_V2,
    AiOrderSceneTaskMaterialV2: shared.AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS.AiOrderSceneTaskMaterialV2 }, defs);
  assert.equal(validators.AiOrderSceneTaskMaterialV2(current), true, JSON.stringify(validators.AiOrderSceneTaskMaterialV2.errors));
  const command = { ...ref, materialVersion: current.material.version, version: current.material.payload.orderVersion, field: 'order' };
  h.state.aiTaskPlanPolicy[0].enabled = false;
  const source = await http.sourceV2(request, command);
  assert.equal(source.source.status, 'available'); assert.equal(source.execution, 'not_attempted');
  assert.equal(validators.AiOriginalOrderSourceReadV2(source), true, JSON.stringify(validators.AiOriginalOrderSourceReadV2.errors));
  assert.equal((await http.sourceV2(request, { ...command, version: 'old' })).source.status, 'stale');
  await assert.rejects(http.sourceV2(request, { ...command, scope: { workspaceId: 'other' } }), e => e.getResponse().code === 'AI_INVALID_INPUT');
  await assert.rejects(http.sourceV2(request, { ...command, field: 'unregistered' }), e => e.getResponse().code === 'AI_INVALID_INPUT');
  const { OPENAPI_DOCUMENT } = require('../apps/api/src/contracts/openapi-document');
  const base = '/api/' + shared.AI_ORDER_EXPLANATION_HTTP_V2.basePath;
  for (const operation of ['material', 'source']) {
    const declared = OPENAPI_DOCUMENT.paths[base + '/' + operation].post;
    assert.ok(declared.responses['200']);
    assert.equal(Reflect.getMetadata('path', AiOriginalScenesController.prototype[operation + 'V2']), 'order-explanation-v2/' + operation);
    assert.equal(Reflect.getMetadata('__httpCode__', AiOriginalScenesController.prototype[operation + 'V2']), 200);
  }
  await withTransientPrincipal(h,()=>assert.rejects(h.app.reopenOrderCitationV2(command),error=>error.code==='AI_ACCESS_DENIED',
    'v2 original source must not join another actor\'s observation with the restored owner'),true);
  const row=h.state.aiTaskOriginalRequest.find(row=>row.id===ref.inputRef);
  row.expiresAt=new Date('2020-01-01T00:00:00Z');
  const expired=await http.sourceV2(request,command);
  assert.equal(expired.original.state,'expired');assert.equal(expired.source.status,'available');
  assert.equal(validators.AiOriginalOrderSourceReadV2(expired),true,JSON.stringify(validators.AiOriginalOrderSourceReadV2.errors));
  assert.equal(requestFingerprint(original.material),originalHash);
  assert.equal(h.state.aiTask.length,1);assert.equal(h.state.aiTask[0].status,'QUEUED');
  row.status='REVOKED';
  await assert.rejects(http.sourceV2(request,command),e=>e.getResponse().code==='AI_ACCESS_DENIED');
  h.b.h.identity.session = false;
  await assert.rejects(http.sourceV2(request, command), e => e.getResponse().code === 'AI_ACCESS_DENIED');
});

test('opening section consumer confines changes to originally selected partitions and never publishes candidates', async () => {
  const h = await setup(), input = h.command('opening_diagnosis'); input.input.sections = ['workspace_profile'];
  const created = await h.app.create(input), profile = h.b.core.getProfile('tenant_001');
  const section = { key: 'workspace_profile', expectedVersion: profile.configVersion, changes: [{ field: 'itemLabel', value: 'Selected label' }] };
  const result = await h.app.prepareOpeningSections({ ...h.ref(created.receipt.inputRef), sections: [section] });
  assert.equal(result.sections.rows[0].candidate.status, 'candidate_only'); assert.equal(result.publication, 'not_attempted');
  assert.equal(result.sections.rows[0].candidate.changes[0].before, profile.terminology.itemLabel);
  assert.equal(h.b.core.getProfile('tenant_001').terminology.itemLabel, profile.terminology.itemLabel);
  const beforeSparse = [h.state.aiTaskOriginalRequest.length, h.state.aiTask.length, h.b.businessFacts.writes.length];
  const unchangedSection = { ...section, changes: [{ field: 'itemLabel', value: profile.terminology.itemLabel }] };
  const unchanged = await h.app.prepareOpeningSections({ ...h.ref(created.receipt.inputRef), sections: [unchangedSection] });
  assert.deepEqual(unchanged.sections.rows[0].candidate.changes, [], 'original request consumer retains an empty observed difference, not a no-op action');
  assert.equal(unchanged.sections.rows[0].status, 'prepared'); assert.equal(unchanged.sections.rows[0].candidate.status, 'candidate_only');
  assert.equal(unchanged.sections.execution, 'not_attempted'); assert.equal(unchanged.publication, 'not_attempted');
  assert.equal(unchanged.proposalPersistence, 'unavailable_no_formal_section_proposal_port');
  assert.equal(unchanged.original.contentHash, result.original.contentHash);
  const sparse = await h.app.prepareOpeningSections({ ...h.ref(created.receipt.inputRef), sections: [{ ...section,
    changes: [...unchangedSection.changes, { field: 'pickupLabel', value: 'Original request ordinary terminology' }] }] });
  assert.deepEqual(sparse.sections.rows[0].candidate.changes.map(row => row.field), ['terminology.pickupLabel']);
  assert.equal(sparse.sections.rows[0].candidate.changes[0].before, profile.terminology.pickupLabel);
  assert.equal(sparse.sections.rows[0].candidate.changes[0].source.version, profile.configVersion);
  assert.ok(Object.isFrozen(sparse.sections.rows[0].candidate.changes));
  assert.deepEqual([h.state.aiTaskOriginalRequest.length, h.state.aiTask.length, h.b.businessFacts.writes.length], beforeSparse);
  assert.equal(h.b.core.getProfile('tenant_001').terminology.itemLabel, profile.terminology.itemLabel);
  assert.equal(h.b.core.getProfile('tenant_001').terminology.pickupLabel, profile.terminology.pickupLabel);
  await assert.rejects(h.app.prepareOpeningSections({ ...h.ref(created.receipt.inputRef), sections: [{ ...section, key: 'item_groups' }] }), e => e.code === 'AI_ACCESS_DENIED');
  const counts=[h.state.aiTaskOriginalRequest.length,h.state.aiTask.length,h.b.businessFacts.writes.length];
  await withTransientPrincipal(h,()=>assert.rejects(h.app.prepareOpeningSections({ ...h.ref(created.receipt.inputRef),sections:[section] }),
    error=>error.code==='FORBIDDEN','same workspace and restored owner cannot bind another actor\'s section candidate'));
  assert.deepEqual([h.state.aiTaskOriginalRequest.length,h.state.aiTask.length,h.b.businessFacts.writes.length],counts);
  assert.equal(h.b.core.getProfile('tenant_001').terminology.itemLabel,profile.terminology.itemLabel);
  // A newly created synthetic fixture's expired locator remains readable under
  // current read authority, never by calling the new-execution resolve path.
  h.state.aiTaskOriginalRequest.find(row=>row.id===created.receipt.inputRef).expiresAt=new Date('2020-01-01T00:00:00Z');
  h.state.aiTaskPlanPolicy.find(row=>row.sceneCode==='opening_diagnosis').enabled=false;
  const command={...h.ref(created.receipt.inputRef),key:section.key};
  const historical=await h.app.readOpeningSection(command);
  assert.equal(historical.original.state,'expired');assert.equal(historical.execution,'not_attempted');
  await withTransientPrincipal(h,()=>assert.rejects(h.app.readOpeningSection(command),error=>error.code==='FORBIDDEN',
    'history read must bind its freshly authorized original owner, without reopening execution'),true);
  await assert.rejects(h.app.prepareOpeningSections({...h.ref(created.receipt.inputRef),sections:[section]}));
  assert.deepEqual([h.state.aiTaskOriginalRequest.length,h.state.aiTask.length,h.b.businessFacts.writes.length],counts);
});

test('AIN15 original saved quote comparison consumes the exact Core receipts and remains read-only', async () => {
  const h = await setup({}, true), storedQuotes = [];
  // Existing original-scene host's declared receipt storage rows. Pricing and
  // normalization remain real Core services; this is not SQL/CAS simulation.
  h.b.businessFacts.findQuoteForOriginalOperation = async (tenantId, proof) => {
    const row = storedQuotes.find(row => row.quote.tenantId === tenantId && row.key === proof.key);
    if (row && row.inputHash !== proof.inputHash) throw new (require('@nestjs/common').ConflictException)('Original input conflict');
    return row && structuredClone(row.quote);
  };
  h.b.businessFacts.findQuoteForOriginalReference = async (tenantId, key) => {
    const row = storedQuotes.find(row => row.quote.tenantId === tenantId && row.key === key);
    return row && structuredClone(row.quote);
  };
  h.b.businessFacts.saveQuoteForOriginalOperation = async (quote, proof) => {
    const previous = await h.b.businessFacts.findQuoteForOriginalOperation(quote.tenantId, proof);
    if (previous) return previous;
    storedQuotes.push({ ...proof, quote: structuredClone(quote) }); return structuredClone(quote);
  };
  h.b.facts.listAssets = async () => [{ id: 'synthetic-asset', tenantId: 'tenant_001', workspaceId: 'workspace-a',
    itemGroupId: h.b.group.id, locationId: h.b.location.id, status: 'available' }];
  h.b.facts.listStockBalances = async () => [{ itemGroupId: h.b.group.id, locationId: h.b.location.id,
    onHandQuantity: 3, maintenanceQuantity: 0 }];
  const quoted = async (candidate, key) => {
    const prepared = await h.b.tools.quote.candidates.prepare(candidate);
    const command = h.command('quote_clarification', key);
    command.input.candidate = { ...candidate, selectionRevision: prepared.selectionRevision };
    const original = await h.app.create(command), ref = h.ref(original.receipt.inputRef);
    const review = await h.app.reviewQuote(ref);
    assert.equal(review.facts.status, 'ready');
    assert.equal(review.sources.status, 'prepared_input_sources');
    const confirmed = await h.app.confirmQuote({ ...ref, selectionRevision: review.sources.selectionRevision,
      inputFingerprint: review.sources.inputFingerprint, confirmQuote: true });
    assert.equal(confirmed.result.status, 'quoted');
    assert.equal(confirmed.result.quotePersistence, 'saved');
    return { ref, confirmed };
  };
  const candidate = { ...h.b.candidate, bookingIdentity: { bookingIdentity: 'personal' } };
  const previous = await quoted(candidate, 'compare-original-before');
  const current = await quoted({ ...candidate, end: '2026-11-12T09:00:00+08:00' }, 'compare-original-after');
  const writesBefore = h.b.businessFacts.writes.length;
  const result = await h.app.compareOriginalQuotes({ previous: previous.ref, current: current.ref });
  assert.equal(result.status, 'compared');
  assert.equal(result.comparison.previousQuoteId, previous.confirmed.result.quote.id);
  assert.equal(result.comparison.currentQuoteId, current.confirmed.result.quote.id);
  assert.equal(result.comparison.inputChanges.period, true);
  assert.equal(result.comparison.coreAmounts.arithmetic, 'not_recomputed_by_ai_layer');
  assert.equal(result.quotation, 'not_attempted');
  assert.equal(result.inventoryReservation, 'not_attempted');
  assert.equal(result.orderApproval, 'not_granted');
  assert.equal(h.b.businessFacts.writes.length, writesBefore);
  assert.equal(storedQuotes.length, 2);
  assert.equal(h.b.businessFacts.writes.some(row => /order|reservation/i.test(row.kind)), false);
  const shared = require('@rental-os/shared');
  const definitions = Object.assign({}, ...Object.entries(shared).filter(([name]) => name.endsWith('_SCHEMAS') || name.endsWith('_SCHEMAS_V2')).map(([, schemas]) => schemas));
  const validators = require('./fixtures/ai-native/contract-consumer.cjs').validatorsFor(shared.AI_SCENE_QUOTE_HTTP_SCHEMAS, definitions);
  assert.equal(validators.AiOriginalQuotesCompareResponseDraft(result), true,
    JSON.stringify(validators.AiOriginalQuotesCompareResponseDraft.errors));
  const { AiOriginalSceneFactsService } = require('../apps/api/src/modules/ai-native/scenes/original-scene-facts.service');
  const projectionReader = new AiOriginalSceneFactsService(h.app.requests, h.app.tools);
  const originalRead = projectionReader.readQuoteReceipt.bind(projectionReader), originalRows = structuredClone(storedQuotes);
  for (const omitted of ['previous', 'current', 'both']) {
    const a = structuredClone(previous.confirmed.result.quote), b = structuredClone(current.confirmed.result.quote);
    if (omitted !== 'current') delete a.currency;
    if (omitted !== 'previous') delete b.currency;
    assert.throws(() => h.b.tools.quote.businessPreparation.compareQuotes(a, b), error => error.code === 'CAPABILITY_UNSUPPORTED',
      'missing saved currency must not become a same-currency/amount comparison');
    projectionReader.readQuoteReceipt = async reference => {
      const observed = structuredClone(await originalRead(reference));
      // Model an older saved DISPLAY projection after the real original
      // Core/Guard read; do not alter the Core quote or its operation receipt.
      if (omitted === 'both' || (omitted === 'previous' ? reference.inputRef === previous.ref.inputRef : reference.inputRef === current.ref.inputRef))
        delete observed.result.quote.currency;
      return observed;
    };
    const unavailable = await projectionReader.compareOriginalQuotes({ previous: previous.ref, current: current.ref });
    assert.equal(unavailable.status, 'unavailable_original_quote'); assert.equal(unavailable.comparison, null);
    assert.equal(unavailable.quotation, 'not_attempted'); assert.equal(unavailable.orderApproval, 'not_granted');
    assert.equal(unavailable.retryable, false); assert.equal(unavailable.nextAction, 'read_original_quote_receipt');
    assert.equal(validators.AiOriginalQuotesCompareResponseDraft(unavailable), true,
      JSON.stringify(validators.AiOriginalQuotesCompareResponseDraft.errors));
    if (omitted !== 'current') assert.equal(unavailable.previous.result.quote.currency, undefined, 'no current configuration backfill');
    if (omitted !== 'previous') assert.equal(unavailable.current.result.quote.currency, undefined, 'no current configuration backfill');
    assert.equal(h.b.businessFacts.writes.length, writesBefore); assert.deepEqual(storedQuotes, originalRows);
  }
  for (const currency of ['', 'cny', 'CNY-extra']) {
    const malformed = { ...current.confirmed.result.quote, currency };
    assert.throws(() => h.b.tools.quote.businessPreparation.compareQuotes(previous.confirmed.result.quote, malformed),
      error => error.code === 'INVALID_REQUEST');
  }
  // Advance the existing trusted fixture clock, not a sealed input/quote expiry.
  // History still uses current read rights, while new confirmation stays blocked.
  const originalNow = h.b.h.control.now;
  const expiredAt = new Date(Math.max(...[previous, current].flatMap(row => [
    Date.parse(row.confirmed.original.expiresAt), Date.parse(row.confirmed.result.quote.expiresAt)])) + 1000);
  const stateFingerprint = () => require('../apps/api/src/modules/rental-core/rental-idempotency.repository').requestFingerprint(
    JSON.parse(JSON.stringify(h.state, (_key, value) => typeof value === 'bigint' ? value.toString() : value)));
  const beforeHistory = stateFingerprint();
  let readCount = 0;
  projectionReader.readQuoteReceipt = async reference => {
    const observed = await originalRead(reference);
    if (++readCount === 2) h.b.h.control.now = expiredAt;
    return observed;
  };
  try {
    const history = await projectionReader.compareOriginalQuotes({ previous: previous.ref, current: current.ref });
    assert.equal(history.status, 'compared', 'natural input/quote expiry is not a changed immutable receipt');
    assert.equal(readCount, 4, 'both original operations are reopened before returning the closing observation');
    for (const receipt of [history.previous, history.current]) {
      assert.equal(receipt.original.state, 'expired'); assert.equal(receipt.result.status, 'expired');
      assert.equal(receipt.result.quotePersistence, 'saved'); assert.ok(receipt.result.quote);
    }
    assert.equal(history.comparison.approvalReuse, 'forbidden_new_quote_requires_new_confirmation');
    assert.deepEqual(history.comparison.validity, result.comparison.validity, 'no historical expiry rewrite');
    assert.equal(validators.AiOriginalQuotesCompareResponseDraft(history), true,
      JSON.stringify(validators.AiOriginalQuotesCompareResponseDraft.errors));
    await assert.rejects(h.app.confirmQuote({ ...current.ref, selectionRevision: 'a'.repeat(64),
      inputFingerprint: 'b'.repeat(64), confirmQuote: true }));
    for (const altered of ['quote_expiry', 'amount', 'revocation']) {
      let reads = 0;
      projectionReader.readQuoteReceipt = async reference => {
        const observed = structuredClone(await originalRead(reference));
        if (++reads === 3) {
          if (altered === 'quote_expiry') observed.result.quote.expiresAt = new Date(expiredAt.getTime() + 10000).toISOString();
          else if (altered === 'amount') observed.result.quote.payableAmount += 1;
          else observed.original.state = 'revoked';
        }
        return observed;
      };
      await assert.rejects(projectionReader.compareOriginalQuotes({ previous: previous.ref, current: current.ref }),
        error => error.code === 'AI_REVISION_CONFLICT', 'only natural temporal states may be normalized: ' + altered);
    }
    projectionReader.readQuoteReceipt = async reference => {
      const observed = structuredClone(await originalRead(reference));
      if (reference.inputRef === current.ref.inputRef) {
        delete observed.result.quote;
        Object.assign(observed.result, { status: 'unavailable', quotePersistence: 'unknown',
          message: 'Synthetic original receipt unknown', nextAction: 'reconcile', retryable: false });
      }
      return observed;
    };
    const unknown = await projectionReader.compareOriginalQuotes({ previous: previous.ref, current: current.ref });
    assert.equal(unknown.status, 'unavailable_original_quote'); assert.equal(unknown.comparison, null);
    assert.equal(unknown.current.result.quotePersistence, 'unknown'); assert.equal(unknown.quotation, 'not_attempted');
    assert.equal(validators.AiOriginalQuotesCompareResponseDraft(unknown), true,
      JSON.stringify(validators.AiOriginalQuotesCompareResponseDraft.errors));
    assert.equal(h.b.businessFacts.writes.length, writesBefore); assert.deepEqual(storedQuotes, originalRows);
    assert.equal(stateFingerprint(), beforeHistory); assert.equal(storedQuotes.length, 2);
  } finally { h.b.h.control.now = originalNow; projectionReader.readQuoteReceipt = originalRead; }
  h.b.h.identity.session = false;
  await assert.rejects(h.app.compareOriginalQuotes({ previous: previous.ref, current: current.ref }));
  assert.equal(h.b.businessFacts.writes.length, writesBefore);
});

test('quote review uses the immutable original candidates and never turns them into human selection or approval', async () => {
  const h = await setup(), created = await h.app.create(h.command('quote_clarification'));
  h.b.business.createQuote = async () => { throw Error('review must not persist a quote'); };
  const result = await h.app.reviewQuote(h.ref(created.receipt.inputRef));
  assert.equal(result.facts.status, 'missing_input'); assert.equal(result.humanSelection, 'not_attested');
  assert.equal(result.quotePersistence, 'not_attempted'); assert.equal(result.orderApproval, 'not_granted');
  assert.ok(Object.isFrozen(result.sources)); assert.equal(h.state.aiTask.length, 1);
  await assert.rejects(h.app.reviewQuote({ ...h.ref(created.receipt.inputRef), confirmed: true }), e => e.code === 'AI_INVALID_INPUT');
  const writes=h.b.businessFacts.writes.length;
  await withTransientPrincipal(h,()=>assert.rejects(h.app.reviewQuote(h.ref(created.receipt.inputRef)),
    error=>error.code==='FORBIDDEN','quote material/provenance must retain the original resolved actor'));
  assert.equal(h.b.businessFacts.writes.length,writes);assert.equal(h.state.aiTask.length,1);
});

test('explicit original quote confirmation uses actual Core storage and receipt recovery never creates another quote', async () => {
  const h = await setup({ rentalQuote: [], businessWorkspace: [{ id: 'workspace-a', tenantId: 'tenant_001', status: 'ACTIVE' }] });
  const { RentalBusinessFactRepository } = require('../apps/api/src/modules/rental-core/rental-business-fact.repository');
  const { Prisma } = require('../apps/api/node_modules/@prisma/client');
  const admission = require('./helpers/fulfillment-admission-fixture.cjs').fulfillmentAdmissionFixture('tenant_001', 'workspace-a', {
    locations: h.b.core.listLocations('tenant_001'), operators: h.b.core.listOperators('tenant_001')
  });
  const transaction = h.db.$transaction;
  let loseQuoteReply = false;
  // Database transport only. Pricing, original authorization, Guard/ALS,
  // repository and scene consumption all execute their real implementation.
  h.db.$transaction = work => transaction(tx => work({ ...tx,
    rentalQuote: { ...tx.rentalQuote, create: args => {
      if (loseQuoteReply) { h.control.loseReply = true; loseQuoteReply = false; }
      return tx.rentalQuote.create({ ...args,
        data: Object.fromEntries(Object.entries(args.data).map(([k, v]) => [k, v === Prisma.DbNull ? null : v])) });
    } },
    $queryRaw: async (...args) => {
      const sql=String(args[0]?.sql??args[0]);
      if(sql.includes('business_workspaces'))return [{status:'ACTIVE',categoryVersionId:null,categoryAdoptionRevision:0}];
      // Exact declared inventory row for this original quote, not a SQL parser.
      // The real repository now reopens it under the original transaction lock;
      // its source/bundle comparison must run rather than receive an empty leaf.
      if(/FROM rental_item_groups\b/u.test(sql)){
        assert.deepEqual(args[0].values,['tenant_001','workspace-a',h.b.group.id,2]);
        const row=h.b.group;assert.equal(row.tenantId,'tenant_001');assert.equal(row.bundleComponents.length,0);
        return [{...structuredClone(row),workspaceId:'workspace-a',categoryCode:row.categoryCode.toUpperCase(),
          inventoryMode:row.inventoryMode.toUpperCase(),createdAt:new Date(row.createdAt),updatedAt:new Date(row.updatedAt)}];
      }
      return /rental_fulfillment_(locations|operators)/u.test(sql)?admission.tx.$queryRaw(...args):tx.$queryRaw(...args);
    } }));
  h.b.business.factStore = new RentalBusinessFactRepository(h.db);
  const createQuote = h.b.business.createQuoteForOriginalOperation.bind(h.b.business);
  let coreFailure, coreAttempts=0;
  h.b.business.createQuoteForOriginalOperation = async (...args) => {
    coreAttempts++;
    try { return await createQuote(...args); } catch (error) { coreFailure = error.message; throw error; }
  };
  const original = h.command('quote_clarification'); original.input.candidate = h.b.candidate;
  const created = await h.app.create(original), ref = h.ref(created.receipt.inputRef);
  const reviewed = await h.app.reviewQuote(ref);
  const command = { ...ref, selectionRevision: reviewed.facts.selectionRevision,
    inputFingerprint: reviewed.sources.inputFingerprint };
  await assert.rejects(h.app.confirmQuote(command), e => e.code === 'AI_INVALID_INPUT');
  const absent = await h.app.readQuoteReceipt(command);
  assert.equal(absent.result.quotePersistence, 'unknown'); assert.equal(h.state.rentalQuote.length, 0);
  await withTransientPrincipal(h,()=>assert.rejects(h.app.confirmQuote({ ...command,confirmQuote:true }),
    error=>error.code==='FORBIDDEN','original R1 quote request cannot use another actor\'s prepared selection'));
  assert.equal(h.state.rentalQuote.length,0,'binding refusal occurs before original Core quote persistence');
  assert.equal(coreAttempts,0,'another actor\'s candidate never reaches the original Core operation');
  loseQuoteReply = true;
  const uncertain = await h.app.confirmQuote({ ...command, confirmQuote: true });
  assert.equal(uncertain.result.quotePersistence, 'unknown'); assert.equal(h.state.rentalQuote.length, 1, coreFailure);
  const recovered = await h.app.readQuoteReceipt(command);
  assert.equal(recovered.result.status, 'quoted'); assert.equal(recovered.result.quotePersistence, 'saved');
  assert.equal(recovered.orderApproval, 'not_granted'); assert.equal(recovered.result.quote.reservation, 'not_reserved');
  assert.equal(h.state.rentalQuote.length, 1);
  await assert.rejects(h.app.confirmQuote({ ...command, confirmQuote: true, inputFingerprint: 'a'.repeat(64) }), e => e.code === 'AI_REVISION_CONFLICT');
  const savedBasis = structuredClone(recovered.result.quote);
  // Change present-day configuration and expire the original AI request. The
  // observation still uses the saved Core row, never current settings/price.
  h.b.core.getProfile('tenant_001').configVersion = 'changed-after-quote';
  h.state.aiTaskPlanPolicy.find(row => row.sceneCode === 'quote_clarification').enabled = false;
  h.state.aiTaskOriginalRequest.find(row => row.id === ref.inputRef).expiresAt = new Date('2020-01-01T00:00:00Z');
  const historical = await h.app.readQuoteReceipt(ref);
  assert.deepEqual(historical.result.quote, savedBasis);
  assert.equal(historical.original.state, 'expired');
  assert.equal(historical.selection, 'historical_not_current_confirmation');
  assert.equal(h.state.rentalQuote.length, 1);
  await assert.rejects(h.app.confirmQuote({ ...command, confirmQuote: true }));
  h.state.rentalQuote[0].expiresAt = new Date('2020-01-01T00:00:00Z');
  const expired = await h.app.readQuoteReceipt(ref);
  assert.equal(expired.result.status, 'expired'); assert.equal(expired.result.quote.id, savedBasis.id);
  assert.equal(expired.result.quote.payableAmount, savedBasis.payableAmount);
  assert.equal(h.state.rentalQuote.length, 1);
  const row = h.state.rentalQuote[0], savedHash = row.originalInputHash;
  row.originalInputHash = '0'.repeat(64);
  // The current historical bridge sanitizes a failed original-row read as
  // unavailable/unknown, not as a usable quote or permission to recreate it.
  const corrupted = await h.app.readQuoteReceipt(ref);
  assert.equal(corrupted.result.status, 'unavailable'); assert.equal(corrupted.result.quote, undefined);
  assert.equal(corrupted.result.quotePersistence, 'unknown'); assert.equal(corrupted.result.nextAction, 'reconcile');
  assert.equal(corrupted.result.retryable, false); assert.equal(h.state.rentalQuote.length, 1);
  row.originalInputHash = savedHash;
  h.b.h.identity.session = false;
  await assert.rejects(h.app.readQuoteReceipt(command), e => e.code === 'AI_ACCESS_DENIED');
  assert.equal(h.state.rentalQuote.length, 1);
});

test('AIN15 review provenance waits reopen elapsed original time without stale ready facts or conflict downgrade', async () => {
  const { ModelGatewayError } = require('../apps/api/src/modules/ai-native/model-gateway.ports');
  const { originalQuoteAnswerContract, applyOriginalQuoteAnswers } = require('../apps/api/src/modules/ai-native/scenes/original-quote-input');
  async function window(entry, boundary = 'start', fault) {
    const h = await setup(), candidate = structuredClone(h.b.candidate), preparation = h.app.tools.quote.businessPreparation;
    const candidates = h.app.tools.quote.candidates;
    h.b.facts.listAssets = async () => [{ id: 'review-period-asset', tenantId: 'tenant_001', workspaceId: 'workspace-a',
      itemGroupId: h.b.group.id, locationId: h.b.location.id, status: 'available' }];
    h.b.facts.listStockBalances = async () => [{ itemGroupId: h.b.group.id, locationId: h.b.location.id, onHandQuantity: 3, maintenanceQuantity: 0 }];
    const input = h.command('quote_clarification'); input.input.candidate = candidate;
    const created = await h.app.create(input), ref = h.ref(created.receipt.inputRef), original = await h.app.requests.read(ref);
    let at = Date.parse(candidate.start) - 60000, quoteAttempts = 0;
    candidates.clock = () => new Date(at);
    h.b.business.createQuote = async () => { quoteAttempts++; throw Error('time review must not create a quote'); };
    h.b.business.createQuoteForOriginalOperation = async () => { quoteAttempts++; throw Error('time review must not execute an original quote'); };
    const unified = preparation.prepareUnified.bind(preparation), source = preparation.inputSources.bind(preparation);
    let prepared;
    preparation.prepareUnified = async (...args) => {
      const result = await unified(...args); assert.equal(result.status, 'ready', 'reach actual ready preparation before the provenance wait');
      prepared = result; at = Date.parse(candidate[boundary]);
      if (fault === 'configuration') h.b.quoteConfiguration.settings.configVersion = 'changed-at-provenance';
      if (fault === 'withdrawal') h.b.h.identity.user.permissions = [];
      return result;
    };
    if (fault === 'unknown_config_failure') preparation.inputSources = async () => { throw new ModelGatewayError('CONFIG_INVALID'); };
    const counts = [h.state.aiTaskOriginalRequest.length, h.state.aiTask.length, h.b.businessFacts.writes.length];
    const consume = () => entry === 'original' ? h.app.reviewQuote(ref) : preparation.reviewAnsweredParameters(candidate);
    return { h, candidate, preparation, original, ref, counts, consume, source, unified,
      prepared: () => prepared, quoteAttempts: () => quoteAttempts, at: () => at };
  }
  for (const entry of ['original', 'answered']) for (const boundary of ['start', 'end']) {
    const w = await window(entry, boundary), result = await w.consume(), facts = entry === 'original' ? result.facts : result.preparation;
    assert.equal(facts.status, 'missing_input'); assert.equal(facts.next, 'clarify_input'); assert.equal(result.sources.status, 'missing_input');
    assert.equal(facts.selectionRevision, w.prepared().selectionRevision); assert.equal(result.sources.selectionRevision, facts.selectionRevision);
    assert.ok(facts.missingFields.includes('start')); if (boundary === 'end') assert.ok(facts.missingFields.includes('end'));
    assert.ok(facts.missingFields.every(field => ['start', 'end'].includes(field)));
    assert.ok(facts.clarifications.filter(row => facts.missingFields.includes(row.field)).every(row => row.reason === 'rental_time_elapsed'));
    assert.equal(facts.request, undefined); assert.equal(facts.availability, undefined); assert.equal(facts.review, undefined);
    assert.deepEqual(facts.sideEffects, { quoteSaved: false, inventoryReserved: false, orderCreated: false, approvalGranted: false });
    if (entry === 'original') {
      assert.equal(result.humanSelection, 'not_attested'); assert.equal(result.quotePersistence, 'not_attempted');
      assert.equal(result.orderApproval, 'not_granted'); assert.equal(result.execution, 'not_attempted');
      assert.equal(result.original.contentHash, w.original.receipt.contentHash);
    } else assert.equal(result.humanConfirmation, 'required_before_preview');
    const after = await w.h.app.requests.read(w.ref);
    assert.deepEqual(after.request.input, w.original.request.input, 'elapsed time never rewrites the immutable original candidate');
    assert.deepEqual([w.h.state.aiTaskOriginalRequest.length, w.h.state.aiTask.length, w.h.b.businessFacts.writes.length], w.counts);
    assert.equal(w.quoteAttempts(), 0);
    w.preparation.prepareUnified = w.unified; w.preparation.inputSources = w.source;
    const contract = originalQuoteAnswerContract(w.candidate, result.sources, 'Provide new explicit original times');
    const start = new Date(w.at() + 3600000).toISOString(), end = new Date(w.at() + 86400000).toISOString();
    const answers = contract.fields.filter(row => ['starts_at', 'ends_at'].includes(row.fieldId))
      .map(row => ({ fieldId: row.fieldId, value: row.fieldId === 'starts_at' ? start : end }));
    assert.ok(answers.length > 0);
    const revised = applyOriginalQuoteAnswers(w.candidate, [{ contract, answers }]);
    const renewed = await w.preparation.reviewAnsweredParameters(revised);
    assert.equal(renewed.preparation.status, 'ready'); assert.equal(renewed.preparation.request.startAt, start);
    assert.equal(renewed.sources.status, 'prepared_input_sources'); assert.notEqual(renewed.preparation.selectionRevision, facts.selectionRevision);
    assert.ok(renewed.sources.fields.every(row => row.confirmed === false));
    assert.equal(w.quoteAttempts(), 0, 'explicit new times only reprepare, never quote or approve');
  }
  for (const [fault, code] of [['configuration', 'AI_REVISION_CONFLICT'], ['withdrawal', 'FORBIDDEN'], ['unknown_config_failure', 'CONFIG_INVALID']]) {
    const w = await window('original', 'start', fault);
    await assert.rejects(w.consume(), error => error.code === code, `${fault}: elapsed time cannot downgrade unrelated failure`);
    assert.equal(w.quoteAttempts(), 0); assert.equal(w.h.b.businessFacts.writes.length, w.counts[2]);
  }
});
