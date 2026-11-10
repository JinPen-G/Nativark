import { AI_TASK_READ_POLICY_HTTP, aiTaskReadPolicyQuery, aiTaskReadPolicyReference, aiTaskReadPolicyEnable, aiTaskReadPolicyResponse,
  type AiTaskReadPolicyQuery, type AiTaskReadPolicyReference, type AiTaskReadPolicyEnable, type ApiResult } from '@rental-os/shared';
import { http } from './http';
import { currentSessionEpoch,currentSessionSignal } from '@/app/queryClient';
const post=async(action:'inspect'|'enable'|'operation',input:unknown,signal:AbortSignal)=>{
  const epoch=currentSessionEpoch(),active=AbortSignal.any([signal,currentSessionSignal()]);if(active.aborted)throw Error('AI_SCOPE_CHANGED');
  const result=await http.post<ApiResult<unknown>>(`/${AI_TASK_READ_POLICY_HTTP.basePath}/${AI_TASK_READ_POLICY_HTTP[action]}`,structuredClone(input),{signal:active,timeout:12000});
  if(active.aborted||epoch!==currentSessionEpoch())throw Error('AI_SCOPE_CHANGED');return aiTaskReadPolicyResponse.parse(result.data.data);
};
export const aiTaskReadPolicyApi=Object.freeze({inspect:(v:AiTaskReadPolicyQuery,s:AbortSignal)=>post('inspect',aiTaskReadPolicyQuery.parse(v),s),
  enable:(v:AiTaskReadPolicyEnable,s:AbortSignal)=>post('enable',aiTaskReadPolicyEnable.parse(v),s),operation:(v:AiTaskReadPolicyReference,s:AbortSignal)=>post('operation',aiTaskReadPolicyReference.parse(v),s)});
