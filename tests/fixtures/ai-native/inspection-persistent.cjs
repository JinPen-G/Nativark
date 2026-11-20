'use strict';
require('./lane-b-functional.cjs');
const { AuthService } = require('../../../apps/api/src/modules/auth/auth.service');
const { ApiAuthGuard } = require('../../../apps/api/src/common/api-auth.guard');
const { user } = require('./authorization-baseline.cjs');
const { composeInspectionAssist } = require('../../../apps/api/src/modules/ai-native/inspection-assist/inspection-assist.composition');
const { Prisma } = require('../../../apps/api/node_modules/@prisma/client');
const { RentalWorkspacePrincipalRepository } = require('@rental-os/rental-core/mysql-workspace-principal');
const { RentalCoreFactRepository } = require('@rental-os/rental-core/mysql-core-facts');
const { getRequestIdentity } = require('@rental-os/platform-server/request-identity');
exports.target = { orderId: 'order-a', allocationId: 'allocation-a', templateId: 'template-a', stage: 'return' };
exports.fixture = () => {
  const state = { user: user({ permissions: ['rental-os:order:view', 'rental-os:order:return'] }), active: true, workspace: 'workspace-a', reads: 0,
    memberActive: true, workspaceActive: true, tenantActive: true, locks: [], transactionDepth: 0,
    drafts: new Map(), operations: new Map(), bindings: new Map(), assets: new Map() };
  const auth = new AuthService({ getAuthSession: async () => state.active ? { id: 'session-a', userId: state.user.id, audience: 'staff', currentWorkspaceId: state.workspace } : undefined,
    findUserById: async () => state.user, findWorkspaceScopedUser: (...args) => principals.findWorkspaceScopedUser(...args), listUserWorkspaces: async () => [],
    lockWorkspaceSessionUser: (...args) => principals.lockWorkspaceSessionUser(...args),
    readWorkspaceSessionUser: (...args) => principals.readWorkspaceSessionUser(...args) },
    { get: key => key === 'AUTH_TOKEN_SECRET' ? 'synthetic-test-secret' : undefined });
  const tokenExpiresAt = Math.floor(Date.now()/1000)+600;
  const credentials = { current: async () => ({ audience: 'staff', requestId: 'request-a', authorization: `Bearer ${auth.signAccessToken({ sub: state.user.id, tid: 'tenant-a', sid: 'session-a', wid: state.workspace, aud: 'staff', exp: tokenExpiresAt })}` }) };
  const guard = new ApiAuthGuard(auth, undefined, undefined, undefined, { rentalOrder: { findFirst: async () => ({ id: 'order-a' }) } });
  const template = { id: 'template-a', tenantId: 'tenant-a', categoryCode: 'vehicle', code: 'return', name: 'Synthetic', stage: 'return', version: 'v1', enabled: true,
    fields: [{ code: 'mileage', label: 'Mileage', type: 'number', required: true, usageMetric: true }, { code: 'photo', label: 'Photo', type: 'photo', required: false }] };
  const order = { id: 'order-a', tenantId: 'tenant-a', workspaceId: 'workspace-a', fulfillmentLocationId: 'location-a', returnLocationId: 'location-a', inspectionTemplateSnapshots: [template],
    allocations: [{ id: 'allocation-a', orderId: 'order-a', assetId: 'asset-a', status: 'picked_up' }] };
  const core = { getOrder: async () => { state.reads++; if (state.onRead) state.onRead(); return structuredClone(order); },
    listInspectionTemplates: async (_tenant, _stage, source) => source.inspectionTemplateSnapshots };
  const match = (row, where) => Object.entries(where).every(([key, value]) => value instanceof Date ? row[key] instanceof Date && row[key].getTime() === value.getTime()
    : value && typeof value === 'object' ? row[key] > value.gt : row[key] === value);
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
    updateMany: async ({ where, data }) => { if (data.status === 'submitted' && state.failLink) { state.failLink = false; throw Error('link failed'); }
      const row=[...state[name].values()].find(row=>match(row,where)); if(!row)return {count:0};
      const revision=row.revision; Object.assign(row,structuredClone(data)); if(data.revision?.increment)row.revision=revision+data.revision.increment; return {count:1}; }
  });
  let queue=Promise.resolve();
  const activeTransactions=new WeakSet();
  const requireTransaction=tx=>{if(!activeTransactions.has(tx)||'$transaction' in tx)throw Error('inspection fixture requires the original active transaction');};
  const query=async q=>{
    const sql=q.sql.replace(/\s+/g,' ').trim(), values=q.values;
    state.locks.push(sql);
    if(sql.includes('FROM Tenant'))return state.tenantActive&&values[0]==='tenant-a'?[{id:'tenant-a'}]:[];
    if(sql.includes('FROM `User`'))return values[0]===state.user.id&&values[1]===state.user.tenantId?[{id:state.user.id,roleId:null}]:[];
    if(sql.includes('FROM auth_sessions'))return state.active&&values[0]==='session-a'&&values[1]===state.user.id?[{id:'session-a'}]:[];
    if(sql.includes('FROM workspace_members'))return state.memberActive&&state.workspaceActive&&values[0]===state.user.tenantId&&values[1]===state.workspace&&values[2]===state.user.id?[{roleId:null}]:[];
    if(sql.includes('FROM `UserRole`'))return [];
    if(sql.includes('FROM `rental_orders`'))return values[0]===order.tenantId&&values[1]===order.workspaceId&&values[2]===order.id?[{id:order.id,workspaceId:order.workspaceId}]:[];
    if(sql.includes('FROM rental_allocations'))return values[0]===order.id?order.allocations.filter(row=>row.assetId).map(row=>({assetId:row.assetId})):[];
    if(sql.includes('FROM rental_assets'))return order.allocations.some(row=>row.assetId===values[0])&&values[1]===order.tenantId&&values[2]===order.workspaceId
      ?[{id:values[0],assetNo:'synthetic-asset',status:'rented',locationId:order.fulfillmentLocationId}]:[];
    if(sql.includes('FROM FileAsset')){const row=state.assets.get(values[0]);return row&&row.tenantId===values[1]&&row.businessModule==='rental-core'
      &&row.businessType==='rental_order'&&row.businessId===values[2]&&row.uploadedBy===values[3]?[{id:row.id}]:[];}
    if(sql.includes('FROM file_upload_sessions')){const row=state.assets.get(values[0]);return row?.uploadSession?.tenantId===values[1]?[{id:row.uploadSession.id}]:[];}
    throw Error('unexpected inspection fixture SQL');
  };
  const db={ aiInspectionDraft:delegate('drafts'), aiInspectionOperation:delegate('operations'), aiInspectionEvidenceBinding:delegate('bindings'), fileAsset:delegate('assets'),
    user:{},
    workspaceMember:{findFirst:async({where})=>state.memberActive&&state.workspaceActive&&where.userId===state.user.id&&where.workspaceId===state.workspace
      ?{role:null,dataScope:null,locationScope:state.user.locationScope}:null},
    authSession:{findFirst:async({where})=>state.active&&where.id==='session-a'&&where.userId===state.user.id&&tokenExpiresAt*1000>where.expiresAt.gt.getTime()
      ?{audience:'staff',currentWorkspaceId:state.workspace}:null},
    $transaction:callback=>{const work=queue.then(async()=>{const old=structuredClone({drafts:state.drafts,operations:state.operations,bindings:state.bindings});
      const tx={...db};delete tx.$transaction;tx.$queryRaw=async q=>{requireTransaction(tx);return query(q);};
      activeTransactions.add(tx);state.transactionDepth++;
      try{return await callback(tx);}catch(error){Object.assign(state,old);throw error;}
      finally{state.transactionDepth--;activeTransactions.delete(tx);}});queue=work.catch(()=>undefined);return work;} };
  const principals=new RentalWorkspacePrincipalRepository(db,{
    findUserById:async(id,tx)=>{if(tx)requireTransaction(tx);return state.tenantActive&&id===state.user.id?structuredClone(state.user):undefined;},
    projectWorkspace:()=>{throw Error('unexpected workspace projection');},projectRoleScope:value=>value,projectDataScope:value=>value
  });
  const facts=new RentalCoreFactRepository(db,{getRequestWorkspaceId:()=>getRequestIdentity()?.workspaceId});
  const orders={lockOrder:async(tenant,id,tx)=>{requireTransaction(tx);return facts.lockOrder(tenant,id,tx);},
    findOrder:async(tenant,id,tx)=>{requireTransaction(tx);const identity=getRequestIdentity();
      if(tenant!==order.tenantId||id!==order.id||identity?.workspaceId!==order.workspaceId)return undefined;
      return core.getOrder();}};
  const date=new Date('2026-10-07T00:00:00Z');
  state.assets.set('file-a',{id:'file-a',tenantId:'tenant-a',uploadedBy:state.user.id,businessModule:'rental-core',businessType:'rental_order',businessId:'order-a',uploadScene:'return-evidence',status:'active',
    storageProvider:'synthetic-controlled-provider',storageKey:'object-a',mimeType:'image/png',sizeBytes:64,updatedAt:date,
    uploadSession:{id:'upload-a',tenantId:'tenant-a',status:'completed',completedAt:date,storageKey:'object-a'}});
  const ports={guard,credentials,core,db,auth,orders};
  return { state, template, order, db, ports, services:composeInspectionAssist(ports) };
};
