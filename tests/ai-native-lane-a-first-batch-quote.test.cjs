'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/lane-a-business-consumption.cjs');

test('unified quote preparation returns the next host step without side effects', async () => {
  const h = await setup();
  h.facts.listAssets = async () => [{ id: 'synthetic-asset', tenantId: 'tenant_001', workspaceId: 'workspace-a', itemGroupId: h.group.id, locationId: h.location.id, status: 'available' }];
  h.facts.listStockBalances = async () => [{ itemGroupId: h.group.id, locationId: h.location.id, onHandQuantity: 3, maintenanceQuantity: 0 }];
  const prepared = await h.tools.quote.businessPreparation.prepareUnified(h.candidate);
  assert.equal(prepared.status, 'ready');
  assert.equal(prepared.next, 'preview_quote');
  assert.equal(prepared.sideEffects.inventoryReserved, false);
  assert.equal(prepared.sideEffects.orderCreated, false);
});

test('formal input provenance distinguishes explicit fields and blocks order handoff', async () => {
  const h = await setup();
  h.facts.listAssets = async () => [{ id: 'synthetic-asset', tenantId: 'tenant_001', workspaceId: 'workspace-a', itemGroupId: h.group.id, locationId: h.location.id, status: 'available' }];
  h.facts.listStockBalances = async () => [{ itemGroupId: h.group.id, locationId: h.location.id, onHandQuantity: 3, maintenanceQuantity: 0 }];
  const first = await h.tools.quote.candidates.prepare(h.candidate);
  const sources = await h.tools.quote.businessPreparation.inputSources({ ...h.candidate, selectionRevision: first.selectionRevision });
  assert.equal(sources.status, 'prepared_input_sources');
  assert.equal(sources.humanConfirmation, 'required_before_preview');
  assert.equal(sources.coreNormalization, 'not_yet_called');
  const handoff = await h.tools.quote.businessPreparation.commitHandoff();
  assert.equal(handoff.status, 'unavailable');
  assert.equal(handoff.orderApproval, 'not_granted');
});

test('quote comparison reports Core changes without recomputing money or reusing approval', async () => {
  const h = await setup();
  h.facts.listAssets = async () => [{ id: 'synthetic-asset', tenantId: 'tenant_001', workspaceId: 'workspace-a', itemGroupId: h.group.id, locationId: h.location.id, status: 'available' }];
  h.facts.listStockBalances = async () => [{ itemGroupId: h.group.id, locationId: h.location.id, onHandQuantity: 3, maintenanceQuantity: 0 }];
  const first = await h.tools.quote.candidates.prepare(h.candidate);
  const input = { ...h.candidate, selectionRevision: first.selectionRevision };
  const a = await h.tools.quote.previewSelection(input);
  assert.equal(a.status, 'quoted');
  const changed = { ...input, end: '2026-11-12T09:00:00+08:00' };
  const second = await h.tools.quote.candidates.prepare(changed);
  assert.equal(second.status, 'needs_confirmation');
  const b = await h.tools.quote.previewSelection({ ...changed, selectionRevision: second.selectionRevision });
  assert.equal(b.status, 'quoted');
  const comparison = h.tools.quote.businessPreparation.compareQuotes(a.quote, b.quote);
  assert.equal(comparison.inputChanges.period, true);
  assert.equal(comparison.approvalReuse, 'forbidden_new_quote_requires_new_confirmation');
  assert.equal(comparison.coreAmounts.arithmetic, 'not_recomputed_by_ai_layer');
});
