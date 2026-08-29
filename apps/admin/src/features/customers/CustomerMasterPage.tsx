import { HistoryOutlined, IdcardOutlined, MergeCellsOutlined, SafetyCertificateOutlined, StopOutlined } from "@ant-design/icons";
import type {
  CustomerCorporateContract,
  CustomerCorporateInvoiceProfile,
  CustomerDuplicateCandidate,
  CustomerMembershipStatus,
  CustomerMergePreview,
  SaveCustomerContractRequest,
  SaveCustomerCreditRequest,
  SaveCustomerInvoiceProfileRequest,
  SharedCustomerProfile
} from "@store-rental/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Descriptions, Drawer, Form, Input, InputNumber, Select, Space, Table, Tabs, Tag, Timeline, Tooltip, Typography } from "antd";
import { useState } from "react";
import { customerApi } from "@/api/customer";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

/** 六态展示口径（需求 4.8.6）。两态凑不出「为什么不能下单」，因此逐态给出文案。 */
const membershipMeta: Record<CustomerMembershipStatus, { label: string; color: string }> = {
  pending_activation: { label: "待激活", color: "default" },
  active: { label: "正常", color: "success" },
  suspended: { label: "已暂停", color: "warning" },
  risk_restricted: { label: "风险受限", color: "volcano" },
  exited: { label: "已退出", color: "default" },
  closed: { label: "已注销", color: "default" }
};

const accountMeta: Record<string, { label: string; color: string }> = {
  active: { label: "正常", color: "success" },
  suspended: { label: "已停用", color: "warning" },
  closed: { label: "已注销", color: "default" }
};

const scopeLabel: Record<string, string> = { account: "账号级（全租户）", workspace: "空间级（本空间）" };
const actionLabel: Record<string, string> = {
  activate: "激活", suspend: "暂停", restrict: "风险限制", release: "解除限制",
  exit: "退出", close: "注销", reopen: "恢复", merge: "合并"
};

/** 重复判据。掩码相同只是候选，最终由人工核验——这也是需求把合并定为人工动作的原因。 */
const matchedByLabel: Record<string, string> = {
  phone: "手机号完全相同",
  identity: "证件号掩码相同（需人工核验）",
  uscc: "统一社会信用代码相同",
  contact_phone: "已验证联系人手机号相同"
};

const fieldLabel: Record<string, string> = {
  name: "姓名 / 名称",
  phone: "手机号",
  email: "邮箱",
  identityNoMasked: "证件号",
  corporateName: "企业名称",
  corporateTaxNo: "统一社会信用代码"
};

/** 企业资料展示文案。状态一律逐态给文案——「停用/终止/吊销」处理人不同。 */
const invoiceTypeLabel: Record<string, string> = { vat_special: "增值税专用发票", vat_normal: "增值税普通发票" };
const invoiceStatusMeta: Record<string, { label: string; color: string }> = {
  active: { label: "启用", color: "success" },
  disabled: { label: "停用", color: "default" }
};
const contractStatusMeta: Record<string, { label: string; color: string }> = {
  draft: { label: "草稿", color: "default" },
  active: { label: "生效", color: "success" },
  expired: { label: "已到期", color: "warning" },
  terminated: { label: "已终止", color: "volcano" }
};
const creditStatusMeta: Record<string, { label: string; color: string }> = {
  active: { label: "生效", color: "success" },
  suspended: { label: "暂停", color: "warning" },
  revoked: { label: "已吊销", color: "volcano" }
};
const billingCycleLabel: Record<string, string> = {
  monthly: "月结", semi_monthly: "半月结", per_order: "按单结"
};

/** 合并后仍指向被合并方的历史引用。这些**不搬迁**，否则历史凭证与当时事实不一致。 */
const referenceLabel: Record<string, string> = {
  order_customer: "订单客户",
  order_contract_subject: "订单签约主体",
  order_payer_subject: "订单付款主体",
  order_user_subject: "订单使用主体"
};

/** 会员关系摘要。合并预览只如实列出双方各空间的等级与状态，不做任何合成。 */
function membershipText(rows: CustomerMergePreview["sourceMemberships"]) {
  if (!rows.length) return "无";
  return rows
    .map((row) => `${row.workspaceId}：${row.levelName} / ${membershipMeta[row.status]?.label ?? row.status}`)
    .join("；");
}

interface StatusFormValues {
  status: CustomerMembershipStatus | "active" | "suspended" | "closed";
  reason: string;
  levelName?: string;
  acknowledgedManualChecks?: boolean;
}

export function CustomerMasterPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const canManageMember = hasPermission("store-rental:member:manage");
  const canMerge = hasPermission("store-rental:customer:merge");
  const canClose = hasPermission("store-rental:customer:close");
  const canReveal = hasPermission("store-rental:customer:reveal-sensitive");
  /**
   * 企业资料与个人会员分属两套权限（需求 4.8.4）：能改会员等级不等于能改企业授信与账期。
   * manage 是 view 的超集——服务端 GET 接受两者之一，这里保持同一口径，
   * 否则只有 manage 的账号会看不到自己有权编辑的数据。
   */
  const canCorporateManage = hasPermission("store-rental:corporate:manage");
  const canCorporateView = hasPermission("store-rental:corporate:view") || canCorporateManage;

  const [selected, setSelected] = useState<SharedCustomerProfile>();
  const [statusScope, setStatusScope] = useState<"account" | "workspace">();
  const [mergeFor, setMergeFor] = useState<SharedCustomerProfile>();
  const [mergeTarget, setMergeTarget] = useState<string>();
  const [preview, setPreview] = useState<CustomerMergePreview>();
  /** 冲突字段的人工取舍：字段 → "target"（保留方的值）/"source"（被合并方的值）。 */
  const [fieldResolutions, setFieldResolutions] = useState<Record<string, string>>({});
  const [statusForm] = Form.useForm<StatusFormValues>();
  /** 企业资料编辑：kind 决定表单形态，id 为空即新增。授信是单条记录，不带 id。 */
  const [corporateEdit, setCorporateEdit] = useState<{ kind: "invoice" | "contract" | "credit"; id?: string }>();
  const [corporateForm] = Form.useForm<Record<string, unknown>>();
  const [mergeForm] = Form.useForm<{ reason: string; approver?: string }>();

  const customers = useQuery({ queryKey: ["customer-master"], queryFn: customerApi.list });
  const detail = useQuery({
    queryKey: ["customer-detail", selected?.id],
    queryFn: () => customerApi.detail(selected!.id),
    enabled: Boolean(selected)
  });
  const history = useQuery({
    queryKey: ["customer-history", selected?.id],
    queryFn: () => customerApi.statusHistory(selected!.id),
    enabled: Boolean(selected)
  });
  // 敏感访问审计本身是访问画像，只有具备解密权限的账号才拉取——
  // 没有权限时不发请求，避免在审计里留下一条注定 403 的记录。
  //
  // 必须等 detail 落地后再查：读详情这个动作**本身**会写一条访问审计，
  // 两个请求并发时审计列表永远比实际读取少一条，首次打开会显示「暂无数据」，
  // 与本卡片声明的「每次读取都会留痕」直接矛盾。
  const access = useQuery({
    queryKey: ["customer-access", selected?.id],
    queryFn: () => customerApi.sensitiveAccess(selected!.id),
    enabled: Boolean(selected) && canReveal && detail.isSuccess
  });
  const closability = useQuery({
    queryKey: ["customer-closability", selected?.id],
    queryFn: () => customerApi.closability(selected!.id),
    enabled: Boolean(selected) && canClose
  });
  const duplicates = useQuery({
    queryKey: ["customer-duplicates", mergeFor?.id],
    queryFn: () => customerApi.duplicates(mergeFor!.id),
    enabled: Boolean(mergeFor)
  });

  /**
   * 企业资料三查询。两道 enabled 条件都不能省：
   *   - 个人客户根本没有这三类资料，请求只会拿回空数组并制造噪声；
   *   - 无企业查看权限时不发请求。前端隐藏**不能**替代后端鉴权（守卫已按
   *     corporate:view / corporate:manage 判定），但明知会 403 还发一遍，
   *     只会在审计里堆一串注定失败的调用。
   */
  const isCorporate = (detail.data ?? selected)?.customerType === "corporate";
  const corporateEnabled = Boolean(selected) && isCorporate && canCorporateView;
  const invoiceProfiles = useQuery({
    queryKey: ["customer-invoice-profiles", selected?.id],
    queryFn: () => customerApi.invoiceProfiles(selected!.id),
    enabled: corporateEnabled
  });
  const contracts = useQuery({
    queryKey: ["customer-contracts", selected?.id],
    queryFn: () => customerApi.contracts(selected!.id),
    enabled: corporateEnabled
  });
  const credit = useQuery({
    queryKey: ["customer-credit", selected?.id],
    queryFn: () => customerApi.credit(selected!.id),
    enabled: corporateEnabled
  });

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["customer-master"] }),
      queryClient.invalidateQueries({ queryKey: ["customer-detail"] }),
      queryClient.invalidateQueries({ queryKey: ["customer-history"] }),
      queryClient.invalidateQueries({ queryKey: ["customer-closability"] })
    ]);
  };

  /** 企业资料保存后单独刷新这三项；不必连带重拉主档列表与状态历史。 */
  const refreshCorporate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["customer-invoice-profiles"] }),
      queryClient.invalidateQueries({ queryKey: ["customer-contracts"] }),
      queryClient.invalidateQueries({ queryKey: ["customer-credit"] })
    ]);
  };

  const changeStatus = useMutation<unknown, Error, StatusFormValues>({
    mutationFn: (values: StatusFormValues) =>
      statusScope === "account"
        ? customerApi.changeAccountStatus(selected!.id, {
            status: values.status as "active" | "suspended" | "closed",
            reason: values.reason,
            acknowledgedManualChecks: values.acknowledgedManualChecks
          })
        : customerApi.changeMembershipStatus(selected!.id, {
            status: values.status as CustomerMembershipStatus,
            reason: values.reason,
            levelName: values.levelName
          }),
    onSuccess: async () => {
      await refreshAll();
      setStatusScope(undefined);
      statusForm.resetFields();
      message.success("状态已变更，并已记入状态历史");
    },
    onError: (error: Error) => message.error(error.message || "变更失败")
  });

  /**
   * CUSTOMER-01E：开通登录账号。服务端幂等，但页面仍只在「未开通」时给入口——
   * 让已有账号的客户也能点，等于把幂等当成功能，运营会以为自己重置了账号。
   */
  const ensureAccount = useMutation({
    mutationFn: () => customerApi.ensureAccount(selected!.id),
    onSuccess: async () => {
      await refreshAll();
      message.success("登录账号已开通，可以管理账号状态了");
    },
    onError: (error: Error) => message.error(error.message || "开通登录账号失败")
  });

  const saveCorporate = useMutation<unknown, Error, Record<string, unknown>>({
    mutationFn: (values) => {
      const id = selected!.id;
      if (corporateEdit!.kind === "invoice") {
        return customerApi.saveInvoiceProfile(id, { ...values, id: corporateEdit!.id } as SaveCustomerInvoiceProfileRequest);
      }
      if (corporateEdit!.kind === "contract") {
        return customerApi.saveContract(id, { ...values, id: corporateEdit!.id } as SaveCustomerContractRequest);
      }
      return customerApi.saveCredit(id, values as unknown as SaveCustomerCreditRequest);
    },
    onSuccess: async () => {
      await refreshCorporate();
      setCorporateEdit(undefined);
      corporateForm.resetFields();
      message.success("企业资料已保存");
    },
    onError: (error: Error) => message.error(error.message || "保存失败")
  });

  /**
   * 打开编辑抽屉并回填。回填用**服务端返回的值**，脱敏字段保持脱敏、不在前端还原。
   *
   * 日期字段要截成 YYYY-MM-DD：服务端返回的是完整 ISO 串，直接灌进
   * `placeholder="YYYY-MM-DD"` 的输入框会显示成 `2026-01-10T00:00:00.000Z`，
   * 运营看不懂也编辑不动。
   */
  function openCorporateEdit(kind: "invoice" | "contract" | "credit", row?: Record<string, unknown>) {
    setCorporateEdit({ kind, id: row?.id as string | undefined });
    corporateForm.resetFields();
    if (!row) return;
    const values = { ...row };
    for (const field of ["signedAt", "effectiveFrom", "effectiveTo"]) {
      const value = values[field];
      if (typeof value === "string") values[field] = value.slice(0, 10);
    }
    corporateForm.setFieldsValue(values);
  }

  function closeMerge() {
    setMergeFor(undefined);
    setMergeTarget(undefined);
    setPreview(undefined);
    setFieldResolutions({});
    mergeForm.resetFields();
  }

  const merge = useMutation({
    mutationFn: (values: { reason: string; approver?: string }) =>
      customerApi.merge({
        sourceCustomerId: mergeFor!.id,
        targetCustomerId: mergeTarget!,
        reason: values.reason,
        approver: values.approver,
        // 取舍结论原样固化进合并映射，事后才能解释「保留了谁的值、谁决定的」。
        fieldResolutions
      }),
    onSuccess: async () => {
      await refreshAll();
      closeMerge();
      message.success("已合并；订单与历史引用仍指向原主档，各空间权益分别保留");
    },
    onError: (error: Error) => message.error(error.message || "合并失败")
  });

  async function loadPreview(targetCustomerId: string) {
    setMergeTarget(targetCustomerId);
    // 换保留方等于换掉了取舍语境，旧结论必须清掉，不能顺延到新的一对主档上。
    setFieldResolutions({});
    try {
      setPreview(await customerApi.mergePreview(mergeFor!.id, targetCustomerId));
    } catch (error) {
      message.error((error as Error).message || "读取合并预览失败");
      setPreview(undefined);
    }
  }

  const conflictFields = preview?.fieldDiff.filter((row) => row.conflict) ?? [];
  const unresolvedFields = conflictFields.filter((row) => !fieldResolutions[row.field]);
  /** 提交前的最后一道闸。有理由就禁用按钮并把理由显示在 Tooltip 里，而不是提交后再报错。 */
  const mergeBlockReason = !canMerge
    ? "需要「客户合并」权限"
    : !mergeTarget || !preview
      ? "请先选择保留方以加载合并预览"
      : preview.blockers.length
        ? "存在阻断项，必须先处理"
        : unresolvedFields.length
          ? `还有 ${unresolvedFields.length} 个冲突字段未做取舍`
          : undefined;

  const rows = customers.data ?? [];
  const personal = rows.filter((row) => row.customerType === "personal");
  const corporate = rows.filter((row) => row.customerType === "corporate");
  const current = detail.data ?? selected;
  /**
   * 账号摘要只有**详情**接口带；列表行没有这个字段。因此判定必须以详情到位为前提——
   * 否则打开抽屉的那一瞬间会把「还没查到」显示成「未开通」，并给出一个错误的开通入口。
   */
  const account = detail.data?.accountSummary;
  const accountLoaded = Boolean(detail.data);
  const accountProvisioned = Boolean(account?.provisioned);
  /** 未开通就不给状态入口：让人提交完再收 404，等于把契约错误伪装成操作失误。 */
  const accountActionBlockReason = !accountLoaded
    ? "正在读取账号状态"
    : !accountProvisioned
      ? "该客户尚未开通登录账号，请先开通"
      : account?.status === "closed"
        // 注销是不可逆终态。留一个「改状态」入口会让人以为能恢复，
        // 点进去才发现无可选项——不如在入口处就说清楚。
        ? "账号已注销，注销不可逆，无可变更的状态"
        : !canManageMember && !canClose
          ? "需要「会员管理」或「客户注销」权限"
          : undefined;

  const columns = [
    {
      title: "客户",
      render: (_: unknown, row: SharedCustomerProfile) => (
        <>
          <b>{row.name}</b>
          {row.mergedIntoCustomerId && <Tag color="default" style={{ marginLeft: 8 }}>已合并</Tag>}
          <br />
          {/* 展示的是服务端脱敏后的值。页面不做任何反脱敏拼接。 */}
          <span className="muted">{row.phoneMasked}</span>
        </>
      )
    },
    {
      title: "类型",
      render: (_: unknown, row: SharedCustomerProfile) =>
        row.customerType === "corporate"
          ? <Tag color="purple">企业{row.corporateName ? ` · ${row.corporateName}` : ""}</Tag>
          : <Tag color="blue">个人</Tag>
    },
    {
      title: "实名",
      render: (_: unknown, row: SharedCustomerProfile) =>
        row.identityVerified ? <Tag color="success">已实名</Tag> : <Tag>未实名</Tag>
    },
    {
      title: "本空间会员",
      render: (_: unknown, row: SharedCustomerProfile) => {
        // 列表按租户共享（同一客户不必重复注册），但会员关系只带当前会话空间。
        const link = row.workspaceLinks?.[0];
        if (!link) return <span className="muted">未接入本空间</span>;
        const meta = membershipMeta[link.status] ?? { label: link.status, color: "default" };
        return (
          <Space orientation="vertical" size={2}>
            <Tag color={meta.color}>{meta.label}</Tag>
            <span className="muted">{link.levelName}</span>
          </Space>
        );
      }
    },
    {
      title: "操作",
      render: (_: unknown, row: SharedCustomerProfile) => (
        <Space>
          <Button type="link" onClick={() => setSelected(row)}>详情</Button>
          <Tooltip title={canMerge ? undefined : "需要「客户合并」权限"}>
            <Button
              type="link"
              icon={<MergeCellsOutlined />}
              disabled={!canMerge || Boolean(row.mergedIntoCustomerId)}
              onClick={() => { setMergeFor(row); setMergeTarget(undefined); setPreview(undefined); setFieldResolutions({}); }}
            >
              合并
            </Button>
          </Tooltip>
        </Space>
      )
    }
  ];

  /** 开票资料列。银行账号与联系电话只展示服务端给的掩码，不在前端拼回明文。 */
  const invoiceColumns = [
    {
      title: "开票信息",
      render: (_: unknown, row: CustomerCorporateInvoiceProfile) => (
        <Space orientation="vertical" size={0}>
          <span>
            <b>{row.title}</b>
            {row.isDefault && <Tag color="blue" style={{ marginLeft: 6 }}>默认</Tag>}
          </span>
          <span className="muted">{invoiceTypeLabel[row.invoiceType] ?? row.invoiceType} · {row.taxNo}</span>
        </Space>
      )
    },
    {
      title: "银行与联系",
      render: (_: unknown, row: CustomerCorporateInvoiceProfile) => (
        <Space orientation="vertical" size={0}>
          <span className="muted">{row.bankName ?? "-"} {row.bankAccountMasked ?? ""}</span>
          <span className="muted">{row.contactPhoneMasked ?? "-"} {row.receiveEmail ?? ""}</span>
        </Space>
      )
    },
    {
      title: "状态",
      render: (_: unknown, row: CustomerCorporateInvoiceProfile) => {
        const meta = invoiceStatusMeta[row.status] ?? { label: row.status, color: "default" };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      }
    },
    {
      title: "操作",
      render: (_: unknown, row: CustomerCorporateInvoiceProfile) => (
        <Tooltip title={canCorporateManage ? undefined : "需要「企业客户管理」权限"}>
          <Button
            type="link"
            size="small"
            disabled={!canCorporateManage}
            onClick={() => openCorporateEdit("invoice", row as unknown as Record<string, unknown>)}
          >
            编辑
          </Button>
        </Tooltip>
      )
    }
  ];

  /** 合同列。有效期与终止原因必须能看到——「为什么这份合同不能用了」是高频追问。 */
  const contractColumns = [
    {
      title: "合同",
      render: (_: unknown, row: CustomerCorporateContract) => (
        <Space orientation="vertical" size={0}>
          <b>{row.name}</b>
          <span className="muted">{row.contractNo}</span>
        </Space>
      )
    },
    {
      title: "有效期",
      render: (_: unknown, row: CustomerCorporateContract) => (
        <Space orientation="vertical" size={0}>
          <span>{row.effectiveFrom.slice(0, 10)} ~ {row.effectiveTo?.slice(0, 10) ?? "长期"}</span>
          {row.signedAt && <span className="muted">签署于 {row.signedAt.slice(0, 10)}</span>}
        </Space>
      )
    },
    {
      title: "状态",
      render: (_: unknown, row: CustomerCorporateContract) => {
        const meta = contractStatusMeta[row.status] ?? { label: row.status, color: "default" };
        return (
          <Space orientation="vertical" size={0}>
            <Tag color={meta.color}>{meta.label}</Tag>
            {row.terminatedReason && <span className="muted">{row.terminatedReason}</span>}
          </Space>
        );
      }
    },
    {
      title: "合同文件",
      render: (_: unknown, row: CustomerCorporateContract) =>
        row.fileRef ? <span className="muted">{row.fileRef}</span> : <span className="muted">未上传</span>
    },
    {
      title: "操作",
      render: (_: unknown, row: CustomerCorporateContract) => (
        <Tooltip title={canCorporateManage ? undefined : "需要「企业客户管理」权限"}>
          <Button
            type="link"
            size="small"
            disabled={!canCorporateManage}
            onClick={() => openCorporateEdit("contract", row as unknown as Record<string, unknown>)}
          >
            编辑
          </Button>
        </Tooltip>
      )
    }
  ];

  /** 授信摘要。审批人与原因一并展示——额度变更要能追溯到人。 */
  const creditItems = (row: NonNullable<typeof credit.data>) => {
    const meta = creditStatusMeta[row.status] ?? { label: row.status, color: "default" };
    return [
      { key: "limit", label: "授信额度", children: `¥ ${row.creditLimit.toLocaleString("zh-CN")}` },
      { key: "term", label: "账期", children: `${row.settlementTermDays} 天` },
      { key: "cycle", label: "账单周期", children: billingCycleLabel[row.billingCycle] ?? row.billingCycle },
      { key: "status", label: "状态", children: <Tag color={meta.color}>{meta.label}</Tag> },
      {
        key: "approve",
        label: "审批",
        children: row.approvedBy
          ? `${row.approvedBy}${row.approvedAt ? ` · ${row.approvedAt.slice(0, 10)}` : ""}`
          : "-"
      },
      { key: "reason", label: "变更原因", children: row.reason ?? "-" }
    ];
  };

  // 候选列表刻意展示判据与掩码值：运营要先知道「凭什么判定重复」，才能负责地点下合并。
  const dupColumns = [
    {
      title: "候选主档",
      render: (_: unknown, row: CustomerDuplicateCandidate) => (
        <>
          <b>{row.name}</b>
          {row.mergedIntoCustomerId && <Tag style={{ marginLeft: 8 }}>已合并</Tag>}
          <br />
          <span className="muted">{row.phoneMasked} · {row.customerType === "corporate" ? "企业" : "个人"}</span>
        </>
      )
    },
    {
      title: "判定依据",
      render: (_: unknown, row: CustomerDuplicateCandidate) => (
        <Space orientation="vertical" size={0}>
          <span>{matchedByLabel[row.matchedBy] ?? row.matchedBy}</span>
          {row.matchedValueMasked && <span className="muted">{row.matchedValueMasked}</span>}
        </Space>
      )
    },
    {
      title: "创建时间",
      render: (_: unknown, row: CustomerDuplicateCandidate) => row.createdAt.slice(0, 19).replace("T", " ")
    },
    {
      title: "操作",
      render: (_: unknown, row: CustomerDuplicateCandidate) => (
        <Button type="link" disabled={Boolean(row.mergedIntoCustomerId)} onClick={() => loadPreview(row.customerId)}>
          {mergeTarget === row.customerId ? "已选为保留方" : "选为保留方"}
        </Button>
      )
    }
  ];

  return (
    <>
      <PageHeader
        title="客户主档与空间会员"
        description="客户主档与账号在租户内共享；会员关系、等级与状态按经营空间隔离。停用账号阻止登录全部空间，暂停本空间会员只影响本空间。"
      />
      {!canReveal && (
        <Alert
          type="info"
          showIcon
          title="敏感字段已脱敏"
          description="手机号、证件号与税号按「客户敏感资料解密」权限脱敏展示；查看明文需要该权限，且每次访问都会写入访问审计。"
          style={{ marginBottom: 16 }}
        />
      )}
      {!canManageMember && (
        <Alert
          type="info"
          showIcon
          title="当前账号只有查看权限"
          description="暂停、风险限制、解除、退出需要「会员管理」权限；合并与注销分别需要「客户合并」与「客户注销」权限。"
          style={{ marginBottom: 16 }}
        />
      )}
      <QueryState loading={customers.isLoading} error={customers.error}>
        <Card className="tabbed-workspace">
          <Tabs
            className="standalone-tabs"
            items={[
              {
                key: "personal",
                label: `个人客户（${personal.length}）`,
                children: <Table<SharedCustomerProfile> rowKey="id" dataSource={personal} columns={columns} scroll={{ x: 900 }} />
              },
              {
                key: "corporate",
                label: `企业客户（${corporate.length}）`,
                children: <Table<SharedCustomerProfile> rowKey="id" dataSource={corporate} columns={columns} scroll={{ x: 900 }} />
              }
            ]}
          />
        </Card>
      </QueryState>

      <Drawer
        title={current ? `${current.name} · 客户详情` : "客户详情"}
        size={720}
        open={Boolean(selected)}
        destroyOnHidden
        onClose={() => setSelected(undefined)}
        extra={
          <Space>
            {accountLoaded && !accountProvisioned && (
              <Tooltip title={canManageMember ? undefined : "需要「会员管理」权限"}>
                <Button
                  type="primary"
                  icon={<IdcardOutlined />}
                  disabled={!canManageMember}
                  loading={ensureAccount.isPending}
                  onClick={() => ensureAccount.mutate()}
                >
                  开通登录账号
                </Button>
              </Tooltip>
            )}
            <Tooltip title={canManageMember ? undefined : "需要「会员管理」权限"}>
              <Button
                disabled={!canManageMember}
                onClick={() => { setStatusScope("workspace"); statusForm.resetFields(); }}
              >
                本空间会员状态
              </Button>
            </Tooltip>
            <Tooltip title={accountActionBlockReason}>
              <Button
                danger
                icon={<StopOutlined />}
                disabled={Boolean(accountActionBlockReason)}
                onClick={() => { setStatusScope("account"); statusForm.resetFields(); }}
              >
                账号状态 / 注销
              </Button>
            </Tooltip>
          </Space>
        }
      >
        {current && (
          <>
            <Descriptions column={1} size="small" items={[
              { key: "type", label: "客户类型", children: current.customerType === "corporate" ? "企业客户" : "个人客户" },
              { key: "phone", label: "手机号", children: current.phone ?? current.phoneMasked },
              { key: "identity", label: "实名认证", children: current.identityVerified ? `已实名（${current.identityNoMasked ?? "证件已脱敏"}）` : "未实名" },
              {
                key: "account",
                label: "登录账号",
                children: !accountLoaded
                  ? <span className="muted">读取中…</span>
                  : !accountProvisioned
                    // 四态分别给文案（需求要求「未开通」可辨识）：未开通不是一种异常状态，
                    // 而是「还没做这一步」，因此提示的是下一步动作而不是错误。
                    ? <Space><Tag>未开通</Tag><span className="muted">该客户还不能登录任何经营空间</span></Space>
                    : (
                      <Space orientation="vertical" size={0}>
                        <Space>
                          <Tag color={accountMeta[account!.status!]?.color ?? "default"}>
                            {accountMeta[account!.status!]?.label ?? account!.status}
                          </Tag>
                          <span className="muted">{account!.loginPhoneMasked}</span>
                        </Space>
                        {account!.status === "suspended" && account!.suspendedAt && (
                          <span className="muted">停用于 {account!.suspendedAt.slice(0, 19).replace("T", " ")}；全部经营空间均无法登录</span>
                        )}
                        {account!.status === "closed" && (
                          <span className="muted">
                            注销于 {account!.closedAt?.slice(0, 19).replace("T", " ") ?? "—"}；注销为不可逆终态，不提供恢复入口
                          </span>
                        )}
                      </Space>
                    )
              },
              ...(current.customerType === "corporate"
                ? [
                    { key: "corp", label: "企业名称", children: current.corporateName ?? "-" },
                    { key: "tax", label: "统一社会信用代码", children: current.corporateTaxNo ?? "-" }
                  ]
                : []),
              ...(current.mergedIntoCustomerId
                ? [{ key: "merged", label: "合并状态", children: <Tag color="default">已合并进 {current.mergedIntoCustomerId}</Tag> }]
                : [])
            ]} />

            {closability.data && !closability.data.closable && (
              <Alert
                type="warning"
                showIcon
                title="当前不可注销"
                description={`必须先处理：${closability.data.blockers.map((row) => row.message).join("；")}`}
                style={{ marginTop: 12 }}
              />
            )}

            <Card size="small" title="本空间会员关系" style={{ marginTop: 16 }}>
              {current.workspaceLinks?.length
                ? current.workspaceLinks.map((link) => {
                    const meta = membershipMeta[link.status] ?? { label: link.status, color: "default" };
                    return (
                      <Space key={link.id} orientation="vertical" size={2} style={{ display: "flex" }}>
                        <Space>
                          <Tag color={meta.color}>{meta.label}</Tag>
                          <span>{link.levelName}</span>
                        </Space>
                        <span className="muted">
                          {link.suspendedAt ? `暂停于 ${link.suspendedAt}；` : ""}
                          {link.restrictedAt ? `限制于 ${link.restrictedAt}；` : ""}
                          {link.exitedAt ? `退出于 ${link.exitedAt}；` : ""}
                          {link.closedAt ? `注销于 ${link.closedAt}` : ""}
                        </span>
                      </Space>
                    );
                  })
                : <span className="muted">该客户尚未接入本经营空间</span>}
            </Card>
            <Card size="small" title="联系人与经办人" style={{ marginTop: 16 }}>
              {/* 联系人只用于联系；经办人被授权代办业务，因此带授权范围与有效期。
                  两者放在同一张卡里但分行标注，避免运营把联系人当成责任主体。 */}
              {(current.contacts ?? []).length || (current.authorizedAgents ?? []).length ? (
                <Space orientation="vertical" size={4} style={{ display: "flex" }}>
                  {(current.contacts ?? []).map((contact) => (
                    <span key={contact.id}>
                      <Tag>{contact.kind === "emergency" ? "紧急联系人" : contact.kind === "corporate" ? "企业联系人" : "其他联系人"}</Tag>
                      {contact.name} · {contact.phoneMasked}
                      {contact.relation ? ` · ${contact.relation}` : ""}
                      {contact.isPrimary ? <Tag color="blue" style={{ marginLeft: 6 }}>主要</Tag> : null}
                    </span>
                  ))}
                  {(current.authorizedAgents ?? []).map((agent) => (
                    <span key={agent.id}>
                      <Tag color="purple">经办人</Tag>
                      {agent.agentName} · {agent.agentPhoneMasked}
                      <span className="muted">
                        {" "}授权 {agent.validFrom?.slice(0, 10)} ~ {agent.validTo?.slice(0, 10) ?? "长期"}
                        {agent.status !== "active" ? "（已停用）" : ""}
                      </span>
                    </span>
                  ))}
                </Space>
              ) : (
                <span className="muted">尚未登记联系人或经办人</span>
              )}
            </Card>

            {/* 企业资料只对企业客户加载与展示：个人客户没有开票、合同与授信这三类事实。 */}
            {isCorporate && !canCorporateView && (
              <Alert
                type="info"
                showIcon
                title="企业开票、合同与授信需要企业客户权限"
                description="查看需要「企业客户查看」或「企业客户管理」权限，编辑仅限「企业客户管理」。未取得权限时本页不会发起这些请求。"
                style={{ marginTop: 16 }}
              />
            )}
            {isCorporate && canCorporateView && (
              <>
                <Card
                  size="small"
                  title="企业开票资料"
                  style={{ marginTop: 16 }}
                  extra={
                    <Tooltip title={canCorporateManage ? undefined : "需要「企业客户管理」权限"}>
                      <Button size="small" disabled={!canCorporateManage} onClick={() => openCorporateEdit("invoice")}>
                        新增
                      </Button>
                    </Tooltip>
                  }
                >
                  {/* 一家企业可以持有多份开票资料，订单引用的是下单当时的默认/指定那一份，
                      因此这里如实列出全部，并标出哪一份是默认。 */}
                  <QueryState loading={invoiceProfiles.isLoading} error={invoiceProfiles.error}>
                    <Table<CustomerCorporateInvoiceProfile>
                      size="small"
                      rowKey="id"
                      dataSource={invoiceProfiles.data ?? []}
                      pagination={false}
                      locale={{ emptyText: "尚未登记开票资料" }}
                      columns={invoiceColumns}
                    />
                  </QueryState>
                </Card>
                <Card
                  size="small"
                  title="企业合同"
                  style={{ marginTop: 16 }}
                  extra={
                    <Tooltip title={canCorporateManage ? undefined : "需要「企业客户管理」权限"}>
                      <Button size="small" disabled={!canCorporateManage} onClick={() => openCorporateEdit("contract")}>
                        新增
                      </Button>
                    </Tooltip>
                  }
                >
                  <QueryState loading={contracts.isLoading} error={contracts.error}>
                    <Table<CustomerCorporateContract>
                      size="small"
                      rowKey="id"
                      dataSource={contracts.data ?? []}
                      pagination={false}
                      locale={{ emptyText: "尚未登记企业合同" }}
                      columns={contractColumns}
                    />
                  </QueryState>
                </Card>

                <Card
                  size="small"
                  title="授信与账期"
                  style={{ marginTop: 16 }}
                  extra={
                    <Tooltip title={canCorporateManage ? undefined : "需要「企业客户管理」权限"}>
                      <Button
                        size="small"
                        disabled={!canCorporateManage}
                        onClick={() => openCorporateEdit("credit", credit.data as unknown as Record<string, unknown>)}
                      >
                        {credit.data ? "编辑" : "设置"}
                      </Button>
                    </Tooltip>
                  }
                >
                  <QueryState loading={credit.isLoading} error={credit.error}>
                    {credit.data ? (
                      <Descriptions column={1} size="small" items={creditItems(credit.data)} />
                    ) : (
                      <span className="muted">尚未设置授信与账期</span>
                    )}
                  </QueryState>
                  <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                    本阶段授信只维护事实：额度尚未接入报价、支付与订单额度占用。
                    额度占用要与订单、支付、退款联动，缺这层联动就先改金额链路会留下对不上的账。
                  </Typography.Paragraph>
                </Card>
              </>
            )}
            <Card
              size="small"
              title={<Space><HistoryOutlined /><span>状态历史时间线</span></Space>}
              style={{ marginTop: 16 }}
            >
              {/* 账号级与空间级事件在**同一条**时间线上，按时间还原（需求 4.8.14）。
                  解除限制是独立记录，原限制事实不会被删除或回改。 */}
              <QueryState loading={history.isLoading} error={history.error}>
                {history.data?.length ? (
                  <Timeline
                    items={history.data.map((row) => ({
                      color: row.action === "release" || row.action === "activate" ? "green"
                        : row.action === "close" ? "gray" : "red",
                      children: (
                        <>
                          <Space size={6}>
                            <Tag>{scopeLabel[row.scope] ?? row.scope}</Tag>
                            <b>{actionLabel[row.action] ?? row.action}</b>
                            <span className="muted">{row.fromStatus ?? "（无）"} → {row.toStatus}</span>
                          </Space>
                          <br />
                          <span>{row.reason}</span>
                          <br />
                          <span className="muted">
                            {row.at}
                            {row.operator ? ` · 操作人 ${row.operator}` : ""}
                            {row.approver ? ` · 审批 ${row.approver}` : ""}
                          </span>
                        </>
                      )
                    }))}
                  />
                ) : (
                  <span className="muted">暂无状态变更记录</span>
                )}
              </QueryState>
            </Card>

            {canReveal && (
              <Card
                size="small"
                title={<Space><SafetyCertificateOutlined /><span>敏感资料访问审计</span></Space>}
                style={{ marginTop: 16 }}
              >
                <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                  每次读取客户详情都会留痕，含是否解密、操作人与所依据的权限。本审计本身也需解密权限才能查看。
                </Typography.Paragraph>
                <QueryState loading={access.isLoading} error={access.error}>
                  <Table
                    size="small"
                    rowKey={(row) => `${row.at}:${row.field}:${row.action}`}
                    dataSource={access.data ?? []}
                    pagination={{ pageSize: 5 }}
                    columns={[
                      { title: "时间", dataIndex: "at" },
                      { title: "字段", dataIndex: "field" },
                      { title: "动作", dataIndex: "action" },
                      { title: "是否解密", render: (_: unknown, row) => row.revealed ? <Tag color="volcano">明文</Tag> : <Tag>脱敏</Tag> },
                      { title: "操作人", dataIndex: "operator" }
                    ]}
                  />
                </QueryState>
              </Card>
            )}
          </>
        )}
      </Drawer>

      <Drawer
        title={statusScope === "account" ? "账号状态 / 注销" : "本空间会员状态"}
        size={520}
        open={Boolean(statusScope)}
        destroyOnHidden
        onClose={() => setStatusScope(undefined)}
        extra={<Button type="primary" loading={changeStatus.isPending} onClick={() => statusForm.submit()}>提交</Button>}
      >
        <Alert
          type={statusScope === "account" ? "warning" : "info"}
          showIcon
          title={statusScope === "account" ? "账号级变更影响全部经营空间" : "空间级变更只影响本经营空间"}
          description={
            statusScope === "account"
              ? "停用账号会阻止该客户登录全部经营空间，但不删除主档与历史业务事实；注销为不可逆终态，且必须先处理完未完成订单、保证金、风险与授信。"
              : "暂停、风险限制、退出与注销只作用于当前经营空间，不影响客户登录，也不影响其他空间的会员关系。"
          }
          style={{ marginBottom: 16 }}
        />
        {statusScope === "account" && closability.data && !closability.data.closable && (
          <Alert
            type="error"
            showIcon
            title="注销被前置检查阻止"
            description={closability.data.blockers.map((row) => row.message).join("；")}
            style={{ marginBottom: 16 }}
          />
        )}
        {statusScope === "account" && closability.data?.manualConfirmations?.length ? (
          <Alert
            type="warning"
            showIcon
            title="以下项系统无数据源，必须人工核对"
            description={
              <>
                {closability.data.manualConfirmations.map((row) => <div key={row.code}>· {row.message}</div>)}
                <div style={{ marginTop: 6 }}>勾选下方确认后才允许注销——系统不会假装已核对。</div>
              </>
            }
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <Form<StatusFormValues> form={statusForm} layout="vertical" onFinish={(values) => changeStatus.mutate(values)}>
          <Form.Item name="status" label="目标状态" rules={[{ required: true, message: "请选择目标状态" }]}>
            <Select
              options={
                statusScope === "account"
                  ? [
                      { value: "active", label: "正常（恢复登录）" },
                      { value: "suspended", label: "停用（阻止登录全部空间）" },
                      { value: "closed", label: "注销（不可逆终态）" }
                    ]
                  : [
                      { value: "pending_activation", label: "待激活" },
                      { value: "active", label: "正常" },
                      { value: "suspended", label: "已暂停" },
                      { value: "risk_restricted", label: "风险受限" },
                      { value: "exited", label: "已退出" },
                      { value: "closed", label: "已注销（本空间）" }
                    ]
              }
            />
          </Form.Item>
          {statusScope === "workspace" && (
            <Form.Item name="levelName" label="会员等级（仅恢复为正常时可调整）">
              <Input placeholder="留空则保持原等级" />
            </Form.Item>
          )}
          {statusScope === "account" && (
            <Form.Item name="acknowledgedManualChecks" label="人工核对确认" valuePropName="checked">
              <Select
                options={[
                  { value: false, label: "未确认" },
                  { value: true, label: "已人工核对退款、争议与追偿" }
                ]}
              />
            </Form.Item>
          )}
          {/* 原因必填：需求 4.8.6 要求暂停、限制、退出、注销与解除都记录原因与操作人。 */}
          <Form.Item name="reason" label="变更原因" rules={[{ required: true, message: "状态变更必须填写原因" }]}>
            <Input.TextArea rows={3} maxLength={500} showCount placeholder="例如：客户逾期未归还，暂停本空间下单权限" />
          </Form.Item>
        </Form>
      </Drawer>

      <Drawer
        title="人工合并重复客户"
        size={860}
        open={Boolean(mergeFor)}
        destroyOnHidden
        onClose={closeMerge}
        extra={
          <Tooltip title={mergeBlockReason}>
            <Button
              type="primary"
              danger
              loading={merge.isPending}
              disabled={Boolean(mergeBlockReason)}
              onClick={() => mergeForm.submit()}
            >
              确认合并
            </Button>
          </Tooltip>
        }
      >
        <Alert
          type="warning"
          showIcon
          title="合并不可逆，且刻意不做三件事"
          description="不搬迁订单与历史引用（合并后仍指向被合并方）；不合并各空间等级、积分与优惠券；不删除被合并方主档。合并后被合并方无法开展新业务，其登录账号会被关闭。"
          style={{ marginBottom: 16 }}
        />
        {mergeFor && (
          <Descriptions column={1} size="small" style={{ marginBottom: 16 }} items={[
            {
              key: "source",
              label: "被合并方（将被标记为已合并）",
              children: <Space><b>{mergeFor.name}</b><span className="muted">{mergeFor.phoneMasked}</span></Space>
            },
            {
              key: "target",
              label: "保留方（今后下单用它）",
              children: mergeTarget
                ? <b>{duplicates.data?.find((row) => row.customerId === mergeTarget)?.name ?? mergeTarget}</b>
                : <span className="muted">请在下方候选中选择</span>
            }
          ]} />
        )}
        <Card size="small" title="可能重复的主档（仅同租户内；跨租户不是重复）">
          <QueryState loading={duplicates.isLoading} error={duplicates.error}>
            <Table<CustomerDuplicateCandidate>
              size="small"
              rowKey="customerId"
              dataSource={duplicates.data ?? []}
              columns={dupColumns}
              pagination={false}
              locale={{ emptyText: "未发现可能重复的主档" }}
            />
          </QueryState>
        </Card>
        {preview && (
          <>
            {preview.blockers.length > 0 && (
              <Alert
                type="error"
                showIcon
                title="不允许合并"
                description={preview.blockers.map((row) => row.message).join("；")}
                style={{ marginTop: 16 }}
              />
            )}
            <Card size="small" title="字段差异与人工取舍" style={{ marginTop: 16 }}>
              {/* 一边为空是补全，不算冲突；只有两边都有值且不同才需要人工决定保留谁。 */}
              <Table
                size="small"
                rowKey="field"
                dataSource={preview.fieldDiff}
                pagination={false}
                columns={[
                  { title: "字段", render: (_: unknown, row) => fieldLabel[row.field] ?? row.field },
                  { title: "被合并方", render: (_: unknown, row) => row.sourceValue ?? <span className="muted">（空）</span> },
                  { title: "保留方", render: (_: unknown, row) => row.targetValue ?? <span className="muted">（空）</span> },
                  {
                    title: "保留哪一方的值",
                    render: (_: unknown, row) =>
                      row.conflict ? (
                        <Select
                          size="small"
                          style={{ width: 150 }}
                          placeholder="必须选择"
                          status={fieldResolutions[row.field] ? undefined : "error"}
                          value={fieldResolutions[row.field]}
                          onChange={(value: string) =>
                            setFieldResolutions((prev) => ({ ...prev, [row.field]: value }))
                          }
                          options={[
                            { value: "target", label: "保留方的值" },
                            { value: "source", label: "被合并方的值" }
                          ]}
                        />
                      ) : (
                        <span className="muted">无冲突</span>
                      )
                  }
                ]}
              />
            </Card>
            <Card size="small" title="双方空间会员关系（各空间权益分别保留）" style={{ marginTop: 16 }}>
              <Descriptions column={1} size="small" items={[
                { key: "src", label: "被合并方", children: membershipText(preview.sourceMemberships) },
                { key: "tgt", label: "保留方", children: membershipText(preview.targetMemberships) },
                {
                  key: "overlap",
                  label: "两边都有会员关系的空间",
                  children: preview.overlappingWorkspaceIds.length ? (
                    <Space orientation="vertical" size={0}>
                      <span>{preview.overlappingWorkspaceIds.join("、")}</span>
                      <span className="muted">这些空间需人工决定保留哪一份等级；系统不会自动合并等级、积分或优惠券。</span>
                    </Space>
                  ) : "无重叠"
                }
              ]} />
            </Card>
            <Card size="small" title="合并后仍指向被合并方的历史引用" style={{ marginTop: 16 }}>
              <Space wrap>
                {preview.preservedReferences.map((row) => (
                  <Tag key={row.kind}>{referenceLabel[row.kind] ?? row.kind}：{row.count}</Tag>
                ))}
              </Space>
              <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                这些引用不会被改写。历史凭证必须与当时的事实一致，改写既不可逆也会让对账失真。
              </Typography.Paragraph>
            </Card>
            <Form
              form={mergeForm}
              layout="vertical"
              style={{ marginTop: 16 }}
              onFinish={(values) => merge.mutate(values)}
            >
              {/* 原因必填、审批人留痕：合并不可逆，事后必须能解释「谁决定的、为什么」。 */}
              <Form.Item name="reason" label="合并原因" rules={[{ required: true, message: "人工合并必须填写原因" }]}>
                <Input.TextArea rows={3} maxLength={500} showCount placeholder="例如：同一客户用两个手机号注册，已电话核实为同一人" />
              </Form.Item>
              <Form.Item name="approver" label="审批人（留痕用，可留空）">
                <Input placeholder="审批本次合并的负责人" />
              </Form.Item>
            </Form>
          </>
        )}
      </Drawer>

      <Drawer
        title={
          corporateEdit?.kind === "invoice" ? (corporateEdit.id ? "编辑开票资料" : "新增开票资料")
            : corporateEdit?.kind === "contract" ? (corporateEdit.id ? "编辑企业合同" : "新增企业合同")
              : "授信与账期"
        }
        size={560}
        open={Boolean(corporateEdit)}
        destroyOnHidden
        onClose={() => { setCorporateEdit(undefined); corporateForm.resetFields(); }}
        extra={
          <Button type="primary" loading={saveCorporate.isPending} onClick={() => corporateForm.submit()}>
            保存
          </Button>
        }
      >
        <Form form={corporateForm} layout="vertical" onFinish={(values) => saveCorporate.mutate(values)}>
          {corporateEdit?.kind === "invoice" && (
            <>
              <Form.Item name="invoiceType" label="发票类型" rules={[{ required: true, message: "请选择发票类型" }]}>
                <Select options={Object.entries(invoiceTypeLabel).map(([value, label]) => ({ value, label }))} />
              </Form.Item>
              <Form.Item name="title" label="开票名称" rules={[{ required: true, message: "开票名称不能为空" }]}>
                <Input placeholder="与营业执照一致的企业全称" />
              </Form.Item>
              <Form.Item name="taxNo" label="开票税号" rules={[{ required: true, message: "开票税号不能为空" }]}>
                <Input />
              </Form.Item>
              <Form.Item name="registeredAddress" label="注册地址"><Input /></Form.Item>
              <Form.Item name="bankName" label="开户银行"><Input /></Form.Item>
              {/* 库里只存脱敏值，页面拿不到明文，也不做还原。因此编辑时必须说清：
                  留空等于清除——否则运营会以为「不动这一栏」就是保留原值。 */}
              <Form.Item
                name="bankAccount"
                label="银行账号"
                extra={
                  corporateEdit.id
                    ? `当前已存脱敏值${invoiceProfiles.data?.find((row) => row.id === corporateEdit.id)?.bankAccountMasked
                        ? `：${invoiceProfiles.data.find((row) => row.id === corporateEdit.id)!.bankAccountMasked}`
                        : "：无"}。需要保留请重新填写完整账号，留空将清除。`
                    : "只保存脱敏值，明文不入库。"
                }
              >
                <Input placeholder="完整银行账号" />
              </Form.Item>
              <Form.Item
                name="contactPhone"
                label="开票联系电话"
                extra={corporateEdit.id ? "同上：只存脱敏值，留空将清除。" : undefined}
              >
                <Input />
              </Form.Item>
              <Form.Item name="receiveEmail" label="收票邮箱"><Input /></Form.Item>
              <Form.Item name="isDefault" label="设为默认开票资料">
                <Select
                  options={[{ value: false, label: "否" }, { value: true, label: "是（原默认将自动降级）" }]}
                />
              </Form.Item>
              <Form.Item name="status" label="状态">
                <Select options={Object.entries(invoiceStatusMeta).map(([value, meta]) => ({ value, label: meta.label }))} />
              </Form.Item>
            </>
          )}
          {corporateEdit?.kind === "contract" && (
            <>
              <Form.Item name="contractNo" label="合同编号" rules={[{ required: true, message: "合同编号不能为空" }]}>
                <Input />
              </Form.Item>
              <Form.Item name="name" label="合同名称" rules={[{ required: true, message: "合同名称不能为空" }]}>
                <Input />
              </Form.Item>
              <Form.Item name="signedAt" label="签署日期"><Input placeholder="YYYY-MM-DD" /></Form.Item>
              {/* 有效期倒挂由服务端拒绝；这里只提示口径，不在前端重复实现判定逻辑。 */}
              <Form.Item name="effectiveFrom" label="生效日期" rules={[{ required: true, message: "生效日期不能为空" }]}>
                <Input placeholder="YYYY-MM-DD" />
              </Form.Item>
              <Form.Item name="effectiveTo" label="到期日期" extra="留空表示长期有效；不得早于生效日期。">
                <Input placeholder="YYYY-MM-DD" />
              </Form.Item>
              <Form.Item name="status" label="状态">
                <Select options={Object.entries(contractStatusMeta).map(([value, meta]) => ({ value, label: meta.label }))} />
              </Form.Item>
              {/* 终止必须给原因（服务端强校验）：「这份合同为什么不能用了」是高频追问。 */}
              <Form.Item
                name="terminatedReason"
                label="终止原因"
                extra="状态选「已终止」时必填。"
                dependencies={["status"]}
                rules={[({ getFieldValue }) => ({
                  required: getFieldValue("status") === "terminated",
                  message: "终止合同必须填写原因"
                })]}
              >
                <Input.TextArea rows={2} maxLength={300} showCount />
              </Form.Item>
              <Form.Item name="fileRef" label="合同文件引用" extra="文件资产 id 或存档路径。">
                <Input />
              </Form.Item>
            </>
          )}
          {corporateEdit?.kind === "credit" && (
            <>
              <Form.Item name="creditLimit" label="授信额度（元）" rules={[{ required: true, message: "授信额度不能为空" }]}>
                <InputNumber min={0} precision={2} style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item name="settlementTermDays" label="账期（天）" rules={[{ required: true, message: "账期不能为空" }]}>
                <InputNumber min={0} precision={0} style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item name="billingCycle" label="账单周期">
                <Select options={Object.entries(billingCycleLabel).map(([value, label]) => ({ value, label }))} />
              </Form.Item>
              <Form.Item name="status" label="状态">
                <Select options={Object.entries(creditStatusMeta).map(([value, meta]) => ({ value, label: meta.label }))} />
              </Form.Item>
              <Form.Item name="reason" label="变更原因" extra="额度与账期变更要能追溯到人和理由。">
                <Input.TextArea rows={3} maxLength={300} showCount />
              </Form.Item>
            </>
          )}
        </Form>
      </Drawer>
    </>
  );
}



