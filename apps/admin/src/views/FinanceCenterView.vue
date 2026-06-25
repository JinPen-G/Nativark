<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import type {
  BillingMode,
  FinanceDocumentRow,
  FinanceManualAdjustmentRow,
  FinanceOverviewMetrics,
  FinancePreAuthorizationRow,
  FinanceReconciliationRow,
  FinanceTransactionRow,
  SaveFinanceDocumentRequest,
  SaveFinanceManualAdjustmentRequest,
  SaveFinancePreAuthorizationRequest
} from "@store-rental/shared";
import {
  createFinanceManualAdjustment,
  getFinanceOverview,
  listFinanceDocuments,
  listFinanceManualAdjustments,
  listFinancePreAuthorizations,
  listFinanceReconciliationRows,
  listFinanceTransactions,
  processFinanceManualAdjustment,
  saveFinanceDocument,
  saveFinancePreAuthorization
} from "../api/client";
import AppLayout from "../components/AppLayout.vue";

const loading = ref(false);
const activeTab = ref("transactions");
const overview = ref<FinanceOverviewMetrics>({
  customerReceivedAmount: 0,
  preAuthFrozenAmount: 0,
  refundAmount: 0,
  monthlyBillingAmount: 0,
  monthlyUnpaidAmount: 0,
  invoiceIssuedAmount: 0,
  pendingAdjustmentAmount: 0,
  exceptionCount: 0
});
const transactions = ref<FinanceTransactionRow[]>([]);
const documents = ref<FinanceDocumentRow[]>([]);
const preAuthorizations = ref<FinancePreAuthorizationRow[]>([]);
const adjustments = ref<FinanceManualAdjustmentRow[]>([]);
const reconciliationRows = ref<FinanceReconciliationRow[]>([]);
const keyword = ref("");
const documentDialogVisible = ref(false);
const documentDialogMode = ref<"create" | "edit" | "reissue">("create");
const documentRelatedFeeIdsText = ref("");
const preAuthDialogVisible = ref(false);
const adjustmentDialogVisible = ref(false);
const saving = ref(false);

const documentForm = reactive<SaveFinanceDocumentRequest>({
  type: "invoice",
  status: "issued",
  orderNo: "",
  customerName: "",
  title: "",
  amount: 0,
  issueSource: "manual",
  relatedFeeIds: [],
  createdBy: "营运财务",
  remark: ""
});
const adjustmentForm = reactive<SaveFinanceManualAdjustmentRequest>({
  orderNo: "",
  customerName: "",
  corporateShortName: "",
  category: "ETC补录",
  direction: "charge",
  targetBillingMode: "customer_pay" as BillingMode,
  amount: 0,
  reason: "",
  operator: "营运财务"
});
const preAuthForm = reactive<SaveFinancePreAuthorizationRequest>({
  status: "frozen",
  channel: "online",
  provider: "mock_payment",
  orderNo: "",
  customerName: "",
  authorizedAmount: 0,
  capturedAmount: 0,
  releasedAmount: 0,
  currency: "CNY",
  paymentMethod: "信用卡预授权",
  operator: "营运财务",
  remark: ""
});

const monthlyReconciliationRows = computed(() =>
  reconciliationRows.value.filter((row) => row.sourceType === "monthly_bill")
);

const documentDialogTitle = computed(() =>
  documentDialogMode.value === "reissue" ? "重开发票 / 收据" : "发票 / 收据"
);

const filteredTransactions = computed(() => {
  const text = keyword.value.trim().toLowerCase();
  if (!text) {
    return transactions.value;
  }
  return transactions.value.filter((row) =>
    [row.orderNo, row.customerName, row.corporateShortName, row.note, row.type]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(text))
  );
});

const filteredDocuments = computed(() => {
  const text = keyword.value.trim().toLowerCase();
  if (!text) {
    return documents.value;
  }
  return documents.value.filter((row) =>
    [
      row.documentNo,
      row.orderNo,
      row.customerName,
      row.title,
      row.corporateShortName,
      row.originalDocumentNo,
      row.replacementDocumentNo,
      ...(row.relatedFeeIds ?? [])
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(text))
  );
});

const filteredPreAuthorizations = computed(() => {
  const text = keyword.value.trim().toLowerCase();
  if (!text) {
    return preAuthorizations.value;
  }
  return preAuthorizations.value.filter((row) =>
    [
      row.preAuthNo,
      row.orderNo,
      row.customerName,
      row.corporateShortName,
      row.authCode,
      row.channelReferenceNo,
      row.provider
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(text))
  );
});

const filteredAdjustments = computed(() => {
  const text = keyword.value.trim().toLowerCase();
  if (!text) {
    return adjustments.value;
  }
  return adjustments.value.filter((row) =>
    [row.adjustmentNo, row.orderNo, row.customerName, row.corporateShortName, row.category]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(text))
  );
});

async function loadData() {
  loading.value = true;
  try {
    const [
      overviewData,
      transactionData,
      documentData,
      preAuthData,
      adjustmentData,
      reconciliationData
    ] = await Promise.all([
      getFinanceOverview(),
      listFinanceTransactions(),
      listFinanceDocuments(),
      listFinancePreAuthorizations(),
      listFinanceManualAdjustments(),
      listFinanceReconciliationRows()
    ]);
    overview.value = overviewData;
    transactions.value = transactionData;
    documents.value = documentData;
    preAuthorizations.value = preAuthData;
    adjustments.value = adjustmentData;
    reconciliationRows.value = reconciliationData;
  } finally {
    loading.value = false;
  }
}

function money(value: number) {
  return `¥${Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  })}`;
}

function transactionTypeLabel(type: FinanceTransactionRow["type"]) {
  const map: Record<FinanceTransactionRow["type"], string> = {
    pre_auth_freeze: "预授权冻结",
    pre_auth_release: "预授权释放",
    pre_auth_capture: "预授权扣款",
    payment: "收款",
    refund: "退款",
    waiver: "减免",
    monthly_bill: "企业月结",
    manual_adjustment: "手工调账"
  };
  return map[type] ?? type;
}

function transactionStatusLabel(status: FinanceTransactionRow["status"]) {
  return {
    pending: "待处理",
    success: "成功",
    failed: "失败"
  }[status];
}

function documentStatusLabel(status: FinanceDocumentRow["status"]) {
  return {
    draft: "草稿",
    issued: "已开具",
    sent: "已发送",
    voided: "已作废"
  }[status];
}

function documentStatusTag(status: FinanceDocumentRow["status"]) {
  return status === "voided" ? "danger" : status === "draft" ? "info" : "success";
}

function normalizeRelatedFeeIds(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\s,，、;；]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function latestDocumentAudit(row: FinanceDocumentRow) {
  const latest = row.auditTrail?.[row.auditTrail.length - 1];
  if (!latest) {
    return "-";
  }
  const actionMap: Record<string, string> = {
    created: "创建",
    updated: "更新",
    issued: "开具",
    sent: "发送",
    voided: "作废",
    reissued: "重开"
  };
  return `${latest.operator || "系统"} · ${actionMap[latest.action] || latest.action}`;
}

function preAuthStatusLabel(status: FinancePreAuthorizationRow["status"]) {
  return {
    pending: "待冻结",
    frozen: "已冻结",
    partially_captured: "部分扣款",
    captured: "已扣款",
    released: "已释放",
    expired: "已过期",
    failed: "失败"
  }[status];
}

function preAuthStatusTag(status: FinancePreAuthorizationRow["status"]) {
  if (status === "failed" || status === "expired") {
    return "danger";
  }
  if (status === "released") {
    return "info";
  }
  if (status === "pending") {
    return "warning";
  }
  return "success";
}

function preAuthChannelLabel(channel: FinancePreAuthorizationRow["channel"]) {
  return {
    online: "线上",
    offline: "线下",
    internal: "内部"
  }[channel];
}

function adjustmentStatusLabel(status: FinanceManualAdjustmentRow["status"]) {
  return {
    pending: "待审核",
    approved: "已审核",
    rejected: "已驳回",
    posted: "已入账"
  }[status];
}

function reconciliationStatusLabel(status: FinanceReconciliationRow["status"]) {
  return {
    matched: "已匹配",
    pending: "待处理",
    exception: "异常"
  }[status];
}

function billingModeLabel(mode?: BillingMode) {
  if (mode === "monthly") {
    return "企业月结";
  }
  if (mode === "customer_pay") {
    return "客户自付";
  }
  return "-";
}

function openDocumentDialog(row?: FinanceDocumentRow) {
  documentDialogMode.value = row ? "edit" : "create";
  documentRelatedFeeIdsText.value = (row?.relatedFeeIds ?? []).join("\n");
  Object.assign(documentForm, {
    id: row?.id,
    documentNo: row?.documentNo,
    type: row?.type ?? "invoice",
    status: row?.status ?? "issued",
    orderId: row?.orderId,
    orderNo: row?.orderNo ?? "",
    memberId: row?.memberId,
    corporateId: row?.corporateId,
    corporateShortName: row?.corporateShortName,
    monthlyBillId: row?.monthlyBillId,
    customerName: row?.customerName ?? "",
    title: row?.title ?? "",
    taxNo: row?.taxNo,
    email: row?.email,
    amount: row?.amount ?? 0,
    issueSource: row?.issueSource ?? "manual",
    relatedFeeIds: row?.relatedFeeIds ?? [],
    originalDocumentId: row?.originalDocumentId,
    originalDocumentNo: row?.originalDocumentNo,
    replacementDocumentId: row?.replacementDocumentId,
    replacementDocumentNo: row?.replacementDocumentNo,
    voidReason: row?.voidReason,
    voidedBy: row?.voidedBy,
    reissuedAt: row?.reissuedAt,
    createdBy: row?.createdBy ?? "营运财务",
    remark: row?.remark ?? "",
    auditTrail: row?.auditTrail ?? []
  });
  documentDialogVisible.value = true;
}

function openReissueDocumentDialog(row: FinanceDocumentRow) {
  documentDialogMode.value = "reissue";
  documentRelatedFeeIdsText.value = (row.relatedFeeIds ?? []).join("\n");
  Object.assign(documentForm, {
    id: undefined,
    documentNo: undefined,
    type: row.type,
    status: "issued",
    orderId: row.orderId,
    orderNo: row.orderNo ?? "",
    memberId: row.memberId,
    corporateId: row.corporateId,
    corporateShortName: row.corporateShortName,
    monthlyBillId: row.monthlyBillId,
    customerName: row.customerName,
    title: row.title,
    taxNo: row.taxNo,
    email: row.email,
    amount: row.amount,
    issueSource: row.issueSource,
    relatedFeeIds: row.relatedFeeIds ?? [],
    originalDocumentId: row.id,
    originalDocumentNo: row.documentNo,
    replacementDocumentId: undefined,
    replacementDocumentNo: undefined,
    voidReason: "",
    voidedBy: row.createdBy ?? "营运财务",
    reissuedAt: undefined,
    createdBy: row.createdBy ?? "营运财务",
    remark: row.remark ? `重开：${row.remark}` : "单据重开",
    auditTrail: []
  });
  documentDialogVisible.value = true;
}

function openPreAuthDialog(row?: FinancePreAuthorizationRow) {
  Object.assign(preAuthForm, {
    id: row?.id,
    preAuthNo: row?.preAuthNo,
    orderId: row?.orderId,
    orderNo: row?.orderNo ?? "",
    memberId: row?.memberId,
    corporateId: row?.corporateId,
    corporateShortName: row?.corporateShortName,
    customerName: row?.customerName ?? "",
    status: row?.status ?? "frozen",
    channel: row?.channel ?? "online",
    provider: row?.provider ?? "mock_payment",
    authorizedAmount: row?.authorizedAmount ?? 0,
    capturedAmount: row?.capturedAmount ?? 0,
    releasedAmount: row?.releasedAmount ?? 0,
    currency: row?.currency ?? "CNY",
    authCode: row?.authCode,
    channelReferenceNo: row?.channelReferenceNo,
    paymentMethod: row?.paymentMethod ?? "信用卡预授权",
    frozenAt: row?.frozenAt,
    capturedAt: row?.capturedAt,
    releasedAt: row?.releasedAt,
    expiresAt: row?.expiresAt,
    operator: row?.operator ?? "营运财务",
    remark: row?.remark ?? ""
  });
  preAuthDialogVisible.value = true;
}

function openAdjustmentDialog() {
  Object.assign(adjustmentForm, {
    orderId: undefined,
    orderNo: "",
    memberId: undefined,
    corporateId: undefined,
    corporateShortName: "",
    customerName: "",
    category: "ETC补录",
    direction: "charge",
    targetBillingMode: "customer_pay",
    amount: 0,
    reason: "",
    operator: "营运财务"
  });
  adjustmentDialogVisible.value = true;
}

async function submitDocument() {
  saving.value = true;
  try {
    await saveFinanceDocument({
      ...documentForm,
      relatedFeeIds: normalizeRelatedFeeIds(documentRelatedFeeIdsText.value),
      voidReason:
        documentForm.status === "voided" || documentDialogMode.value === "reissue"
          ? documentForm.voidReason || documentForm.remark
          : documentForm.voidReason
    });
    ElMessage.success("发票/收据已保存");
    documentDialogVisible.value = false;
    await loadData();
  } finally {
    saving.value = false;
  }
}

async function submitPreAuth() {
  saving.value = true;
  try {
    await saveFinancePreAuthorization(preAuthForm);
    ElMessage.success("预授权台账已保存");
    preAuthDialogVisible.value = false;
    await loadData();
  } finally {
    saving.value = false;
  }
}

async function submitAdjustment() {
  saving.value = true;
  try {
    await createFinanceManualAdjustment(adjustmentForm);
    ElMessage.success("手工调账已提交");
    adjustmentDialogVisible.value = false;
    await loadData();
  } finally {
    saving.value = false;
  }
}

async function processAdjustment(row: FinanceManualAdjustmentRow, action: "approve" | "reject") {
  const title = action === "approve" ? "审核并入账" : "驳回调账";
  const result = await ElMessageBox.prompt(`请输入${title}备注`, title, {
    confirmButtonText: "确认",
    cancelButtonText: "取消"
  });
  await processFinanceManualAdjustment(row.id, {
    action,
    operator: "营运财务",
    remark: result.value
  });
  ElMessage.success(action === "approve" ? "调账已入账" : "调账已驳回");
  await loadData();
}

onMounted(loadData);
</script>

<template>
  <AppLayout>
    <div class="flex justify-between items-end mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-800">财务结算</h1>
        <p class="text-sm text-gray-500 mt-1">管理预授权、收退款、企业月结、发票收据、手工调账和对账异常。</p>
      </div>
      <div class="flex gap-2">
        <el-button @click="loadData">刷新</el-button>
        <el-button type="primary" plain @click="openPreAuthDialog()">登记预授权</el-button>
        <el-button type="primary" plain @click="openDocumentDialog()">开具发票/收据</el-button>
        <el-button type="primary" color="#00689E" @click="openAdjustmentDialog">新增手工调账</el-button>
      </div>
    </div>

    <div class="grid grid-cols-4 gap-4 mb-6">
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">客户实收</div>
        <div class="text-2xl font-bold text-emerald-600 mt-2">{{ money(overview.customerReceivedAmount) }}</div>
      </div>
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">预授权冻结</div>
        <div class="text-2xl font-bold text-amber-600 mt-2">{{ money(overview.preAuthFrozenAmount) }}</div>
      </div>
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">企业月结挂账</div>
        <div class="text-2xl font-bold text-purple-600 mt-2">{{ money(overview.monthlyBillingAmount) }}</div>
      </div>
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">待处理异常</div>
        <div class="text-2xl font-bold text-rose-600 mt-2">{{ overview.exceptionCount }}</div>
      </div>
    </div>

    <div class="grid grid-cols-4 gap-4 mb-6">
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">退款金额</div>
        <div class="text-xl font-bold text-gray-800 mt-2">{{ money(overview.refundAmount) }}</div>
      </div>
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">月结未回款</div>
        <div class="text-xl font-bold text-gray-800 mt-2">{{ money(overview.monthlyUnpaidAmount) }}</div>
      </div>
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">已开票金额</div>
        <div class="text-xl font-bold text-gray-800 mt-2">{{ money(overview.invoiceIssuedAmount) }}</div>
      </div>
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">待审调账</div>
        <div class="text-xl font-bold text-gray-800 mt-2">{{ money(overview.pendingAdjustmentAmount) }}</div>
      </div>
    </div>

    <div class="sr-card p-5">
      <div class="flex items-center justify-between mb-4">
        <el-tabs v-model="activeTab" class="finance-tabs">
          <el-tab-pane label="资金流水" name="transactions" />
          <el-tab-pane label="预授权押金" name="preauth" />
          <el-tab-pane label="企业月结" name="monthly" />
          <el-tab-pane label="发票收据" name="documents" />
          <el-tab-pane label="手工调账" name="adjustments" />
          <el-tab-pane label="财务对账" name="reconciliation" />
        </el-tabs>
        <el-input v-model="keyword" placeholder="订单 / 客户 / 企业 / 单号" clearable style="width: 280px" />
      </div>

      <el-table v-if="activeTab === 'transactions'" v-loading="loading" :data="filteredTransactions" stripe>
        <el-table-column label="资金类型" width="130">
          <template #default="{ row }">
            <el-tag :type="row.type === 'refund' ? 'warning' : row.type === 'monthly_bill' ? 'primary' : 'success'" effect="plain">
              {{ transactionTypeLabel(row.type) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="订单 / 客户" min-width="240">
          <template #default="{ row }">
            <div class="font-semibold text-gray-900">{{ row.orderNo || "-" }}</div>
            <div class="text-xs text-gray-500 mt-1">{{ row.customerName || "-" }} · {{ row.corporateShortName || "个人客户" }}</div>
          </template>
        </el-table-column>
        <el-table-column label="结算口径" width="110">
          <template #default="{ row }">{{ billingModeLabel(row.billingMode) }}</template>
        </el-table-column>
        <el-table-column label="金额" width="120" align="right">
          <template #default="{ row }">{{ money(row.amount) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'success' ? 'success' : row.status === 'failed' ? 'danger' : 'warning'" effect="plain">
              {{ transactionStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="operator" label="处理人" width="120" />
        <el-table-column prop="note" label="备注" min-width="220" />
      </el-table>

      <el-table v-else-if="activeTab === 'preauth'" v-loading="loading" :data="filteredPreAuthorizations" stripe>
        <el-table-column prop="preAuthNo" label="预授权单号" min-width="170" />
        <el-table-column label="订单 / 客户" min-width="240">
          <template #default="{ row }">
            <div class="font-semibold text-gray-900">{{ row.orderNo || "未绑定订单" }}</div>
            <div class="text-xs text-gray-500 mt-1">{{ row.customerName || "-" }} · {{ row.corporateShortName || "个人客户" }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="preAuthStatusTag(row.status)" effect="plain">
              {{ preAuthStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="冻结金额" width="120" align="right">
          <template #default="{ row }">{{ money(row.authorizedAmount) }}</template>
        </el-table-column>
        <el-table-column label="扣款" width="110" align="right">
          <template #default="{ row }">{{ money(row.capturedAmount) }}</template>
        </el-table-column>
        <el-table-column label="释放" width="110" align="right">
          <template #default="{ row }">{{ money(row.releasedAmount) }}</template>
        </el-table-column>
        <el-table-column label="剩余" width="110" align="right">
          <template #default="{ row }">{{ money(row.remainingAmount) }}</template>
        </el-table-column>
        <el-table-column label="渠道 / 凭证" min-width="220">
          <template #default="{ row }">
            <div class="text-gray-900">{{ preAuthChannelLabel(row.channel) }} · {{ row.provider }}</div>
            <div class="text-xs text-gray-500 mt-1">{{ row.authCode || row.channelReferenceNo || row.paymentMethod || "-" }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="operator" label="处理人" width="120" />
        <el-table-column label="操作" width="100" align="right" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openPreAuthDialog(row)">编辑</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-table v-else-if="activeTab === 'monthly'" v-loading="loading" :data="monthlyReconciliationRows" stripe>
        <el-table-column prop="sourceNo" label="账单号" min-width="160" />
        <el-table-column prop="counterparty" label="企业客户" min-width="180" />
        <el-table-column label="未回款金额" width="130" align="right">
          <template #default="{ row }">{{ money(row.amount) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="row.status === 'exception' ? 'danger' : row.status === 'pending' ? 'warning' : 'success'" effect="plain">
              {{ reconciliationStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="issue" label="账单状态" min-width="220" />
        <el-table-column prop="suggestedAction" label="建议动作" min-width="260" />
      </el-table>

      <el-table v-else-if="activeTab === 'documents'" v-loading="loading" :data="filteredDocuments" stripe>
        <el-table-column prop="documentNo" label="单据号" min-width="160" />
        <el-table-column label="类型" width="100">
          <template #default="{ row }">{{ row.type === "invoice" ? "发票" : "收据" }}</template>
        </el-table-column>
        <el-table-column label="抬头 / 客户" min-width="240">
          <template #default="{ row }">
            <div class="font-semibold text-gray-900">{{ row.title }}</div>
            <div class="text-xs text-gray-500 mt-1">{{ row.customerName }} · {{ row.orderNo || "未绑定订单" }}</div>
          </template>
        </el-table-column>
        <el-table-column label="金额" width="120" align="right">
          <template #default="{ row }">{{ money(row.amount) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="documentStatusTag(row.status)" effect="plain">
              {{ documentStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="关联费用 / 重开链路" min-width="260">
          <template #default="{ row }">
            <div class="flex flex-wrap gap-1">
              <el-tag v-for="feeId in row.relatedFeeIds ?? []" :key="feeId" size="small" effect="plain">{{ feeId }}</el-tag>
              <span v-if="!row.relatedFeeIds?.length" class="text-xs text-gray-400">未关联费用</span>
            </div>
            <div v-if="row.originalDocumentNo" class="text-xs text-gray-500 mt-1">
              重开自 {{ row.originalDocumentNo }}
            </div>
            <div v-if="row.replacementDocumentNo" class="text-xs text-gray-500 mt-1">
              已重开为 {{ row.replacementDocumentNo }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="审计" min-width="180">
          <template #default="{ row }">
            <div class="text-sm text-gray-700">{{ latestDocumentAudit(row) }}</div>
            <div v-if="row.voidReason" class="text-xs text-gray-500 mt-1">{{ row.voidReason }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="createdBy" label="开具人" width="120" />
        <el-table-column label="操作" width="150" align="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDocumentDialog(row)">编辑</el-button>
            <el-button
              v-if="row.status !== 'draft' && !row.replacementDocumentId"
              link
              type="warning"
              @click="openReissueDocumentDialog(row)"
            >
              重开
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-table v-else-if="activeTab === 'adjustments'" v-loading="loading" :data="filteredAdjustments" stripe>
        <el-table-column prop="adjustmentNo" label="调账单号" min-width="160" />
        <el-table-column label="订单 / 客户" min-width="240">
          <template #default="{ row }">
            <div class="font-semibold text-gray-900">{{ row.orderNo || "未绑定订单" }}</div>
            <div class="text-xs text-gray-500 mt-1">{{ row.customerName || "-" }} · {{ row.corporateShortName || "个人客户" }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="category" label="类别" width="120" />
        <el-table-column label="方向" width="90">
          <template #default="{ row }">
            {{ row.direction === "charge" ? "补收" : row.direction === "refund" ? "退款" : "减免" }}
          </template>
        </el-table-column>
        <el-table-column label="结算口径" width="110">
          <template #default="{ row }">{{ billingModeLabel(row.targetBillingMode) }}</template>
        </el-table-column>
        <el-table-column label="金额" width="120" align="right">
          <template #default="{ row }">{{ money(row.amount) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="row.status === 'posted' ? 'success' : row.status === 'rejected' ? 'danger' : 'warning'" effect="plain">
              {{ adjustmentStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="原因" min-width="260" />
        <el-table-column label="操作" width="150" align="right" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'pending'" link type="primary" @click="processAdjustment(row, 'approve')">入账</el-button>
            <el-button v-if="row.status === 'pending'" link type="danger" @click="processAdjustment(row, 'reject')">驳回</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-table v-else v-loading="loading" :data="reconciliationRows" stripe>
        <el-table-column prop="sourceNo" label="来源单号" min-width="170" />
        <el-table-column label="来源" width="120">
          <template #default="{ row }">
            {{ row.sourceType === "transaction" ? "资金流水" : row.sourceType === "monthly_bill" ? "企业月结" : "手工调账" }}
          </template>
        </el-table-column>
        <el-table-column prop="counterparty" label="客户/企业" min-width="180" />
        <el-table-column label="金额" width="120" align="right">
          <template #default="{ row }">{{ money(row.amount) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="row.status === 'exception' ? 'danger' : row.status === 'pending' ? 'warning' : 'success'" effect="plain">
              {{ reconciliationStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="issue" label="问题" min-width="240" />
        <el-table-column prop="suggestedAction" label="建议处理" min-width="280" />
      </el-table>
    </div>

    <el-dialog v-model="documentDialogVisible" :title="documentDialogTitle" width="820px">
      <el-form label-position="top">
        <div class="grid grid-cols-12 gap-4">
          <el-form-item label="单据类型" class="col-span-12 md:col-span-3">
            <el-radio-group v-model="documentForm.type">
              <el-radio-button label="invoice">发票</el-radio-button>
              <el-radio-button label="receipt">收据</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="单据状态" class="col-span-12 md:col-span-3">
            <el-select v-model="documentForm.status" class="w-full">
              <el-option label="草稿" value="draft" />
              <el-option label="已开具" value="issued" />
              <el-option label="已发送" value="sent" />
              <el-option label="已作废" value="voided" />
            </el-select>
          </el-form-item>
          <el-form-item label="订单号" class="col-span-12 md:col-span-6">
            <el-input v-model="documentForm.orderNo" placeholder="可选，绑定订单快照" />
          </el-form-item>
          <el-form-item label="关联费用ID" class="col-span-12 md:col-span-6">
            <el-input
              v-model="documentRelatedFeeIdsText"
              type="textarea"
              :rows="2"
              placeholder="多个费用 ID 可用逗号、空格或换行分隔"
            />
          </el-form-item>
          <el-form-item v-if="documentForm.originalDocumentNo" label="重开来源" class="col-span-12 md:col-span-4">
            <el-input v-model="documentForm.originalDocumentNo" disabled />
          </el-form-item>
          <el-form-item
            v-if="documentForm.status === 'voided' || documentForm.originalDocumentNo"
            label="作废/重开原因"
            class="col-span-12 md:col-span-4"
          >
            <el-input v-model="documentForm.voidReason" placeholder="作废、重开或更正说明" />
          </el-form-item>
          <el-form-item
            v-if="documentForm.status === 'voided' || documentForm.originalDocumentNo"
            label="作废处理人"
            class="col-span-12 md:col-span-4"
          >
            <el-input v-model="documentForm.voidedBy" />
          </el-form-item>
          <el-form-item label="客户名称" class="col-span-12 md:col-span-4">
            <el-input v-model="documentForm.customerName" />
          </el-form-item>
          <el-form-item label="发票/收据抬头" class="col-span-12 md:col-span-4">
            <el-input v-model="documentForm.title" />
          </el-form-item>
          <el-form-item label="金额" class="col-span-12 md:col-span-4">
            <el-input-number v-model="documentForm.amount" :min="0" class="w-full" />
          </el-form-item>
          <el-form-item label="税号/统编" class="col-span-12 md:col-span-4">
            <el-input v-model="documentForm.taxNo" />
          </el-form-item>
          <el-form-item label="接收邮箱" class="col-span-12 md:col-span-4">
            <el-input v-model="documentForm.email" />
          </el-form-item>
          <el-form-item label="开具人" class="col-span-12 md:col-span-4">
            <el-input v-model="documentForm.createdBy" />
          </el-form-item>
          <el-form-item label="备注" class="col-span-12">
            <el-input v-model="documentForm.remark" type="textarea" :rows="3" />
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="documentDialogVisible = false">取消</el-button>
        <el-button type="primary" color="#00689E" :loading="saving" @click="submitDocument">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="preAuthDialogVisible" title="预授权 / 押金台账" width="820px">
      <el-form label-position="top">
        <div class="grid grid-cols-12 gap-4">
          <el-form-item label="订单号" class="col-span-12 md:col-span-4">
            <el-input v-model="preAuthForm.orderNo" placeholder="可选，绑定订单后自动带客户快照" />
          </el-form-item>
          <el-form-item label="客户名称" class="col-span-12 md:col-span-4">
            <el-input v-model="preAuthForm.customerName" />
          </el-form-item>
          <el-form-item label="企业简称" class="col-span-12 md:col-span-4">
            <el-input v-model="preAuthForm.corporateShortName" />
          </el-form-item>
          <el-form-item label="状态" class="col-span-12 md:col-span-4">
            <el-select v-model="preAuthForm.status" class="w-full">
              <el-option label="待冻结" value="pending" />
              <el-option label="已冻结" value="frozen" />
              <el-option label="部分扣款" value="partially_captured" />
              <el-option label="已扣款" value="captured" />
              <el-option label="已释放" value="released" />
              <el-option label="已过期" value="expired" />
              <el-option label="失败" value="failed" />
            </el-select>
          </el-form-item>
          <el-form-item label="渠道" class="col-span-12 md:col-span-4">
            <el-radio-group v-model="preAuthForm.channel">
              <el-radio-button label="online">线上</el-radio-button>
              <el-radio-button label="offline">线下</el-radio-button>
              <el-radio-button label="internal">内部</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="支付服务商" class="col-span-12 md:col-span-4">
            <el-input v-model="preAuthForm.provider" />
          </el-form-item>
          <el-form-item label="冻结金额" class="col-span-12 md:col-span-4">
            <el-input-number v-model="preAuthForm.authorizedAmount" :min="0" class="w-full" />
          </el-form-item>
          <el-form-item label="已扣款" class="col-span-12 md:col-span-4">
            <el-input-number v-model="preAuthForm.capturedAmount" :min="0" class="w-full" />
          </el-form-item>
          <el-form-item label="已释放" class="col-span-12 md:col-span-4">
            <el-input-number v-model="preAuthForm.releasedAmount" :min="0" class="w-full" />
          </el-form-item>
          <el-form-item label="授权码" class="col-span-12 md:col-span-4">
            <el-input v-model="preAuthForm.authCode" placeholder="渠道授权码" />
          </el-form-item>
          <el-form-item label="渠道流水号" class="col-span-12 md:col-span-4">
            <el-input v-model="preAuthForm.channelReferenceNo" />
          </el-form-item>
          <el-form-item label="支付方式" class="col-span-12 md:col-span-4">
            <el-input v-model="preAuthForm.paymentMethod" />
          </el-form-item>
          <el-form-item label="冻结时间" class="col-span-12 md:col-span-4">
            <el-input v-model="preAuthForm.frozenAt" placeholder="2026-05-06T10:10:00+08:00" />
          </el-form-item>
          <el-form-item label="过期时间" class="col-span-12 md:col-span-4">
            <el-input v-model="preAuthForm.expiresAt" placeholder="可选" />
          </el-form-item>
          <el-form-item label="处理人" class="col-span-12 md:col-span-4">
            <el-input v-model="preAuthForm.operator" />
          </el-form-item>
          <el-form-item label="备注" class="col-span-12">
            <el-input v-model="preAuthForm.remark" type="textarea" :rows="3" />
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="preAuthDialogVisible = false">取消</el-button>
        <el-button type="primary" color="#00689E" :loading="saving" @click="submitPreAuth">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="adjustmentDialogVisible" title="新增手工调账" width="760px">
      <el-form label-position="top">
        <div class="grid grid-cols-12 gap-4">
          <el-form-item label="订单号" class="col-span-12 md:col-span-4">
            <el-input v-model="adjustmentForm.orderNo" placeholder="可选，绑定订单后入费用中心" />
          </el-form-item>
          <el-form-item label="客户名称" class="col-span-12 md:col-span-4">
            <el-input v-model="adjustmentForm.customerName" />
          </el-form-item>
          <el-form-item label="企业简称" class="col-span-12 md:col-span-4">
            <el-input v-model="adjustmentForm.corporateShortName" />
          </el-form-item>
          <el-form-item label="调账类别" class="col-span-12 md:col-span-4">
            <el-select v-model="adjustmentForm.category" class="w-full">
              <el-option label="ETC补录" value="ETC补录" />
              <el-option label="停车费补录" value="停车费补录" />
              <el-option label="车损补收" value="车损补收" />
              <el-option label="人工减免" value="人工减免" />
              <el-option label="退款调整" value="退款调整" />
            </el-select>
          </el-form-item>
          <el-form-item label="方向" class="col-span-12 md:col-span-4">
            <el-radio-group v-model="adjustmentForm.direction">
              <el-radio-button label="charge">补收</el-radio-button>
              <el-radio-button label="refund">退款</el-radio-button>
              <el-radio-button label="waiver">减免</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="结算口径" class="col-span-12 md:col-span-4">
            <el-radio-group v-model="adjustmentForm.targetBillingMode">
              <el-radio-button label="customer_pay">客户自付</el-radio-button>
              <el-radio-button label="monthly">企业月结</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="金额" class="col-span-12 md:col-span-4">
            <el-input-number v-model="adjustmentForm.amount" :min="0" class="w-full" />
          </el-form-item>
          <el-form-item label="经办人" class="col-span-12 md:col-span-4">
            <el-input v-model="adjustmentForm.operator" />
          </el-form-item>
          <el-form-item label="调账原因" class="col-span-12">
            <el-input v-model="adjustmentForm.reason" type="textarea" :rows="4" />
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="adjustmentDialogVisible = false">取消</el-button>
        <el-button type="primary" color="#00689E" :loading="saving" @click="submitAdjustment">提交</el-button>
      </template>
    </el-dialog>
  </AppLayout>
</template>

<style scoped>
.finance-tabs :deep(.el-tabs__header) {
  margin: 0;
}
</style>
