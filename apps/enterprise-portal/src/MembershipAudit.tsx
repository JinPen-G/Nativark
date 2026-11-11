/** Corporate membership audit is an explicit current action, separate from own
 * receipts. Historical role/actions are read-only results, never today's grants. */
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { enterpriseMembershipAuditSnapshot, type EnterpriseMembershipAudit } from "@rental-os/shared";
import { ActionButton, Alert, Table } from "@/components/ui/customer-entry";
import { useEnterprise } from "./enterprise-session";
export function EnterpriseMembershipAuditRecords({ english }: { english: boolean }) {
  const context = useEnterprise(), owner = useRef(context); owner.current = context;
  const identity = context.identity, tenantCode = context.tenantCode;
  const corporateId = context.selectedCorporateId, corporate = context.entry?.corporates.find(row => row.corporateCustomerId === corporateId);
  const permitted = Boolean(context.session?.customer.customerType === "personal" && corporate?.actions.includes("audit:read") && !context.loading && !context.signal.aborted);
  const revision = corporate?.permissionRevision, workspaceCode = context.session?.workspace?.workspaceCode;
  const readAuthority = corporate?.actions.filter(action => ["audit:read", "orders:read", "finance:read"].includes(action)).join("|");
  const pageScope = JSON.stringify([identity, tenantCode, corporateId, revision, workspaceCode, readAuthority]);
  const [readerPage, setReaderPage] = useState<{ scope: string; cursor?: string }>({ scope: "" });
  const readerCursor = readerPage.scope === pageScope ? readerPage.cursor : undefined;
  const assertCurrent = () => {
    const current = owner.current, selected = current.entry?.corporates.find(row => row.corporateCustomerId === current.selectedCorporateId);
    if (!permitted || current.identity !== identity || current.tenantCode !== tenantCode || current.selectedCorporateId !== corporateId || current.loading || current.signal.aborted
      || current.session?.workspace?.workspaceCode !== workspaceCode || !selected?.actions.includes("audit:read") || selected.permissionRevision !== revision
      || selected.actions.filter(action => ["audit:read", "orders:read", "finance:read"].includes(action)).join("|") !== readAuthority) throw new Error(english ? "Current audit authority changed" : "当前审计授权已变化");
  };
  const query = useQuery({ queryKey: ["enterprise-membership-audit", identity, corporateId, revision, workspaceCode, readAuthority, readerCursor], enabled: permitted,
    queryFn: async ({ signal }) => {
      assertCurrent();
      const path = `/enterprise/corporates/${encodeURIComponent(corporateId)}/membership-audit${readerCursor ? `?readerCursor=${encodeURIComponent(readerCursor)}` : ""}`;
      const value = enterpriseMembershipAuditSnapshot(await context.read<EnterpriseMembershipAudit>(path, AbortSignal.any([context.signal,signal])), tenantCode, corporateId, workspaceCode);
      assertCurrent();
      if (!value || value.permissionRevision !== revision) throw new Error(english ? "Original membership audit unavailable" : "原成员管理审计不可核对");
      return { identity, corporateId, revision, workspaceCode, readAuthority, readerCursor, value };
    } });
  const refresh = async () => { assertCurrent(); await query.refetch({ throwOnError: true }); };
  const visible = permitted && !query.isFetching && !query.error && query.data?.identity === identity && query.data.corporateId === corporateId
    && query.data.revision === revision && query.data.workspaceCode === workspaceCode && query.data.readAuthority === readAuthority
    && query.data.readerCursor === readerCursor ? query.data.value : undefined;
  const latestReaderPage = async () => { assertCurrent(); setReaderPage({ scope: pageScope }); };
  const nextReaderPage = async () => {
    assertCurrent();
    if (!visible?.readerAudit?.nextCursor) throw new Error(english ? "Read the current audit page first" : "请先读取当前审计页");
    setReaderPage({ scope: pageScope, cursor: visible.readerAudit.nextCursor });
  };
  const action = (value: string) => value === "administrator.change" ? english ? "Administrator authority changed" : "管理员授权变更" : value === "member.exit" ? english ? "Own relationship exit" : "本人关系退出" : english ? "Member relationship changed" : "成员关系变更";
  const readerGroupLabels = {
    enterprise_paid: english ? "Enterprise-paid" : "企业承担",
    personal_benefit: english ? "Personal payment" : "优惠自费",
    finance: english ? "Enterprise finance" : "企业财务"
  };
  return <section aria-label={english ? "Corporate membership audit" : "企业成员管理审计"}>
    <h3>{english ? "Corporate membership audit" : "企业成员管理审计"}</h3>
    <Alert type="info" title={english ? "Curated original management receipts" : "限定范围的原管理收据"}
      description={english ? "Current audit authority controls the original management receipts. Order and financial read metadata also requires the corresponding current read permission. Each section states its captured scope and remaining history." : "按当前审计权读取原管理收据。订单和财务读取元数据另需对应的当前读取权，各分组标明已捕获范围及历史缺口。"}/>
    {!permitted ? <Alert type="warning" title={english ? "Select an enterprise with current audit permission" : "请选择当前有审计授权的企业"}/> : <>
      <ActionButton intent="refresh" label={english ? "Read membership audit again" : "重新读取成员管理审计"} disabled={query.isFetching} onAction={refresh}/>
      {query.error && <Alert type="error" title={english ? "Original membership audit could not be verified" : "原成员管理审计未核对成功"}/>}
      {query.isFetching && <p role="status">{english ? "Reading original command receipts" : "正在读取原操作收据"}</p>}
      {visible && <><p>{context.tenantCode} / {visible.corporateCustomerId} / {visible.permissionRevision}</p>
        {visible.readerAudit === undefined ? <Alert type="warning" title={english ? "Original reader metadata unavailable" : "原读取审计元数据不可用"}/> : <>
          <h4>{english ? "Order and financial read records" : "订单与财务读取记录"}</h4>
          <p>{english ? "Recorded authorization, original references and projection hashes before delivery. Earlier uncaptured history remains unavailable." : "记录交付前的授权、原引用与投影哈希，更早未捕获的历史保持不可用。"}</p>
          <div className="enterprise-actions">
            <ActionButton intent="refresh" label={english ? "Latest read records" : "最新读取记录"} disabled={query.isFetching || !readerCursor} onAction={latestReaderPage}/>
            <ActionButton intent="refresh" label={english ? "Next read records" : "下一页读取记录"} disabled={query.isFetching || !visible.readerAudit.nextCursor} onAction={nextReaderPage}/>
          </div>
          {visible.readerAudit.items.length === 0 && <p>{english ? "No captured read records in the current authorized scope." : "当前受权范围暂无已捕获的读取记录。"}</p>}
          <Table rowKey="receiptId" dataSource={visible.readerAudit.items} pagination={false} sorting={false} columns={[
            { title: english ? "Original time (UTC)" : "原时间（UTC）", dataIndex: "createdAt" },
            { title: english ? "Actor reference" : "操作者引用", dataIndex: "actorCustomerId" },
            { title: english ? "Action" : "动作", dataIndex: "action" },
            { title: english ? "Original object" : "原对象", dataIndex: "objectId" },
            { title: english ? "Responsibility group" : "责任分组", render: (_, row) => readerGroupLabels[row.group ?? "finance"] },
            { title: english ? "Prepared items" : "准备条数", dataIndex: "itemCount" },
            { title: english ? "Authority revision" : "授权修订", dataIndex: "permissionRevision" },
            { title: english ? "Projection hash" : "投影哈希", dataIndex: "projectionHash" },
            { title: english ? "Original audit receipt" : "原审计收据", dataIndex: "receiptId" }
          ]}/>
        </>}
        {visible.items.length === 0 && <p>{english ? "No original member/admin receipts in this scope; not a complete audit history." : "本范围未读到原成员/管理员收据，不代表完整审计历史为空。"}</p>}
        <Table rowKey="operationKey" dataSource={visible.items} pagination={false} sorting={false} onRefresh={refresh} columns={[
          { title: english ? "Original time (UTC)" : "原时间（UTC）", dataIndex: "createdAt" },
          { title: english ? "Original actor reference" : "原操作者引用", dataIndex: "actorCustomerId" },
          { title: english ? "Original relationship" : "原关系", dataIndex: "membershipId" },
          { title: english ? "Action" : "动作", render: (_, row) => action(row.action) },
          { title: english ? "Reason" : "原原因", dataIndex: "reason" },
          { title: english ? "Recorded original result" : "原收据结果", render: (_, row) => JSON.stringify(row.result) },
          { title: english ? "Original receipt key" : "原收据键", dataIndex: "operationKey" }
        ]}/>
        {visible.merchantPortalItems===undefined ? <Alert type="warning" title={english ? "Original merchant portal configuration metadata unavailable" : "原商户企业门户配置元数据不可用"}/> : <>
          <h4>{english ? "Original merchant portal configurations" : "原商户企业门户配置收据"}</h4>
          <Alert type="info" title={english ? "Original activation metadata, not current access or grants" : "原开关元数据，不是当前准入或授权"} description={english ? "Only the original company binding, enabled value and revision from bare-actor portal receipts. Tenant-wide configuration, grants, private logs and current activation are not included. Ambiguous reserved tenant targets remain unavailable. No activation, regrant or K/C recovery runs here." : "只读原裸商户账号收据的企业关联、开关值和修订；不含租户整体配置、授权清单、内部日志或今天开关。与tenant保留目标重名的历史不可用。这里不启停、不重授权限或恢复K/C。"}/>
          {visible.merchantPortalItems.length===0 && <p>{english ? "No matching original portal configurations; not complete history." : "本范围未读到原门户配置，不代表完整历史为空。"}</p>}
          <Table rowKey="operationKey" dataSource={visible.merchantPortalItems} sorting={false} pagination={false} columns={[
            {title:english ? "Original time (UTC)" : "原时间（UTC）",dataIndex:"createdAt"},{title:english ? "Original merchant actor reference" : "原商户操作者引用",render:(_,r)=>r.actor.id},
            {title:english ? "Original configuration reason" : "原配置原因",dataIndex:"reason"},{title:english ? "Original portal result (not current access)" : "原门户结果（非当前准入）",render:(_,r)=>JSON.stringify(r.result)},{title:english ? "Original receipt key" : "原收据键",dataIndex:"operationKey"}
          ]}/>
        </>}
        {visible.merchantPolicyItems===undefined ? <Alert type="warning" title={english ? "Original merchant-policy save metadata unavailable" : "商户政策原保存元数据不可用"}/> : <>
          <h4>{english ? "Original merchant policy saves" : "原商户政策保存收据"}</h4>
          <Alert type="info" title={english ? "Historical configuration metadata, not current rental authority" : "历史配置元数据，非当前租赁权"} description={english ? "Only original merchant scope/revision and configuration receipts. Policy bodies, limits and internal security logs are not included; current policies still govern new rentals. No policy change or K/C recovery runs here." : "仅原 merchant 作用域/修订与配置收据，不含政策正文、额度或内部安全日志；新租赁仍核当前政策。这里不执行配置变更或恢复 K/C。"}/>
          {visible.merchantPolicyItems.length===0 && <p>{english ? "No matching original merchant saves; not complete history." : "本范围未读到原商户保存收据，不代表完整历史为空。"}</p>}
          <Table rowKey="operationKey" dataSource={visible.merchantPolicyItems} sorting={false} pagination={false} columns={[
            {title:english ? "Original time (UTC)" : "原时间（UTC）",dataIndex:"createdAt"},{title:english ? "Original merchant actor reference" : "原商户操作者引用",render:(_,r)=>r.actor.id},{title:english ? "Original scope" : "原作用域",dataIndex:"scopeKey"},
            {title:english ? "Original configuration reason" : "原配置原因",dataIndex:"reason"},{title:english ? "Original revision metadata" : "原修订元数据",render:(_,r)=>JSON.stringify(r.result)},{title:english ? "Original receipt key" : "原收据键",dataIndex:"operationKey"}
          ]}/>
        </>}
        {visible.applicationApprovalItems===undefined ? <Alert type="warning" title={english ? "Original application/company approval audit unavailable" : "原企业申请批准关联审计不可用"}/> : <>
          <h4>{english ? "Original application approvals bound to this enterprise" : "原申请批准与本企业关联收据"}</h4>
          <Alert type="info" title={english ? "Historical approved company binding, not current authority" : "原批准企业关联，非今天权限"} description={english ? "Only original approved results with the original request/company association. Applicant, representative and proof material, unassociated refusals and internal merchant logs are not included. Nothing is approved or K/C recovered here." : "仅原批准结果及原申请/企业关联，不含申请人/代表/证明材料、无企业关联的拒绝或商户内部日志。这里不执行批准、开通或恢复K/C。"}/>
          {visible.applicationApprovalItems.length===0 && <p>{english ? "No original approval bindings in this scope; not complete history." : "本范围未读到原批准关联，不代表完整历史为空。"}</p>}
          <Table rowKey="operationKey" dataSource={visible.applicationApprovalItems} sorting={false} pagination={false} columns={[
            {title:english ? "Original time (UTC)" : "原时间（UTC）",dataIndex:"createdAt"},{title:english ? "Original merchant actor reference" : "原商户操作者引用",render:(_,r)=>r.actor.id},{title:english ? "Original application" : "原申请",dataIndex:"objectId"},
            {title:english ? "Public review reason" : "原公开审核原因",dataIndex:"reason"},{title:english ? "Original result, not current authority" : "原结果，非今天权限",render:(_,r)=>JSON.stringify(r.result)},{title:english ? "Original receipt key" : "原收据键",dataIndex:"operationKey"}
          ]}/>
        </>}
        {visible.policyItems===undefined ? <Alert type="warning" title={english ? "Original customer policy-command metadata unavailable" : "客户政策原保存收据元数据不可用"}/> : <>
          <h4>{english ? "Original company and employee policy saves" : "原企业与员工政策保存收据"}</h4>
          <Alert type="info" title={english ? "Scope/revision metadata only, not current policy or authority" : "仅原作用域/修订元数据，非当前政策或权限"} description={english ? "The original bound employee revision is not today's relation. Policy bodies and limits are not included. Original merchant saves have a separate metadata section; remaining management audit is not covered. No K/C recovery or policy change runs here." : "原员工绑定修订不是今天关系。这里不含政策正文/额度，原商户保存另列元数据；其他管理审计仍未接齐，不执行政策变更或恢复K/C。"}/>
          {visible.policyItems.length===0 && <p>{english ? "No matching original metadata in this scope; not complete history." : "本范围未读到对应原元数据，不代表完整历史为空。"}</p>}
          <Table rowKey="operationKey" dataSource={visible.policyItems} sorting={false} pagination={false} columns={[
            {title:english ? "Original time (UTC)" : "原时间（UTC）",dataIndex:"createdAt"},{title:english ? "Original actor reference" : "原操作者引用",dataIndex:"actorCustomerId"},{title:english ? "Original scope" : "原作用域",dataIndex:"scopeKey"},
            {title:english ? "Reason" : "原原因",dataIndex:"reason"},{title:english ? "Original revision metadata" : "原修订元数据",render:(_,r)=>JSON.stringify(r.result)},{title:english ? "Original receipt key" : "原收据键",dataIndex:"operationKey"}
          ]}/>
        </>}
        {visible.joiningItems === undefined ? <Alert type="warning" title={english ? "Original associated join-request audit unavailable" : "有原申请关联的加入审计来源不可用"}/> : <>
          <h4>{english ? "Original associated join-request receipts" : "原加入申请关联收据"}</h4>
          <Alert type="info" title={english ? "Original request outcomes only" : "仅原加入申请结果"} description={english ? "Admission refusals or already-member outcomes without an original request association are not covered. Original approvals do not grant today's membership or authority; other management audit types remain unconnected." : "无原申请关联的准入拒绝或已是成员结果不在此范围内；原通过不授今天成员或管理权，其他管理审计类别仍未接齐。"}/>
          {visible.joiningItems.length===0 && <p>{english ? "No associated join receipts in this scope; not complete history." : "本范围未读到关联加入收据，不代表完整历史为空。"}</p>}
          <Table rowKey="operationKey" dataSource={visible.joiningItems} sorting={false} pagination={false} columns={[
            {title:english ? "Original time (UTC)" : "原时间（UTC）",dataIndex:"createdAt"},{title:english ? "Original actor reference" : "原操作者引用",dataIndex:"actorCustomerId"},
            {title:english ? "Original request" : "原申请",dataIndex:"objectId"},{title:english ? "Original action" : "原动作",dataIndex:"action"},{title:english ? "Reason" : "原原因",dataIndex:"reason"},
            {title:english ? "Historical outcome, not current authority" : "历史结果，非当前权限",render:(_,r)=>JSON.stringify(r.result)},{title:english ? "Original receipt key" : "原收据键",dataIndex:"operationKey"}
          ]}/>
        </>}
        {visible.workflowItems === undefined ? <Alert type="warning" title={english ? "Original invitation/transfer audit source unavailable" : "邀请及交接原审计来源不可用"}/> : <>
          <h4>{english ? "Original invitation and administrator-transfer receipts" : "原邀请及管理员交接收据"}</h4>
          {visible.workflowItems.length === 0 && <p>{english ? "No matching original receipts in this scope; no current outcome is inferred." : "本范围未读到对应原收据，不从今日状态推断历史结果。"}</p>}
          <Table rowKey="operationKey" dataSource={visible.workflowItems} sorting={false} pagination={false} columns={[
            {title:english ? "Original time (UTC)" : "原时间（UTC）",dataIndex:"createdAt"},
            {title:english ? "Original actor reference" : "原操作者引用",dataIndex:"actorCustomerId"},
            {title:english ? "Original object" : "原对象",dataIndex:"objectId"},
            {title:english ? "Original action" : "原动作",dataIndex:"action"},
            {title:english ? "Reason" : "原原因",dataIndex:"reason"},
            {title:english ? "Recorded original result" : "原收据结果",render:(_,row)=>JSON.stringify(row.result)},
            {title:english ? "Original receipt key" : "原收据键",dataIndex:"operationKey"}
          ]}/>
        </>}
        {visible.businessItems === undefined ? <Alert type="warning" title={english ? "Original management/booking audit source unavailable" : "资料申请及预约批准原审计来源不可用"}/> : <>
          <h4>{english ? "Original management and booking-approval receipts" : "原资料申请与预约批准收据"}</h4>
          {visible.bookingWorkspace?.state === "available" ? <p>{english ? "Booking approval coverage: current service only" : "预约批准范围：仅当前认证服务"} / {visible.bookingWorkspace.code}</p> : <Alert type="warning" title={english ? "Booking audit unavailable without a current service" : "无当前认证服务，预约批准审计不可用"}/>}
          {visible.businessItems.length === 0 && <p>{english ? "No matching original receipts in the stated scope; not a complete business history." : "声明范围内未读到对应原收据，不代表完整业务历史为空。"}</p>}
          <Table rowKey="operationKey" dataSource={visible.businessItems} sorting={false} pagination={false} columns={[
            {title:english ? "Original time (UTC)" : "原时间（UTC）",dataIndex:"createdAt"},
            {title:english ? "Original actor" : "原操作者",render:(_,row)=>`${row.actor.kind === "operator" ? english ? "Merchant operator" : "商户操作员" : english ? "Customer" : "客户"} / ${row.actor.id}`},
            {title:english ? "Original object" : "原对象",dataIndex:"objectId"},
            {title:english ? "Original action" : "原动作",dataIndex:"action"},
            {title:english ? "Reason" : "原原因",dataIndex:"reason"},
            {title:english ? "Recorded receipt (not business execution proof)" : "原收据（非业务执行证明）",render:(_,row)=>JSON.stringify(row.result)},
            {title:english ? "Original receipt key" : "原收据键",dataIndex:"operationKey"}
          ]}/>
        </>}
        {visible.expenseItems === undefined || visible.bookingWorkspace?.state !== "available" ? <Alert type="warning" title={english ? "Original extension/exchange audit source unavailable" : "续租及换货批准原审计来源不可用"}/> : <>
          <h4>{english ? "Original extension and exchange-approval receipts" : "原续租及换货批准收据"}</h4>
          <Alert type="info" title={english ? "Associated approval receipts in the current service only" : "仅当前认证服务中有原批准关联的收据"} description={english ? "Expense consent is not inspection or exchange execution. Closed seals are not cancellation or refund. Request seals without an original corporate association are not covered; no original K/C is resolved here." : "费用同意不是检查同意或实物换货；原封键/关闭不是取消或退款。无原企业批准关联的申请封键未覆盖，这里不解除任何原K/C。"}/>
          {visible.expenseItems.length === 0 && <p>{english ? "No associated original expense receipts in this scope; not a complete history." : "本范围未读到有原关联的支出批准收据，不代表完整历史为空。"}</p>}
          <Table rowKey="operationKey" dataSource={visible.expenseItems} pagination={false} sorting={false} columns={[
            {title:english ? "Original time (UTC)" : "原时间（UTC）",dataIndex:"createdAt"},
            {title:english ? "Original actor reference" : "原操作者引用",dataIndex:"actorCustomerId"},
            {title:english ? "Original approval" : "原批准",dataIndex:"objectId"},
            {title:english ? "Original action" : "原动作",dataIndex:"action"},
            {title:english ? "Reason" : "原原因",dataIndex:"reason"},
            {title:english ? "Recorded original result" : "原收据结果",render:(_,row)=>JSON.stringify(row.result)},
            {title:english ? "Original receipt key" : "原收据键",dataIndex:"operationKey"}
          ]}/>
        </>}
      </>}
    </>}
  </section>;
}
