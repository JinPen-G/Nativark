/** Read only the original workflow material. No latest profile/policy fallback or raw payload rendering. */
import type { EnterpriseWorkflowView } from "@rental-os/shared";
export function EnterpriseWorkflowReview({ row, english }: { row: EnterpriseWorkflowView; english: boolean }) {
  const data = row.payload, absent = english ? "Not recorded" : "未记录";
  const text = (value: unknown) => typeof value === "string" && value ? value : absent;
  const time = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(undefined, { timeZoneName: "short" }) : absent;
  const fields: Array<[string, string]> = [
    [english ? "Original request" : "原申请引用", row.id], [english ? "Applicant reference" : "申请人引用", row.applicantCustomerId],
    [english ? "Enterprise reference" : "企业引用", text(row.corporateCustomerId)], [english ? "State" : "原申请状态", row.state],
    [english ? "Request revision" : "申请修订", String(row.revision)], [english ? "Created" : "创建时间", time(row.createdAt)],
  ];
  if (row.kind === "join_request") fields.push(
    [english ? "Requested department" : "申请部门", text(data.department)], [english ? "Requested employee number" : "申请工号", text(data.employeeNo)],
    [english ? "Original notice version" : "原告知版本", text(data.agreementVersion)], [english ? "Acknowledged at" : "本人确认时间", time(data.acknowledgedAt)],
  );
  if (row.kind === "administrator_transfer") fields.push(
    [english ? "Outgoing administrator reference" : "交出方引用", text(data.fromCustomerId)], [english ? "Target relationship reference" : "接收关系引用", text(data.targetMembershipId)],
  );
  return <section className="enterprise-approval-review" aria-label={english ? "Original workflow review" : "原申请审阅"}>
    <dl className="enterprise-review-facts">{fields.map(([label, value]) => <div className="enterprise-review-fact" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {row.kind === "join_request" && <><p>{english ? "This is the notice originally acknowledged, not today's policy." : "下方为本人原确认告知，不使用当前政策补写历史。"}</p><p>{text(data.noticeText)}</p><small>{english ? "Department and employee number are proposed information, not authority; approval still verifies the current personal membership and invitation." : "部门/工号仅为申请资料，不授权限；批准时仍核验当前个人会员及原邀请。"}</small></>}
    {row.kind === "administrator_transfer" && <p>{english ? "Acceptance rechecks both relationships and current authority. Declining does not change administrator rights." : "接受交接仍核验双方关系与当前授权；拒绝交接不改变管理员权限。"}</p>}
    {row.decisionReason && <p>{english ? "Original review feedback" : "原处理反馈"}: {row.decisionReason}</p>}
  </section>;
}
