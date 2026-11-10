/** Transport only original Task/CAS references. A damaged write response keeps
 * its caller in original-receipt recovery; no retry or policy is synthesized. */
import { AI_TASK_READ_POLICY_HTTP, AI_TASK_READ_POLICY_OPERATIONS, aiTaskReadPolicyQuery, aiTaskReadPolicyReference, aiTaskReadPolicyEnable, aiTaskReadPolicyResponse,
  type AiTaskReadPolicyQuery, type AiTaskReadPolicyReference, type AiTaskReadPolicyEnable, type ApiResult } from '@rental-os/shared';
import { http } from './http';
import { currentSessionEpoch,currentSessionSignal } from '@/app/queryClient';
const post=async(action:'inspect'|'enable'|'operation',input:AiTaskReadPolicyQuery|AiTaskReadPolicyEnable|AiTaskReadPolicyReference,signal:AbortSignal)=>{
  const epoch=currentSessionEpoch(),active=AbortSignal.any([signal,currentSessionSignal()]);if(active.aborted)throw Error('AI_SCOPE_CHANGED');
  const command=structuredClone(input);
  const result=await http.post<ApiResult<unknown>>(`/${AI_TASK_READ_POLICY_HTTP.basePath}/${AI_TASK_READ_POLICY_HTTP[action]}`,command,{signal:active,timeout:12000});
  if(active.aborted||epoch!==currentSessionEpoch())throw Error('AI_SCOPE_CHANGED');
  if(new TextEncoder().encode(JSON.stringify(result.data.data)).length>131072)throw Error('AI_RESOURCE_UNAVAILABLE');
  const value=aiTaskReadPolicyResponse.parse(result.data.data);
  if(value.reference.taskId!==command.taskId||command.runId!==undefined&&value.reference.runId!==command.runId)throw Error('AI_SCOPE_CHANGED');
  if(value.phase!==(action==='inspect'?'review':'operation'))throw Error('AI_RESULT_UNKNOWN');
  if(action!=='inspect'){
    const {decision:_decision,...reference}=command as AiTaskReadPolicyEnable;
    const expected=aiTaskReadPolicyReference.parse(reference);
    if(value.reference.expiresAt!==expected.expiresAt||value.reference.reviewHash!==expected.reviewHash
      ||AI_TASK_READ_POLICY_OPERATIONS.some(op=>value.reference.expected[op]!==expected.expected[op]))throw Error('AI_RESULT_UNKNOWN');
  }
  return value;
};
export const aiTaskReadPolicyApi=Object.freeze({inspect:(v:AiTaskReadPolicyQuery,s:AbortSignal)=>post('inspect',aiTaskReadPolicyQuery.parse(v),s),
  enable:(v:AiTaskReadPolicyEnable,s:AbortSignal)=>post('enable',aiTaskReadPolicyEnable.parse(v),s),operation:(v:AiTaskReadPolicyReference,s:AbortSignal)=>post('operation',aiTaskReadPolicyReference.parse(v),s)});
