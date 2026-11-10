/** Persist original Task/CAS locators before enablement. A partial or absent
 * original receipt never permits replay, a new reference or TTL refresh. */
import { aiTaskReadPolicyReference,type AiTaskReadPolicyQuery,type AiTaskReadPolicyReference,type AiTaskReadPolicyEnable,type AiTaskReadPolicyResponse } from '@rental-os/shared';
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
  let pending:AiTaskReadPolicyReference|null=null,invalid=false;
  try{pending=input.store.read();invalid=!!pending&&(pending.taskId!==input.query.taskId||input.query.runId!==undefined&&pending.runId!==input.query.runId);}catch{invalid=true;}
  let active=true,generation=0,request:AbortController|null=null,view:View={review:null,operation:null,pending,invalid,busy:null,error:null};
  const publish=(v:Partial<View>)=>{if(active&&input.current()){view={...view,...v};input.changed();}};
  const assert=(owner=generation)=>{if(!active||!input.current()||owner!==generation)throw Error('AI_SCOPE_CHANGED');};
  const validate=(v:AiTaskReadPolicyResponse)=>{if(v.reference.taskId!==input.query.taskId||input.query.runId!==undefined&&v.reference.runId!==input.query.runId
    ||v.scope.tenantId!==input.tenantId||v.scope.workspaceId!==input.workspaceId)throw Error('AI_SCOPE_CHANGED');};
  const run=async<T>(kind:NonNullable<View['busy']>,action:(signal:AbortSignal,owner:number)=>Promise<T>)=>{
    assert();if(view.busy)throw Error('AI_OPERATION_BUSY');const owner=++generation,controller=new AbortController();request=controller;publish({busy:kind,error:null});
    try{return await action(controller.signal,owner);}catch(error){if(owner===generation)publish({review:null,error});throw error;}
    finally{if(request===controller){request=null;publish({busy:null});}}
  };
  return Object.freeze({get view(){return view;},
    async inspect(){if(view.pending||view.invalid)throw Error('AI_RESULT_UNKNOWN');return run('inspect',async(s,owner)=>{publish({review:null});const v=await input.api.inspect(input.query,s);assert(owner);validate(v);
      if(v.phase!=='review')throw Error('AI_RESOURCE_UNAVAILABLE');publish({review:v,operation:null});});},
    async enable(){assert();const review=view.review;if(!review||view.pending||view.invalid)throw Error('AI_RESOURCE_UNAVAILABLE');
      return run('enable',async(s,owner)=>{const reference=structuredClone(review.reference);input.store.write(reference);const stored=input.store.read();
        if(JSON.stringify(stored)!==JSON.stringify(reference)){publish({invalid:true});throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');}
        assert(owner);publish({pending:reference,review:null});const v=await input.api.enable({...reference,decision:'enable_original_task_reading'},s);assert(owner);validate(v);
        if(JSON.stringify(v.reference)!==JSON.stringify(reference)||!v.completeRecorded)throw Error('AI_RESULT_UNKNOWN');input.store.clear(reference);publish({pending:null,operation:v});});},
    async operation(){assert();const reference=view.pending;if(!reference||view.invalid)throw Error('AI_OPERATION_LOCATOR_UNAVAILABLE');return run('operation',async(s,owner)=>{
      const v=await input.api.operation(reference,s);assert(owner);validate(v);if(JSON.stringify(v.reference)!==JSON.stringify(reference))throw Error('AI_RESULT_UNKNOWN');
      if(v.completeRecorded){input.store.clear(reference);publish({pending:null});}publish({operation:v,review:null});});},
    activate(){active=true;},clear(){generation++;request?.abort();request=null;view={...view,review:null,operation:null,busy:null,error:null};input.changed();},
    dispose(){active=false;generation++;request?.abort();request=null;view={...view,review:null,operation:null,busy:null,error:null};}
  });
}
