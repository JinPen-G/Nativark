import {useEffect,useMemo,useReducer,useRef} from 'react';
import {AI_TASK_ORIGINAL_READ_POLICY_ENTRY_PERMISSIONS,type AiTaskReadPolicyQuery} from '@rental-os/shared';
import {ActionButton,Alert,ConfirmAction} from '@/components/ui';
import {currentSessionEpoch} from '@/app/queryClient';
import {useAuthStore} from '@/features/auth/authStore';
import {aiTaskReadPolicyApi,aiTaskOriginalReadPolicyApi} from '@/api/aiTaskReadPolicy';
import {createTaskReadPolicySession,taskReadPolicyStore} from './task-read-policy-session';
import {useAiManagementLocale} from './management-locale';
import {formatTimestamp} from './formatters';
import styles from './AiManagement.module.css';
/** Explicit reading renewal through current original resource authorization.
 * Existing manager operations keep their own route and storage namespace.
 * Mount/inspection never writes policy or grants model/Core execution. */
export function TaskReadPolicy({query,identity,current,onAccessChanged}:{query:AiTaskReadPolicyQuery;identity:string;current():boolean;onAccessChanged?():void}){
  const auth=useAuthStore(),{t}=useAiManagementLocale(),[,changed]=useReducer(n=>n+1,0);
  const manager=auth.hasPermission('system:params:manage');
  const stableOwner=JSON.stringify([auth.tenant?.tenantId,auth.currentWorkspaceId,auth.user?.id,query.taskId]);
  const epoch=currentSessionEpoch();
  const binding=JSON.stringify([identity,query,auth.tenant?.tenantId,auth.currentWorkspaceId,auth.user,auth.token,epoch,manager]);
  const owner=useRef({binding,current,onAccessChanged});owner.current={binding,current,onAccessChanged};
  const session=useMemo(()=>{let storage:Storage|undefined;try{storage=window.localStorage;}catch{/* The original locator must be saved before dispatch. */}
    return createTaskReadPolicySession({query,tenantId:auth.tenant?.tenantId??'',workspaceId:auth.currentWorkspaceId??'',
      current:()=>owner.current.binding===binding&&epoch===currentSessionEpoch()&&!document.hidden&&owner.current.current(),changed,
      api:manager?aiTaskReadPolicyApi:aiTaskOriginalReadPolicyApi,
      store:taskReadPolicyStore(`${manager?'rental-os-task-reading':'rental-os-original-task-reading'}:${stableOwner}`,storage)});},[binding,stableOwner,manager]);
  useEffect(()=>{session.activate();const clear=()=>session.clear();document.addEventListener('visibilitychange',clear);return()=>{document.removeEventListener('visibilitychange',clear);session.dispose();};},[session]);
  if((!manager&&!AI_TASK_ORIGINAL_READ_POLICY_ENTRY_PERMISSIONS.some(auth.hasPermission))||!session.isCurrent())return null;
  const data=session.view,rows=data.review?.items??data.operation?.items;
  const action=(work:()=>Promise<unknown>)=>async()=>{try{await work();}finally{if(session.isCurrent())owner.current.onAccessChanged?.();}};
  const labels={read_metadata:'任务信息',read_events:'任务事件',read_step_terminal:'原步骤结果'};
  return <section className={styles.stack} aria-label={t(manager?'本任务读取政策':'任务读取权限')} aria-busy={!!data.busy}>
    <p>{t(manager?'仅管理员明确启用本任务的读取政策。不会启动模型或授予业务执行。':'按当前业务权限重新核对这项任务。不会启动模型或执行业务。')}</p>
    {data.invalid&&<Alert type="warning" title={t('原启用定位不可读取，不能再次启用。')}/>}
    {data.pending?<><Alert type="warning" title={t('原启用结果待核对。')} description={t(manager?'仅读取原CAS收据；部分或未观察结果不代表未写入，不重发。':'上次请求尚未确认，请继续核对原结果；不会重复提交。')}/>
      <ActionButton label={t(manager?'核对原启用结果':'核对上次读取请求')} disabled={!!data.busy} onAction={action(()=>session.operation())}/></>
      :<ActionButton label={t(manager?'核对本任务读取政策':'检查任务读取权限')} disabled={!!data.busy||data.invalid} onAction={action(()=>session.inspect())}/>}
    {manager&&rows&&<dl>{rows.map(row=><div key={row.operation}><dt>{t(labels[row.operation])}</dt><dd>{t(row.current?(row.active?'当前有效':'已过期或当前权限不足'):'未配置')}
      {row.current&&` · ${formatTimestamp(row.current.expiresAt).value}`}</dd>
      {data.operation&&<dd>{t('核对原启用结果')}：{t(row.receipt.state==='recorded'?'已记录':'未观察到原操作。')}</dd>}
      <dd>{t('本次期限')}：{formatTimestamp(row.desired.expiresAt).value}</dd></div>)}</dl>}
    {!manager&&rows&&<p>{t(rows.every(row=>row.active)?'当前可以读取这项任务。':'需要重新确认当前任务读取权限。')}</p>}
    {!data.pending&&data.review&&(manager||!data.review.items.every(row=>row.active))&&<ConfirmAction label={t(manager?'明确启用本任务读取':'确认继续读取')} prompt={t(manager?'按已核对的原权限要求与期限，启用本任务三项读取政策？不会启动模型或执行业务。':'按刚核对的当前业务权限继续读取这项任务？不会开始模型或业务操作。')}
      disabled={!!data.busy||data.invalid} onConfirm={action(()=>session.enable())}/>}
    {data.operation?.completeRecorded&&<Alert type={data.operation.items.every(row=>row.active)?'success':'warning'} title={t(manager?'原读取政策CAS已记录。':'原读取请求已核对。')} description={t('当前有效性仍按期限与权限核对；请重新读取原任务。')}/>}
    {data.operation&&!data.operation.completeRecorded&&<Alert type="warning" title={t('原启用只观察到部分结果，保留定位继续核对。')}/>}
    {!!data.error&&<Alert type="warning" title={t(data.pending?'原启用未能确认，请核对原收据。':manager?'当前管理员权限、原任务或政策已变化，请重新核对。':'当前任务或业务访问权限已变化，请重新核对。')}/>}
  </section>;
}
