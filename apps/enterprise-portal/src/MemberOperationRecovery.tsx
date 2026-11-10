/** Own retained enterprise-operation references remain discoverable after management access ends.
 * Registered original GETs only: never raw invite-code recovery, a member list, or a grant,
 * a retry surface, or evidence that today's relationship/authority changed. */
import { useEffect, useState } from "react";
import { ActionButton, Alert } from "@/components/ui/customer-entry";
import { useEnterprise } from "./enterprise-session";
import { originalMemberWorkflowReferences, originalInviteWorkflowReferences, originalJoinWorkflowReferences, originalJoinReviewReferences, originalApplicationWorkflowReferences, originalPolicyWorkflowReferences, originalManagementWorkflowReferences, useOriginalWorkflowOperation, type OriginalMemberWorkflowReference } from "./original-workflow-operation";

function OriginalMemberOperation({ reference, english }: { reference: OriginalMemberWorkflowReference; english: boolean }) {
  const context = useEnterprise();
  const operation = useOriginalWorkflowOperation(reference.scope ?? "members", { originalCorporateId: reference.corporateId!, originalOperationKey: reference.operationKey!, originalMembershipId: reference.membershipId, originalAdministrator: reference.administrator, originalInviteId: reference.inviteId, originalJoinRequestId: reference.joinRequestId, originalJoinSubmission: reference.joinSubmission, originalApplicationId: reference.applicationId, originalApplicationSave: reference.applicationSave, originalPolicySave: reference.policySave, originalManagementSave: reference.managementSave, originalManagementRequestId: reference.managementRequestId });
  const change = reference.administrator ? operation.administratorChangeTarget : operation.memberChangeTarget;
  const revoked = operation.inviteRevocationTarget;
  const matchesInvite = reference.inviteId ? Boolean(revoked && revoked.corporateId === reference.corporateId && revoked.inviteId === reference.inviteId)
    : operation.inviteCreationCorporateId === reference.corporateId;
  const matchesTarget = reference.managementRequestId ? operation.managementWithdrawalId === reference.managementRequestId : reference.managementSave ? operation.managementSaveCorporateId === reference.corporateId : reference.policySave ? Boolean(operation.policySaveTarget && operation.policySaveTarget.corporateId === reference.corporateId && operation.policySaveTarget.membershipId === reference.membershipId) : reference.scope === "applications" ? reference.applicationSave ? operation.applicationSave : operation.applicationWithdrawalId === reference.applicationId : reference.scope === "join-review" ? Boolean(operation.joinReviewTarget && operation.joinReviewTarget.requestId === reference.joinRequestId && operation.joinReviewTarget.corporateId === reference.corporateId) : reference.scope === "join" ? reference.joinSubmission ? operation.joinSubmission : operation.joinWithdrawalId === reference.joinRequestId : reference.scope === "invites" ? matchesInvite : reference.membershipId
    ? Boolean(change && change.corporateId === reference.corporateId && change.membershipId === reference.membershipId)
    : operation.transferInitiationCorporateId === reference.corporateId;
  const matches = operation.pending?.key === reference.operationKey && matchesTarget;
  return <section aria-label={reference.managementRequestId ? (english ? "Original management request withdrawal" : "原管理申请撤回") : reference.managementSave ? (english ? "Original management request save" : "原管理申请保存") : reference.policySave ? (english ? "Original policy save" : "原政策保存") : reference.applicationSave ? (english ? "Original application save" : "原企业申请保存") : reference.applicationId ? (english ? "Original application withdrawal" : "原企业申请撤回") : reference.joinSubmission ? (english ? "Original join submission" : "原加入提交") : reference.scope === "join-review" ? (english ? "Original join review" : "原加入审核") : reference.joinRequestId ? (english ? "Original join withdrawal" : "原加入申请撤回") : reference.inviteId ? (english ? "Original invite revocation" : "原邀请停用") : reference.scope === "invites" ? (english ? "Original invite creation" : "原邀请创建") : reference.administrator ? (english ? "Original administrator authority change" : "原管理员授权变更") : reference.membershipId ? (english ? "Original member relationship change" : "原成员关系变更") : (english ? "Original administrator handoff request" : "原管理员交接发起")}>
    {!reference.managementRequestId && !reference.applicationSave && !reference.applicationId && !reference.joinSubmission && (!reference.joinRequestId || reference.scope === "join-review") && <p>{english ? "Original enterprise ID" : "原企业 ID"}: {reference.corporateId}</p>}
    {reference.managementRequestId && <><p>{english ? "Original management request ID" : "原管理申请 ID"}: {reference.managementRequestId}</p><Alert type="info" title={english ? "Original withdrawal only; enterprise, membership, evidence and rental/payment facts are retained." : "仅读原撤回；企业、会员和材料保留，不改变租赁或资金事实。"} /></>}
    {reference.managementSave && <Alert type="info" title={english ? "Only your original management-request save is read; no profile, credit, policy, payment or current authority is changed." : "仅读本人原管理申请保存，不修改主档、授信、政策、付款或当前权限。"} />}
    {reference.policySave && <Alert type="info" title={english ? "Only your original policy-save result is read, not current limits, payment authority or a new grant." : "仅读本人原政策保存结果，不代表当前额度、付费权或重新授权。"} />}
    {reference.applicationSave && <Alert type="info" title={english ? "This reads your original save result, not current application material, approval or management authority." : "仅读本人原保存结果，不代表当前申请材料、批准或管理权限。"} />}
    {reference.applicationId && <><p>{english ? "Original application ID" : "原企业申请 ID"}: {reference.applicationId}</p><Alert type="info" title={english ? "Original withdrawal only; enterprise/member records and evidence are not deleted." : "仅读原撤回；不删除企业、会员或材料。"} /></>}
    {reference.joinSubmission && <Alert type="info" title={english ? "Only the original join result is read; no code recovery, replay or current membership grant." : "仅读原加入结果，不补码、重发或授当前成员权限。"} />}
    {reference.joinRequestId && <><p>{english ? "Original request ID" : "原申请 ID"}: {reference.joinRequestId}</p>
      <Alert type="info" title={reference.scope === "join-review" ? (english ? "This reads your original review receipt, not current membership or management authority." : "仅读本人原审核收据，不代表当前成员或管理权限。") : (english ? "This reads the original withdrawal only, without removing joined members or cancelling rentals." : "仅读原申请撤回，不移除已加入成员或取消租赁。")} /></>}
    {reference.membershipId && <p>{english ? "Original relationship ID" : "原关系 ID"}: {reference.membershipId}</p>}
    <p>{english ? "Original operation key" : "原操作键"}: {reference.operationKey}</p>
    {reference.inviteId && <p>{english ? "Original invitation ID" : "原邀请 ID"}: {reference.inviteId}</p>}
    {reference.scope === "invites" && !reference.inviteId && <Alert type="info" title={english ? "This verifies creation only; the original raw code cannot be read or regenerated." : "仅核对原创建；原码不能再次读取或补造。"} />}
    <ActionButton disabled={context.loading || !context.session || operation.busy || !matches} intent="review"
      label={reference.managementRequestId ? (english ? "Read original management request withdrawal" : "核对原管理申请撤回") : reference.managementSave ? (english ? "Read original management request save" : "核对原管理申请保存") : reference.policySave ? (english ? "Read original policy save" : "核对原政策保存") : reference.applicationSave ? (english ? "Read original application save" : "核对原企业申请保存") : reference.applicationId ? (english ? "Read original application withdrawal" : "核对原企业申请撤回") : reference.joinSubmission ? (english ? "Read original join submission" : "核对原加入提交") : reference.scope === "join-review" ? (english ? "Read original join review" : "核对原加入审核") : reference.joinRequestId ? (english ? "Read original join withdrawal" : "核对原加入申请撤回") : reference.inviteId ? (english ? "Read original invite revocation" : "核对原邀请停用") : reference.scope === "invites" ? (english ? "Read original invite creation" : "核对原邀请创建") : reference.administrator ? (english ? "Read original administrator change" : "核对原管理员变更") : reference.membershipId ? (english ? "Read original member change" : "核对原关系变更") : (english ? "Read original handoff request" : "核对原交接发起")} onAction={async () => {
        operation.assertCurrent();
        if (!matches) throw new Error("原引用已变化，保留原键 / Original reference changed");
        const original = await operation.recover(async () => {});
        // The reader verifies the original receipt, not today's member list.
        // Retire that exact original before invalidating current admission readers.
        if (original?.state === "committed") context.reload();
      }} />
    {!matches && <Alert type="warning" title={english ? "The retained reference changed or is unavailable. Keep it; no request can be resent here." : "原引用已变化或不可读取；保留，不在本页重发。"} />}
    {operation.error && <Alert type="error" title={operation.error} />}
  </section>;
}

export function EnterpriseMemberOperationRecovery({ english }: { english: boolean }) {
  const context = useEnterprise();
  const [snapshot, setSnapshot] = useState<{ identity: string; references: OriginalMemberWorkflowReference[]; error?: string }>();
  const discover = () => {
    if (!context.session || context.loading || context.signal.aborted) { setSnapshot(undefined); return; }
    try {
      const references = [...originalMemberWorkflowReferences(context.tenantCode, context.session.customer.customerId, context.session.workspace?.workspaceCode),
        ...originalInviteWorkflowReferences(context.tenantCode, context.session.customer.customerId, context.session.workspace?.workspaceCode),
        ...originalJoinWorkflowReferences(context.tenantCode, context.session.customer.customerId, context.session.workspace?.workspaceCode),
        ...originalJoinReviewReferences(context.tenantCode, context.session.customer.customerId, context.session.workspace?.workspaceCode),
        ...originalApplicationWorkflowReferences(context.tenantCode, context.session.customer.customerId, context.session.workspace?.workspaceCode),
        ...originalPolicyWorkflowReferences(context.tenantCode, context.session.customer.customerId, context.session.workspace?.workspaceCode),
        ...originalManagementWorkflowReferences(context.tenantCode, context.session.customer.customerId, context.session.workspace?.workspaceCode)];
      setSnapshot({ identity: context.identity, references });
    } catch {
      setSnapshot({ identity: context.identity, references: [], error: english ? "Original references could not be read. This does not establish rollback or allow replay." : "原引用不可读取；不证明已回滚或允许重发。" });
    }
  };
  useEffect(() => { discover(); }, [context.identity, context.loading, english]);
  const visible = snapshot?.identity === context.identity && !context.loading && Boolean(context.session) && !context.signal.aborted ? snapshot : undefined;
  return <section aria-label={english ? "Your original enterprise operations" : "本人原企业操作"}>
    <h3>{english ? "Your original enterprise operations" : "本人原企业操作"}</h3>
    <Alert type="info" title={english ? "Only original references retained in this browser and workspace are shown, without current member-list access." : "仅显示本浏览器、当前本人及空间保留的原引用，不依赖今日成员列表权限。"}
      description={english ? "Original results are not today's relationship or authority. A pending initiation does not prove handoff. Missing references or receipts do not prove no write; this page cannot retry or cancel." : "原结果不代表今日关系或权限，原发起 pending 不证明已交接；缺引用或收据不代表未写入。本页不重发或取消。"} />
    <ActionButton disabled={context.loading || !context.session || context.signal.aborted} intent="review"
      label={english ? "Refresh original references" : "重读本地原引用"} onAction={async () => { discover(); }} />
    {visible?.error && <Alert type="error" title={visible.error} />}
    {visible?.references.map(reference => reference.recoverable
      ? <OriginalMemberOperation key={`${reference.storageKey}:${reference.operationKey}`} reference={reference} english={english} />
      : <Alert key={reference.storageKey} type="warning" title={english ? "A retained reference is unreadable or has no dedicated reader here. Keep it; do not resend or change its key." : "一条原引用不可读取或尚无本页专用回读；保留，不重发或换键。"} />)}
    {visible && !visible.error && visible.references.length === 0 && <p>{english ? "No readable original reference was found in this browser scope. This is not proof that an operation did not execute." : "本浏览器范围未发现可读原引用，不证明原操作未执行。"}</p>}
  </section>;
}
