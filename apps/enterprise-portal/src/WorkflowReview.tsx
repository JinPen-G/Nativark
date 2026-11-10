/** Read only the original workflow material. No latest profile/policy fallback or raw payload rendering. */
import type { EnterpriseWorkflowView } from "@rental-os/shared";
import { readAdministratorTransferMaterial } from "./administrator-transfer-review";
import { enterpriseActionLabel } from "./enterprise-action-labels";
/** Project and freeze only original join material. Missing consent can be rejected, never approved here; server authority remains decisive. */
export function readJoinReviewMaterial(row: EnterpriseWorkflowView, corporateId: string): { row: EnterpriseWorkflowView; canApprove: boolean; key: string } | undefined {
  const id = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(value);
  const date = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    && Number.isFinite(Date.parse(value)) && [new Date(value).toISOString(), new Date(value).toISOString().replace(".000Z", "Z")].includes(value);
  if (!row || row.kind !== "join_request" || !id(row.id) || !id(row.applicantCustomerId) || !id(corporateId) || row.corporateCustomerId !== corporateId
    || row.state !== "pending" || !Number.isSafeInteger(row.revision) || row.revision < 1 || !date(row.createdAt) || !date(row.updatedAt)) return undefined;
  const data = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload : {};
  const payload: Record<string, unknown> = {};
  for (const [field, max] of [["inviteId", 191], ["department", 120], ["employeeNo", 80], ["agreementVersion", 191], ["noticeHash", 64], ["noticeText", 4000], ["acknowledgedAt", 64]] as const) {
    const value = data[field]; if (typeof value === "string" && value.length <= max) payload[field] = value;
  }
  const snapshot: EnterpriseWorkflowView = { id: row.id, kind: "join_request", state: "pending", revision: row.revision,
    corporateCustomerId: corporateId, applicantCustomerId: row.applicantCustomerId, createdAt: row.createdAt, updatedAt: row.updatedAt, payload };
  const canApprove = id(payload.inviteId) && typeof payload.agreementVersion === "string" && Boolean(payload.agreementVersion.trim())
    && typeof payload.noticeText === "string" && Boolean(payload.noticeText.trim()) && typeof payload.noticeHash === "string" && /^[a-f0-9]{64}$/u.test(payload.noticeHash)
    && date(payload.acknowledgedAt) && ([["department", 120], ["employeeNo", 80]] as const).every(([field, max]) => data[field] === undefined || typeof data[field] === "string" && data[field].length <= max);
  return { row: snapshot, canApprove, key: JSON.stringify([snapshot, canApprove]) };
}
export function EnterpriseWorkflowReview({ row, english }: { row: EnterpriseWorkflowView; english: boolean }) {
  const data = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload : {};
  const transfer = readAdministratorTransferMaterial(row), absent = english ? "Not recorded" : "未记录";
  const text = (value: unknown) => typeof value === "string" && value ? value : absent;
  const time = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(undefined, { timeZoneName: "short" }) : absent;
  const fields: Array<[string, string]> = [
    [english ? "Original request" : "原申请引用", row.id], [english ? "Applicant reference" : "申请人引用", row.applicantCustomerId],
    [english ? "Enterprise reference" : "企业引用", text(row.corporateCustomerId)], [english ? "State" : "原申请状态", row.state],
    [english ? "Request revision" : "申请修订", String(row.revision)], [english ? "Created" : "创建时间", time(row.createdAt)],
  ];
  if (row.kind === "corporate_application") fields.push(
    [english ? "Original legal name" : "原法定名称", text(data.legalName)], [english ? "Original region" : "原地区", text(data.region)],
    [english ? "Original legal identifier" : "原主体标识", text(data.legalIdentifier)], [english ? "Original contact" : "原联系人", text(data.contactName)],
    [english ? "Original phone" : "原联系电话", text(data.contactPhone)], [english ? "Original email" : "原邮箱", text(data.email)],
    [english ? "Original claim reference" : "原认领企业引用", text(data.existingCorporateCustomerId)], [english ? "Original agreement version" : "原协议版本", text(data.agreementVersion)],
    [english ? "Original consent" : "原协议确认", typeof data.agreementAcknowledged === "boolean" ? data.agreementAcknowledged ? (english ? "Confirmed" : "已确认") : (english ? "Not confirmed" : "未确认") : absent],
    [english ? "Original confirmation time (UTC)" : "原确认时间（UTC）", text(data.agreementAcknowledgedAt)], [english ? "Request updated (UTC)" : "申请更新时间（UTC）", text(row.updatedAt)],
  );
  if (row.kind === "join_request") fields.push(
    [english ? "Requested department" : "申请部门", text(data.department)], [english ? "Requested employee number" : "申请工号", text(data.employeeNo)],
    [english ? "Original notice version" : "原告知版本", text(data.agreementVersion)], [english ? "Acknowledged at" : "本人确认时间", time(data.acknowledgedAt)],
  );
  if (row.kind === "administrator_transfer") {
    fields.push([english ? "Outgoing administrator reference" : "交出方引用", text(data.fromCustomerId)], [english ? "Target relationship reference" : "接收关系引用", text(data.targetMembershipId)]);
    if (transfer) fields.push(
      [english ? "Original handoff material version" : "原交接材料版本", "1"],
      [english ? "Outgoing relationship reference" : "交出关系引用", transfer.outgoingRelationshipId],
      // updatedAt is an authority revision: keep the original UTC milliseconds, not a rounded local time.
      [english ? "Original outgoing revision (UTC)" : "原交出关系修订（UTC）", transfer.outgoingRevision],
      [english ? "Original target revision (UTC)" : "原接收关系修订（UTC）", transfer.incomingRevision],
      [english ? "Original portal permission revision" : "原门户权限修订", transfer.permissionRevision],
      [english ? "Originally proposed management actions" : "原拟交接管理动作", transfer.actions.map(action => enterpriseActionLabel(action, english)).join(english ? ", " : "、")],
    );
  }
  return <section className="enterprise-approval-review" aria-label={english ? "Original workflow review" : "原申请审阅"}>
    <dl className="enterprise-review-facts">{fields.map(([label, value]) => <div className="enterprise-review-fact" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {row.kind === "corporate_application" && <>
      <p>{english ? "Original representative statement" : "原代表资格说明"}: {text(data.authorityStatement)}</p>
      <p>{english ? "Original evidence references" : "原授权材料引用"}: {Array.isArray(data.evidenceFileIds) && data.evidenceFileIds.length > 0 && data.evidenceFileIds.every(id => typeof id === "string") ? data.evidenceFileIds.join(", ") : absent}</p>
      <p>{english ? "Only original recorded material is shown. Missing fields are not filled from today's profile or policy. Evidence references do not prove current download availability or merchant verification." : "仅展示原记录材料，缺字段不以当前主档或政策补写；附件引用不证明当前可下载或商户已核验。"}</p>
      <p>{english ? "An approved application is not today's membership, management, rental or payment authority. This read does not resolve any retained original command." : "申请通过不代表当前会员、管理、租赁或付款权限；只读反馈不核销任何原操作键。"}</p>
    </>}
    {row.kind === "join_request" && <><p>{english ? "This is the notice originally acknowledged, not today's policy." : "下方为本人原确认告知，不使用当前政策补写历史。"}</p><p>{text(data.noticeText)}</p><small>{english ? "Department and employee number are proposed information, not authority; approval still verifies the current personal membership and invitation." : "部门/工号仅为申请资料，不授权限；批准时仍核验当前个人会员及原邀请。"}</small></>}
    {row.kind === "administrator_transfer" && <>
      {!transfer && <p role="status">{english ? "The original handoff material is missing or unsupported; this request cannot be accepted. You may explicitly decline it. If an earlier outcome is unconfirmed, read the original operation first." : "原交接材料缺失或不支持，不能接受本条请求。你仍可明确拒绝；已有待核对结果时，先核对原操作。"}</p>}
      <p>{english ? "These are the recorded handoff terms, not current grants or payment authority. Acceptance still rechecks the original terms, both relationships and current authority on the server. Declining does not change administrator rights." : "原请求记录的交接依据不是当前生效权限或企业付款权；接受时服务端仍核验原依据、双方关系与当前授权。拒绝交接不改变管理员权限。"}</p>
    </>}
    {row.decisionReason && <p>{english ? "Original review feedback" : "原处理反馈"}: {row.decisionReason}</p>}
  </section>;
}
