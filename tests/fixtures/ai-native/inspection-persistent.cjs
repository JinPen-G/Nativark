'use strict';
require('./lane-b-functional.cjs');
const { AuthService } = require('../../../apps/api/src/modules/auth/auth.service');
const { ApiAuthGuard } = require('../../../apps/api/src/common/api-auth.guard');
const { user } = require('./authorization-baseline.cjs');
const { composeInspectionAssist } = require('../../../apps/api/src/modules/ai-native/inspection-assist/inspection-assist.composition');
const { Prisma } = require('../../../apps/api/node_modules/@prisma/client');
exports.target = { orderId: 'order-a', allocationId: 'allocation-a', templateId: 'template-a', stage: 'return' };
exports.fixture = () => {
  const state = { user: user({ permissions: ['rental-os:order:view', 'rental-os:order:return'] }), active: true, workspace: 'workspace-a', reads: 0,
    drafts: new Map(), operations: new Map(), bindings: new Map(), assets: new Map() };
  const auth = new AuthService({ getAuthSession: async () => state.active ? { id: 'session-a', userId: state.user.id, audience: 'staff', currentWorkspaceId: state.workspace } : undefined,
    findUserById: async () => state.user, findWorkspaceScopedUser: async () => state.user, listUserWorkspaces: async () => [] },
    { get: key => key === 'AUTH_TOKEN_SECRET' ? 'synthetic-test-secret' : undefined });
  const credentials = { current: async () => ({ audience: 'staff', requestId: 'request-a', authorization: `Bearer ${auth.signAccessToken({ sub: state.user.id, tid: 'tenant-a', sid: 'session-a', aud: 'staff', exp: Math.floor(Date.now()/1000)+600 })}` }) };
  const guard = new ApiAuthGuard(auth, undefined, undefined, undefined, { rentalOrder: { findFirst: async () => ({ id: 'order-a' }) } });
  const template = { id: 'template-a', tenantId: 'tenant-a', categoryCode: 'vehicle', code: 'return', name: 'Synthetic', stage: 'return', version: 'v1', enabled: true,
    fields: [{ code: 'mileage', label: 'Mileage', type: 'number', required: true, usageMetric: true }, { code: 'photo', label: 'Photo', type: 'photo', required: false }] };
  const order = { id: 'order-a', tenantId: 'tenant-a', workspaceId: 'workspace-a', fulfillmentLocationId: 'location-a', returnLocationId: 'location-a', inspectionTemplateSnapshots: [template],
    allocations: [{ id: 'allocation-a', orderId: 'order-a', assetId: 'asset-a', status: 'picked_up' }] };
  const core = { getOrder: async () => { state.reads++; if (state.onRead) state.onRead(); return structuredClone(order); },
    listInspectionTemplates: async (_tenant, _stage, source) => source.inspectionTemplateSnapshots };
  const match = (row, where) => Object.entries(where).every(([key, value]) => value && typeof value === 'object' ? row[key] > value.gt : row[key] === value);
  const delegate = name => ({
    findFirst: async ({ where, orderBy }) => { if (state.onDbRead) state.onDbRead(name); const rows = [...state[name].values()].filter(row => match(row, where));
      if (orderBy?.attachmentRevision) rows.sort((a,b) => b.attachmentRevision-a.attachmentRevision); return structuredClone(rows[0] ?? null); },
    findUnique: async ({ where }) => { const query = Object.values(where)[0]; return structuredClone([...state[name].values()].find(row => match(row, query)) ?? null); },
    findFirstOrThrow: async args => { const row = await db[name === 'drafts' ? 'aiInspectionDraft' : 'aiInspectionEvidenceBinding'].findFirst(args); if (!row) throw Error('missing'); return row; },
    findMany: async ({ where, take, select }) => [...state[name].values()].filter(row => match(row, where)).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,take)
      .map(row => structuredClone(select ? Object.fromEntries(Object.keys(select).map(k => [k,row[k]])) : row)),
    create: async ({ data }) => { if (name === 'operations' && [...state.operations.values()].some(row => row.tenantId === data.tenantId && row.workspaceId === data.workspaceId && row.operationId === data.operationId))
        throw new Prisma.PrismaClientKnownRequestError('duplicate',{code:'P2002',clientVersion:'test'});
      const row = { inspectionId: null, contentHash: null, mediaType: null, durationMs: null, createdAt: new Date(), updatedAt: new Date(), ...structuredClone(data) };
      state[name].set(row.id,row); return structuredClone(row); },
    updateMany: async ({ where, data }) => { const row=[...state[name].values()].find(row=>match(row,where)); if(!row)return {count:0};
      const revision=row.revision; Object.assign(row,structuredClone(data)); if(data.revision?.increment)row.revision=revision+data.revision.increment; return {count:1}; }
  });
  let queue=Promise.resolve();
  const db={ aiInspectionDraft:delegate('drafts'), aiInspectionOperation:delegate('operations'), aiInspectionEvidenceBinding:delegate('bindings'), fileAsset:delegate('assets'),
    $transaction:callback=>{const work=queue.then(async()=>{const old=structuredClone({drafts:state.drafts,operations:state.operations,bindings:state.bindings});
      try{return await callback(db);}catch(error){Object.assign(state,old);throw error;}});queue=work.catch(()=>undefined);return work;} };
  const date=new Date('2026-10-07T00:00:00Z');
  state.assets.set('file-a',{id:'file-a',tenantId:'tenant-a',uploadedBy:state.user.id,businessModule:'rental-core',businessType:'rental_order',businessId:'order-a',uploadScene:'return-evidence',status:'active',
    storageProvider:'synthetic-controlled-provider',storageKey:'object-a',mimeType:'image/png',sizeBytes:64,updatedAt:date,
    uploadSession:{id:'upload-a',tenantId:'tenant-a',status:'completed',completedAt:date,storageKey:'object-a'}});
  return { state, template, order, db, services:composeInspectionAssist({guard,credentials,core,db}) };
};
