/** Persist original Task/CAS locators before enablement. A partial or absent
 * original receipt never permits replay, a new reference or TTL refresh. */
import { AI_TASK_READ_POLICY_OPERATIONS, aiTaskReadPolicyQuery, aiTaskReadPolicyReference, aiTaskReadPolicyResponse,
  type AiTaskReadPolicyQuery, type AiTaskReadPolicyReference, type AiTaskReadPolicyEnable, type AiTaskReadPolicyResponse } from '@rental-os/shared';
type Store={read():AiTaskReadPolicyReference|null;write(v:AiTaskReadPolicyReference):void;clear(v:AiTaskReadPolicyReference):void};
export function taskReadPolicyStore(key:string,storage?:Pick<Storage,'getItem'|'setItem'|'removeItem'>):Store{
  return{read(){if(!storage)throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');const raw=storage.getItem(key);if(raw===null)return null;
    if(!raw||raw.length>4096)throw Error('AI_RESULT_UNKNOWN');return aiTaskReadPolicyReference.parse(JSON.parse(raw));},
    write(v){if(!storage||storage.getItem(key)!==null)throw Error('AI_RESULT_UNKNOWN');const raw=JSON.stringify(aiTaskReadPolicyReference.parse(v));storage.setItem(key,raw);
      if(storage.getItem(key)!==raw)throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');},clear(v){if(!storage||storage.getItem(key)!==JSON.stringify(aiTaskReadPolicyReference.parse(v)))throw Error('AI_RESULT_UNKNOWN');
      storage.removeItem(key);if(storage.getItem(key)!==null)throw Error('AI_RESULT_UNKNOWN');}};
}
type View={review:AiTaskReadPolicyResponse|null;operation:AiTaskReadPolicyResponse|null;pending:AiTaskReadPolicyReference|null;invalid:boolean;busy:'inspect'|'enable'|'operation'|null;error:unknown};
export function createTaskReadPolicySession(input:{query:AiTaskReadPolicyQuery;tenantId:string;workspaceId:string;current():boolean;changed():void;store:Store;
  api:{inspect(v:AiTaskReadPolicyQuery,s:AbortSignal):Promise<AiTaskReadPolicyResponse>;enable(v:AiTaskReadPolicyEnable,s:AbortSignal):Promise<AiTaskReadPolicyResponse>;operation(v:AiTaskReadPolicyReference,s:AbortSignal):Promise<AiTaskReadPolicyResponse>}}){
  const query=aiTaskReadPolicyQuery.parse(structuredClone(input.query));
  let active=true,generation=0,request:AbortController|null=null,reviewReceivedAt=0;
  let view:View={review:null,operation:null,pending:null,invalid:false,busy:null,error:null};
  const publish=(v:Partial<View>)=>{if(active&&input.current()){view={...view,...v};input.changed();}};
  const assert=(owner=generation)=>{if(!active||!input.current()||owner!==generation||request?.signal.aborted)throw Error('AI_SCOPE_CHANGED');};
  const matches=(v:AiTaskReadPolicyReference)=>v.taskId===query.taskId&&(query.runId===undefined||v.runId===query.runId);
  const same=(a:AiTaskReadPolicyReference,b:AiTaskReadPolicyReference)=>a.taskId===b.taskId&&a.runId===b.runId
    &&a.expiresAt===b.expiresAt&&a.reviewHash===b.reviewHash&&AI_TASK_READ_POLICY_OPERATIONS.every(op=>a.expected[op]===b.expected[op]);
  // Original locators survive loss of the visible lifetime. Only presentation
  // is conditional on the current scope; an interrupted write cannot unlock it.
  const remember=(pending:AiTaskReadPolicyReference|null,invalid=false,notify=true)=>{
    view={...view,pending,invalid,review:null};if(notify&&active&&input.current())input.changed();
  };
  const restore=(notify=true)=>{
    try{const stored=input.store.read();
      if(stored&&!matches(stored)){remember(view.pending,true,notify);return;}
      if(view.pending&&(!stored||!same(stored,view.pending))){remember(view.pending,true,notify);return;}
      remember(stored,false,notify);
    }catch{remember(view.pending,true,notify);}
  };
  restore(false);
  const validate=(value:AiTaskReadPolicyResponse,phase:AiTaskReadPolicyResponse['phase'])=>{
    const v=aiTaskReadPolicyResponse.parse(structuredClone(value));
    if(!matches(v.reference)||v.scope.tenantId!==input.tenantId||v.scope.workspaceId!==input.workspaceId)throw Error('AI_SCOPE_CHANGED');
    if(v.phase!==phase||v.items.some(row=>row.desired.expiresAt!==v.reference.expiresAt))throw Error('AI_RESULT_UNKNOWN');
    if(phase==='review'&&(v.completeRecorded||v.items.some(row=>row.receipt.state!=='not_checked'||row.receipt.policy!==null)))throw Error('AI_RESULT_UNKNOWN');
    return v;
  };
  const operation=(value:AiTaskReadPolicyResponse,reference:AiTaskReadPolicyReference)=>{
    const v=validate(value,'operation');
    if(!same(v.reference,reference)||v.items.some(row=>row.receipt.state==='not_checked'
      ||row.receipt.state==='recorded'&&(!row.receipt.policy||row.receipt.policy.expiresAt!==reference.expiresAt
        ||row.receipt.policy.revision!==(reference.expected[row.operation]??0)+1)))throw Error('AI_RESULT_UNKNOWN');
    if(v.completeRecorded!==v.items.every(row=>row.receipt.state==='recorded'&&row.receipt.policy!==null))throw Error('AI_RESULT_UNKNOWN');
    return v;
  };
  const complete=(v:AiTaskReadPolicyResponse,reference:AiTaskReadPolicyReference)=>{
    publish({operation:v,review:null});
    if(v.completeRecorded){assert();input.store.clear(reference);remember(null);}
  };
  const run=async<T>(kind:NonNullable<View['busy']>,action:(signal:AbortSignal,owner:number)=>Promise<T>)=>{
    assert();if(view.busy)throw Error('AI_OPERATION_BUSY');const owner=++generation,controller=new AbortController();request=controller;publish({busy:kind,error:null});
    try{return await action(controller.signal,owner);}catch(error){if(owner===generation)publish({review:null,error});throw error;}
    finally{if(request===controller){request=null;publish({busy:null});}}
  };
  return Object.freeze({get view(){return view;},isCurrent:()=>active&&input.current(),
    async inspect(){assert();restore();if(view.pending||view.invalid)throw Error('AI_RESULT_UNKNOWN');
      return run('inspect',async(s,owner)=>{publish({review:null,operation:null});
        const v=validate(await input.api.inspect(query,s),'review');assert(owner);restore();
        if(view.pending||view.invalid)throw Error('AI_RESULT_UNKNOWN');reviewReceivedAt=Date.now();publish({review:v});});},
    async enable(){assert();const review=view.review;restore();
      if(!review||view.pending||view.invalid)throw Error('AI_RESOURCE_UNAVAILABLE');
      const elapsed=Date.now()-reviewReceivedAt,remaining=Date.parse(review.reference.expiresAt)-Date.parse(review.observedAt);
      if(elapsed<0||!Number.isFinite(remaining)||elapsed>=remaining){publish({review:null});throw Error('AI_REVISION_CONFLICT');}
      return run('enable',async(s,owner)=>{const reference=structuredClone(review.reference);
        // Preserve the exact reviewed CAS even if storage's verification throws.
        // A confirmed readback is still required before any server write.
        remember(reference);input.store.write(reference);const stored=input.store.read();
        if(!stored||!same(stored,reference)){remember(reference,true);throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');}
        assert(owner);const v=operation(await input.api.enable({...reference,decision:'enable_original_task_reading'},s),reference);assert(owner);
        complete(v,reference);if(!v.completeRecorded)throw Error('AI_RESULT_UNKNOWN');});},
    async operation(){assert();const reference=view.pending&&aiTaskReadPolicyReference.parse(structuredClone(view.pending));
      if(!reference||!matches(reference))throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');
      return run('operation',async(s,owner)=>{const v=operation(await input.api.operation(reference,s),reference);assert(owner);complete(v,reference);});},
    activate(){active=true;restore();},clear(){generation++;request?.abort();request=null;view={...view,review:null,operation:null,busy:null,error:null};restore();},
    dispose(){active=false;generation++;request?.abort();request=null;view={...view,review:null,operation:null,busy:null,error:null};}
  });
}
