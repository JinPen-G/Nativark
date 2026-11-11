/** Explicit same-owner original-manager policy bootstrap. Uses original CAS
 * receipts independently for three read operations; partial/unknown enables
 * only original receipt observation, never replay or a model/Core grant. */
import { Body, Controller, Header, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { AI_TASK_READ_POLICY_HTTP, AI_TASK_READ_POLICY_VERSION, AI_TASK_READ_POLICY_OPERATIONS, AI_SCENE_REQUEST_DRAFT_VERSION,
  aiTaskReadPolicyQuery, aiTaskReadPolicyReference, aiTaskReadPolicyEnable, aiTaskReadPolicyResponse,
  type AiTaskReadPolicyReference } from '@rental-os/shared';
import type { AiOriginalSceneDependencies } from './scenes/original-scenes.composition';
import { composeAiOriginalScenes } from './scenes/original-scenes.composition';
import type { composeRequestBoundOriginalTaskActionPolicies } from './scenes/request-bound-scenes.application';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import { AiScopeRepository } from './ai-scope.repository';
import { aiTaskAccessFromContext, AiTaskRepositoryError } from './ai-task.repository';
import { TenantModelConfigurationAuthority } from './tenant-model-config.authority';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { freezeOriginalInput } from './task-request/original-request.validation';
import { originalIdentityHash } from './task-request/original-request.authority';
import { runWithRequestIdentity } from '../../common/request-identity';
import { waitForTaskApplicationDependency } from './runner/prisma-task-application';
import { AiTaskRunnerError } from './runner/ai-task-runner.service';
import { respondAiScene } from './scenes/original-scenes.controller';
import { withRequestAbort } from './scenes/request-abort';
export const AI_TASK_READ_POLICY_REQUESTS=Symbol('AI_TASK_READ_POLICY_REQUESTS');
type Policies=ReturnType<typeof composeRequestBoundOriginalTaskActionPolicies>;
type ReadingReceipt=Awaited<ReturnType<Policies['readReadingRecorded']>>['receipt'];
type Dependencies=Omit<AiOriginalSceneDependencies,'credentials'> & {policies:Policies};
type Request={headers:{authorization?:unknown}};
const supportedScenes=['order_explanation','opening_diagnosis','quote_clarification'] as const;
const unavailable=()=>new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'), denied=()=>new AiTaskRepositoryError('AI_ACCESS_DENIED');
export function composeTaskReadPolicyRequests(d:Dependencies){
  const call=async(request:Request,value:unknown,action:'inspect'|'enable'|'operation',signal?:AbortSignal)=>{
    const schema=action==='inspect'?aiTaskReadPolicyQuery:action==='enable'?aiTaskReadPolicyEnable:aiTaskReadPolicyReference;
    const parsed=schema.safeParse(structuredClone(value));if(!parsed.success)throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command=freezeOriginalInput(parsed.data),header=request.headers.authorization;
    if(typeof header!=='string'||header.length>8192||!/^Bearer \S+$/u.test(header))throw denied();
    let active=!signal?.aborted;const close=()=>{active=false;};signal?.addEventListener('abort',close,{once:true});
    const body={headers:{authorization:header}},clock=d.clock??(()=>new Date()),requestId=randomUUID();
    const credentials={current:async()=>{if(!active)throw denied();return{authorization:header,audience:'operator' as const,requestId};}};
    try{return await waitForTaskApplicationDependency(()=>runWithRequestIdentity({},async()=>{
      const input={...d,credentials},identities=new AiTaskCurrentIdentityAuthority(d.auth,credentials,clock),scopes=new AiScopeRepository(d.db,identities,clock);
      const bound=await scopes.resolveCurrent(),context=bound.context;
      if(context.actor.kind!=='user'||context.scope.kind!=='workspace'||context.audience!=='operator')throw denied();
      const workspaceScope=context.scope;
      const manager=new TenantModelConfigurationAuthority(d.guard,credentials,identities);
      await manager.authorize({tenantId:workspaceScope.tenantId,workspaceId:workspaceScope.workspaceId,actorId:context.actor.userId},'manage');
      const access=aiTaskAccessFromContext(context,command.taskId,clock());
      const task=await d.db.aiTask.findFirst({where:{AND:[access.where,{scopeId:bound.scope.id}]}});
      if(!task||task.id!==command.taskId||task.ownerId!==context.actor.userId||task.ownerKind!=='USER'||task.audience!=='OPERATOR'
        ||task.archivedAt!==null||!supportedScenes.some(scene=>scene===task.sceneCode)||!task.inputRef)throw unavailable();
      const scenes=composeAiOriginalScenes(input),original={draftVersion:AI_SCENE_REQUEST_DRAFT_VERSION,inputRef:task.inputRef};
      const source=await scenes.requests.readHistorical(original),creation=await scenes.readTaskReceipt(task.inputRef);
      if(source.receipt.state==='revoked'||source.receipt.contentHash!==task.inputHash
        ||source.receipt.sceneCode!==task.sceneCode||source.receipt.sceneVersion!==task.sceneVersion||creation.state!=='observed'
        ||creation.taskId!==task.id||command.runId!==undefined&&command.runId!==creation.runId)throw denied();
      const verify=async()=>{
        if(!active)throw denied();const current=await scopes.resolveCurrent();
        if(current.scope.id!==bound.scope.id||originalIdentityHash(current.context)!==originalIdentityHash(context))throw denied();
        await manager.authorize({tenantId:workspaceScope.tenantId,workspaceId:workspaceScope.workspaceId,actorId:context.actor.userId},'manage');
        const latest=await scenes.requests.readHistorical(original),created=await scenes.readTaskReceipt(task.inputRef!);
        if(latest.receipt.state==='revoked'||latest.receipt.contentHash!==source.receipt.contentHash
          ||latest.receipt.sceneCode!==task.sceneCode||latest.receipt.sceneVersion!==task.sceneVersion||originalIdentityHash(latest.context)!==originalIdentityHash(source.context)
          ||created.state!=='observed'||created.taskId!==task.id||created.runId!==creation.runId)throw denied();
      };
      const describe=async()=>{const rows=[];for(const operation of AI_TASK_READ_POLICY_OPERATIONS){
        const row=await d.policies.describeReading(body,{original,operation});if(row.taskId!==task.id||row.operation!==operation)throw denied();rows.push(row);}
        await verify();return rows;};
      const digest=(reference:Omit<AiTaskReadPolicyReference,'reviewHash'>,required:readonly(readonly string[])[])=>requestFingerprint({kind:AI_TASK_READ_POLICY_VERSION,
        scope:context.scope,actorId:context.actor.userId,origin:{inputRef:task.inputRef,contentHash:source.receipt.contentHash},reference,required});
      const observe=async(reference:AiTaskReadPolicyReference)=>{
        const current=await describe(),receipts:ReadingReceipt[]=[];for(const operation of AI_TASK_READ_POLICY_OPERATIONS){
          const row=await d.policies.readReadingRecorded(body,{original,operation,expectedRevision:reference.expected[operation]});receipts.push(row.receipt);}
        await verify();const complete=receipts.every(row=>row.state==='recorded');
        if(complete){const required=receipts.map(row=>row.policy!.requiredPermissions),{reviewHash,...locator}=reference;
          if(receipts.some(row=>row.policy!.expiresAt!==reference.expiresAt)||digest(locator,required)!==reviewHash)throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');}
        return aiTaskReadPolicyResponse.parse({contractVersion:AI_TASK_READ_POLICY_VERSION,phase:'operation',reference,scope:context.scope,observedAt:clock().toISOString(),completeRecorded:complete,
          items:current.map((row,i)=>({operation:row.operation,current:row.current,active:!!row.current&&Date.parse(row.current.expiresAt)>clock().getTime()
            &&row.current.requiredPermissions.every(p=>'access'in context&&context.access.permissions.includes(p)),
            desired:{requiredPermissions:receipts[i].policy?.requiredPermissions??row.requiredPermissions,expiresAt:reference.expiresAt},
            receipt:{state:receipts[i].state,policy:receipts[i].policy}})),execution:'not_attempted',authority:'reading_policy_not_model_or_core_authorization'});
      };
      if(action==='operation')return observe(aiTaskReadPolicyReference.parse(command));
      const rows=await describe();if(rows.some(row=>row.requiredPermissions.some(p=>!('access'in context)||!context.access.permissions.includes(p))))throw unavailable();
      if(action==='inspect'){
        const expiresAt=new Date(clock().getTime()+Math.min(...rows.map(row=>row.ttlMs))).toISOString();
        const locator={taskId:task.id,runId:creation.runId,expiresAt,expected:Object.fromEntries(rows.map(row=>[row.operation,row.current?.revision??null]))} as Omit<AiTaskReadPolicyReference,'reviewHash'>;
        const reference={...locator,reviewHash:digest(locator,rows.map(row=>row.requiredPermissions))};
        return aiTaskReadPolicyResponse.parse({contractVersion:AI_TASK_READ_POLICY_VERSION,phase:'review',reference,scope:context.scope,observedAt:clock().toISOString(),completeRecorded:false,
          items:rows.map(row=>({operation:row.operation,current:row.current,active:!!row.current&&Date.parse(row.current.expiresAt)>clock().getTime(),
            desired:{requiredPermissions:row.requiredPermissions,expiresAt},receipt:{state:'not_checked',policy:null}})),execution:'not_attempted',authority:'reading_policy_not_model_or_core_authorization'});
      }
      const {decision:_decision,...rawReference}=aiTaskReadPolicyEnable.parse(command);
      const reference=aiTaskReadPolicyReference.parse(rawReference);
      const {reviewHash,...locator}=reference;
      if(reference.taskId!==task.id||reference.runId!==creation.runId||rows.some(row=>(row.current?.revision??null)!==reference.expected[row.operation as keyof typeof reference.expected])
        ||digest(locator,rows.map(row=>row.requiredPermissions))!==reviewHash)throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      await verify();let attempted=false;
      try{for(const operation of AI_TASK_READ_POLICY_OPERATIONS){attempted=true;
        await d.policies.configureReadingRecorded(body,{original,operation,expectedRevision:reference.expected[operation],expiresAt:reference.expiresAt});await verify();}
        return await observe(reference);
      }catch(error){if(attempted)throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');throw error;}
    }),action==='enable',signal);}finally{active=false;signal?.removeEventListener('abort',close);}
  };
  return Object.freeze({inspect:(request:Request,value:unknown,signal?:AbortSignal)=>call(request,value,'inspect',signal),
    enable:(request:Request,value:unknown,signal?:AbortSignal)=>call(request,value,'enable',signal),operation:(request:Request,value:unknown,signal?:AbortSignal)=>call(request,value,'operation',signal)});
}
@Controller(AI_TASK_READ_POLICY_HTTP.basePath)
export class AiTaskReadPolicyController{
  constructor(@Inject(AI_TASK_READ_POLICY_REQUESTS)private readonly requests:ReturnType<typeof composeTaskReadPolicyRequests>){}
  private respond(request:IncomingMessage,action:'inspect'|'enable'|'operation'){
    return respondAiScene(()=>withRequestAbort(request,signal=>this.requests[action](request,(request as IncomingMessage&{body?:unknown}).body,signal)),'read_original_task_read_policy');
  }
  @Post(AI_TASK_READ_POLICY_HTTP.inspect)@HttpCode(200)@Header('Cache-Control','no-store')inspect(@Req()r:IncomingMessage,@Body()_body:unknown){return this.respond(r,'inspect');}
  @Post(AI_TASK_READ_POLICY_HTTP.enable)@HttpCode(200)@Header('Cache-Control','no-store')enable(@Req()r:IncomingMessage,@Body()_body:unknown){return this.respond(r,'enable');}
  @Post(AI_TASK_READ_POLICY_HTTP.operation)@HttpCode(200)@Header('Cache-Control','no-store')operation(@Req()r:IncomingMessage,@Body()_body:unknown){return this.respond(r,'operation');}
}
