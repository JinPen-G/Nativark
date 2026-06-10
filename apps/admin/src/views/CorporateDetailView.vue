<script setup lang="ts">
import { ElMessage } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type {
  CorporateContact,
  CorporateContractRecord,
  CorporateDetail,
  CorporateMonthlyBillSummary,
  SaveCorporateRequest
} from "@rimo/shared";
import {
  createCorporateContractAttachment,
  getCorporateDetail,
  listCorporateMonthlyBills,
  saveCorporate,
  settleCorporateMonthlyBill
} from "../api/client";
import AppLayout from "../components/AppLayout.vue";
import { useAuthStore } from "../stores/auth";

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const loading = ref(false);
const saving = ref(false);
const billsLoading = ref(false);
const settleLoading = ref(false);
const attachmentLoadingKey = ref("");
const settleDialogVisible = ref(false);
const detail = ref<CorporateDetail | null>(null);
const monthlyBills = ref<CorporateMonthlyBillSummary[]>([]);
const selectedBill = ref<CorporateMonthlyBillSummary | null>(null);
const isCreate = computed(() => route.params.id === "new");
const canSettleMonthlyBill = computed(() =>
  authStore.hasAnyPermission([
    "store-rental:order:fee-manage",
    "store-rental:corporate:monthly-settle"
  ])
);
const settleForm = reactive({
  amount: 0,
  channel: "offline" as "online" | "offline" | "internal",
  operator: "营运财务",
  note: ""
});

const form = reactive<SaveCorporateRequest>({
  shortName: "",
  fullName: "",
  status: "active",
  creditLimitAmount: 0,
  accountPeriodDays: 30,
  billingCycleDay: 25,
  settlementMode: "monthly",
  contactName: "",
  contactPhone: "",
  billingEmail: "",
  statementEmail: "",
  reconciliationContactName: "",
  reconciliationContactPhone: "",
  autoGenerateStatement: true,
  creditWarningAmount: 0,
  linkedStores: [],
  contacts: [],
  contracts: []
});

function applyDetail(data: CorporateDetail) {
  detail.value = data;
  Object.assign(form, {
    id: data.id,
    shortName: data.shortName,
    fullName: data.fullName,
    status: data.status,
    creditLimitAmount: data.creditLimitAmount,
    accountPeriodDays: data.accountPeriodDays,
    billingCycleDay: data.billingCycleDay,
    settlementMode: data.settlementMode,
    contactName: data.contactName,
    contactPhone: data.contactPhone,
    billingEmail: data.billingEmail,
    statementEmail: data.statementEmail,
    reconciliationContactName: data.reconciliationContactName,
    reconciliationContactPhone: data.reconciliationContactPhone,
    autoGenerateStatement: data.autoGenerateStatement,
    creditWarningAmount: data.creditWarningAmount ?? 0,
    invoiceTitle: data.invoiceTitle,
    linkedStores: data.linkedStores,
    notes: data.notes,
    contacts: data.contacts.map((item) => ({ ...item })),
    contracts: data.contracts.map((item) => ({ ...item }))
  });
}

async function loadData() {
  if (isCreate.value) {
    detail.value = null;
    Object.assign(form, {
      id: undefined,
      shortName: "",
      fullName: "",
      status: "active",
      creditLimitAmount: 0,
      accountPeriodDays: 30,
      billingCycleDay: 25,
      settlementMode: "monthly",
      contactName: "",
      contactPhone: "",
      billingEmail: "",
      statementEmail: "",
      reconciliationContactName: "",
      reconciliationContactPhone: "",
      autoGenerateStatement: true,
      creditWarningAmount: 0,
      invoiceTitle: "",
      linkedStores: [],
      notes: "",
      contacts: [],
      contracts: []
    });
    return;
  }

  loading.value = true;
  try {
    const data = await getCorporateDetail(String(route.params.id));
    applyDetail(data);
    await loadMonthlyBills(data.id);
  } finally {
    loading.value = false;
  }
}

async function loadMonthlyBills(corporateId = detail.value?.id) {
  if (!corporateId || isCreate.value) {
    monthlyBills.value = [];
    return;
  }
  billsLoading.value = true;
  try {
    monthlyBills.value = await listCorporateMonthlyBills(corporateId);
  } finally {
    billsLoading.value = false;
  }
}

function addContact() {
  form.contacts.push({
    id: "",
    name: "",
    title: "",
    phone: "",
    email: ""
  } as CorporateContact);
}

function removeContact(index: number) {
  form.contacts.splice(index, 1);
}

function addContract() {
  form.contracts.push({
    id: "",
    contractNo: "",
    contractName: "",
    status: "draft",
    startDate: "",
    endDate: "",
    amount: 0,
    linkedStores: [],
    statementEmail: "",
    attachments: [],
    remark: ""
  } as CorporateContractRecord);
}

function removeContract(index: number) {
  form.contracts.splice(index, 1);
}

async function createMockContractAttachment(
  contract: CorporateContractRecord,
  index: number
) {
  if (isCreate.value || !detail.value?.id || !contract.id) {
    ElMessage.warning("请先保存企业客户和合同");
    return;
  }

  const key = contract.id || String(index);
  const baseName = contract.contractNo || contract.contractName || "corporate-contract";
  attachmentLoadingKey.value = key;
  try {
    const result = await createCorporateContractAttachment(detail.value.id, contract.id, {
      fileName: `${baseName}-附件.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 0,
      uploadedBy: "企业客户管理员",
      metadata: {
        source: "corporate_detail",
        mockBinarySkipped: true
      }
    });
    applyDetail(result.corporate);
    ElMessage.success("合同附件元数据已创建");
  } catch {
    ElMessage.error("合同附件创建失败");
  } finally {
    attachmentLoadingKey.value = "";
  }
}

function formatMoney(value: number) {
  return `¥${Math.round(value).toLocaleString("zh-Hans-CN")}`;
}

function billStatusLabel(status: CorporateMonthlyBillSummary["status"]) {
  return {
    draft: "草稿",
    posted: "已出账",
    partially_paid: "部分回款",
    paid: "已结清",
    void: "已作废"
  }[status];
}

function billStatusType(status: CorporateMonthlyBillSummary["status"]) {
  return {
    draft: "info",
    posted: "warning",
    partially_paid: "warning",
    paid: "success",
    void: "danger"
  }[status] as "info" | "warning" | "success" | "danger";
}

function openSettleDialog(bill: CorporateMonthlyBillSummary) {
  if (!canSettleMonthlyBill.value) {
    ElMessage.warning("当前角色没有企业月结回款权限");
    return;
  }

  selectedBill.value = bill;
  Object.assign(settleForm, {
    amount: bill.balanceAmount,
    channel: "offline",
    operator: "营运财务",
    note: "企业月结回款登记"
  });
  settleDialogVisible.value = true;
}

async function submitSettleBill() {
  if (!detail.value || !selectedBill.value) {
    return;
  }
  settleLoading.value = true;
  try {
    await settleCorporateMonthlyBill(detail.value.id, selectedBill.value.id, {
      ...settleForm
    });
    settleDialogVisible.value = false;
    ElMessage.success("企业月结回款已登记");
    await loadMonthlyBills(detail.value.id);
  } catch {
    ElMessage.error("企业月结回款登记失败");
  } finally {
    settleLoading.value = false;
  }
}

async function submit() {
  if (!form.shortName || !form.fullName) {
    ElMessage.warning("请填写企业简称和企业全称");
    return;
  }
  saving.value = true;
  try {
    const saved = await saveCorporate(form);
    applyDetail(saved);
    ElMessage.success("企业客户已保存");
    if (isCreate.value) {
      await router.replace(`/corporates/${saved.id}`);
    }
  } catch {
    ElMessage.error("企业客户保存失败");
  } finally {
    saving.value = false;
  }
}

onMounted(loadData);
</script>

<template>
  <AppLayout>
    <div class="flex justify-between items-end mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-800">{{ isCreate ? "新增企业客户" : "企业客户详情" }}</h1>
        <p class="text-sm text-gray-500 mt-1">维护企业账期、联系人、授信额度和门店范围。</p>
      </div>
      <div class="flex gap-3">
        <el-button @click="router.push('/corporates')">返回列表</el-button>
        <el-button type="primary" color="#00689E" :loading="saving" @click="submit">保存</el-button>
      </div>
    </div>

    <div v-loading="loading" class="grid grid-cols-12 gap-5">
      <div class="col-span-12 xl:col-span-8 rimo-card p-5">
        <el-form label-position="top">
          <div class="text-sm font-semibold text-gray-800 mb-4">企业基础信息</div>
          <div class="grid grid-cols-12 gap-4">
            <el-form-item label="企业简称" required class="col-span-12 md:col-span-4">
              <el-input v-model="form.shortName" />
            </el-form-item>
            <el-form-item label="企业全称" required class="col-span-12 md:col-span-8">
              <el-input v-model="form.fullName" />
            </el-form-item>
            <el-form-item label="状态" class="col-span-12 md:col-span-3">
              <el-select v-model="form.status" class="w-full">
                <el-option label="正常" value="active" />
                <el-option label="暂停" value="paused" />
                <el-option label="停用" value="disabled" />
              </el-select>
            </el-form-item>
            <el-form-item label="授信额度" class="col-span-12 md:col-span-3">
              <el-input-number v-model="form.creditLimitAmount" :min="0" class="w-full" />
            </el-form-item>
            <el-form-item label="账期 (天)" class="col-span-12 md:col-span-3">
              <el-input-number v-model="form.accountPeriodDays" :min="0" class="w-full" />
            </el-form-item>
            <el-form-item label="账单日" class="col-span-12 md:col-span-3">
              <el-input-number v-model="form.billingCycleDay" :min="1" :max="31" class="w-full" />
            </el-form-item>
            <el-form-item label="结算模式" class="col-span-12 md:col-span-4">
              <el-radio-group v-model="form.settlementMode">
                <el-radio-button label="monthly">月结</el-radio-button>
                <el-radio-button label="prepaid">预付</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="主联系人" class="col-span-12 md:col-span-4">
              <el-input v-model="form.contactName" />
            </el-form-item>
            <el-form-item label="联系电话" class="col-span-12 md:col-span-4">
              <el-input v-model="form.contactPhone" />
            </el-form-item>
            <el-form-item label="账单邮箱" class="col-span-12 md:col-span-6">
              <el-input v-model="form.billingEmail" />
            </el-form-item>
            <el-form-item label="对账单邮箱" class="col-span-12 md:col-span-6">
              <el-input v-model="form.statementEmail" />
            </el-form-item>
            <el-form-item label="发票抬头" class="col-span-12 md:col-span-6">
              <el-input v-model="form.invoiceTitle" />
            </el-form-item>
            <el-form-item label="对账联系人" class="col-span-12 md:col-span-3">
              <el-input v-model="form.reconciliationContactName" />
            </el-form-item>
            <el-form-item label="对账联系电话" class="col-span-12 md:col-span-3">
              <el-input v-model="form.reconciliationContactPhone" />
            </el-form-item>
            <el-form-item label="可用门市" class="col-span-12">
              <el-select v-model="form.linkedStores" multiple class="w-full">
                <el-option label="旺角门市" value="旺角门市" />
                <el-option label="中环门市" value="中环门市" />
                <el-option label="机场门市" value="机场门市" />
              </el-select>
            </el-form-item>
            <div class="col-span-12 mt-2 border-t border-slate-200 pt-4">
              <div class="text-sm font-semibold text-gray-800 mb-4">月结配置</div>
            </div>
            <el-form-item label="自动生成月结账单" class="col-span-12 md:col-span-4">
              <div class="flex h-10 items-center">
                <el-switch v-model="form.autoGenerateStatement" />
              </div>
            </el-form-item>
            <el-form-item label="授信预警阈值" class="col-span-12 md:col-span-4">
              <el-input-number v-model="form.creditWarningAmount" :min="0" class="w-full" />
            </el-form-item>
            <el-form-item label="结算说明" class="col-span-12 md:col-span-4">
              <el-input :model-value="form.settlementMode === 'monthly' ? '企业账单汇总后结算' : '下单前预付或现付'" disabled />
            </el-form-item>
            <el-form-item label="内部备注" class="col-span-12">
              <el-input v-model="form.notes" type="textarea" :rows="3" />
            </el-form-item>
          </div>
        </el-form>
      </div>

      <div class="col-span-12 xl:col-span-4 space-y-5">
        <div class="rimo-card p-5">
          <div class="flex items-center justify-between mb-4">
            <div class="text-sm font-semibold text-gray-800">联系人</div>
            <el-button link type="primary" @click="addContact">新增联系人</el-button>
          </div>
          <div class="space-y-4">
            <div v-for="(contact, index) in form.contacts" :key="index" class="rounded-lg border border-slate-200 p-4">
              <div class="grid grid-cols-12 gap-3">
                <el-input v-model="contact.name" placeholder="姓名" class="col-span-12 md:col-span-5" />
                <el-input v-model="contact.title" placeholder="职位" class="col-span-12 md:col-span-4" />
                <el-input v-model="contact.phone" placeholder="电话" class="col-span-12 md:col-span-3" />
                <el-input v-model="contact.email" placeholder="邮箱" class="col-span-12" />
              </div>
              <div class="flex justify-end mt-3">
                <el-button link type="danger" @click="removeContact(index)">删除</el-button>
              </div>
            </div>
          </div>
        </div>

        <div class="rimo-card p-5">
          <div class="flex items-center justify-between mb-4">
            <div class="text-sm font-semibold text-gray-800">合同台账</div>
            <el-button link type="primary" @click="addContract">新增合同</el-button>
          </div>
          <div class="space-y-4">
            <div v-for="(contract, index) in form.contracts" :key="contract.id || index" class="rounded-lg border border-slate-200 p-4">
              <div class="grid grid-cols-12 gap-3">
                <el-input v-model="contract.contractNo" placeholder="合同编号" class="col-span-12 md:col-span-5" />
                <el-input v-model="contract.contractName" placeholder="合同名称" class="col-span-12 md:col-span-7" />
                <el-select v-model="contract.status" class="col-span-12 md:col-span-4">
                  <el-option label="草稿" value="draft" />
                  <el-option label="生效中" value="active" />
                  <el-option label="即将到期" value="expiring" />
                  <el-option label="已到期" value="expired" />
                  <el-option label="已终止" value="terminated" />
                </el-select>
                <el-date-picker v-model="contract.startDate" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" class="col-span-12 md:col-span-4" />
                <el-date-picker v-model="contract.endDate" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" class="col-span-12 md:col-span-4" />
                <el-input-number v-model="contract.amount" :min="0" class="col-span-12 md:col-span-4 !w-full" />
                <el-input v-model="contract.statementEmail" placeholder="合同对账邮箱" class="col-span-12 md:col-span-8" />
                <el-select v-model="contract.linkedStores" multiple class="col-span-12">
                  <el-option label="旺角门市" value="旺角门市" />
                  <el-option label="中环门市" value="中环门市" />
                  <el-option label="机场门市" value="机场门市" />
                </el-select>
                <el-input
                  :model-value="contract.attachments.join(', ')"
                  placeholder="附件文件名，多个用英文逗号分隔"
                  class="col-span-12 md:col-span-8"
                  @update:model-value="contract.attachments = String($event).split(',').map((item) => item.trim()).filter(Boolean)"
                />
                <el-button
                  class="col-span-12 md:col-span-4"
                  :loading="attachmentLoadingKey === (contract.id || String(index))"
                  @click="createMockContractAttachment(contract, index)"
                >
                  生成 mock 附件
                </el-button>
                <el-input v-model="contract.remark" type="textarea" :rows="2" placeholder="合同备注" class="col-span-12" />
              </div>
              <div class="flex justify-end mt-3">
                <el-button link type="danger" @click="removeContract(index)">删除合同</el-button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="!isCreate" class="col-span-12 rimo-card p-5">
        <div class="flex items-center justify-between mb-4">
          <div>
            <div class="text-sm font-semibold text-gray-800">月结账单</div>
            <div class="text-xs text-gray-500 mt-1">按企业月结订单归集，回款后更新账单余额。</div>
          </div>
          <el-button @click="loadMonthlyBills()">刷新账单</el-button>
        </div>
        <el-table v-loading="billsLoading" :data="monthlyBills" stripe>
          <el-table-column type="expand">
            <template #default="{ row }">
              <div class="p-3 bg-slate-50">
                <el-table :data="row.lineItems" size="small">
                  <el-table-column label="订单号" prop="orderNo" width="150" />
                  <el-table-column label="客户" prop="customerName" width="120" />
                  <el-table-column label="车组" prop="vehicleGroupName" min-width="180" />
                  <el-table-column label="取还门市" min-width="180">
                    <template #default="{ row: line }">
                      {{ line.pickupStoreName }} / {{ line.returnStoreName }}
                    </template>
                  </el-table-column>
                  <el-table-column label="金额" width="120" align="right">
                    <template #default="{ row: line }">{{ formatMoney(line.amount) }}</template>
                  </el-table-column>
                  <el-table-column label="说明" prop="remark" min-width="140" />
                </el-table>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="账单号" prop="billNo" min-width="150" />
          <el-table-column label="账期" prop="period" width="100" />
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="billStatusType(row.status)" effect="plain">{{ billStatusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="订单数" prop="orderCount" width="90" align="center" />
          <el-table-column label="应收" width="120" align="right">
            <template #default="{ row }">{{ formatMoney(row.totalAmount) }}</template>
          </el-table-column>
          <el-table-column label="已回款" width="120" align="right">
            <template #default="{ row }">{{ formatMoney(row.paidAmount) }}</template>
          </el-table-column>
          <el-table-column label="余额" width="120" align="right">
            <template #default="{ row }">{{ formatMoney(row.balanceAmount) }}</template>
          </el-table-column>
          <el-table-column label="到期日" width="170">
            <template #default="{ row }">{{ row.dueDate.slice(0, 10) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="120" align="right">
            <template #default="{ row }">
              <el-button
                v-if="canSettleMonthlyBill"
                link
                type="primary"
                :disabled="row.balanceAmount <= 0"
                @click="openSettleDialog(row)"
              >
                登记回款
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <el-dialog v-model="settleDialogVisible" title="登记企业月结回款" width="460px" destroy-on-close>
      <el-form label-position="top">
        <el-form-item label="账单号">
          <el-input :model-value="selectedBill?.billNo" disabled />
        </el-form-item>
        <el-form-item label="回款金额">
          <el-input-number v-model="settleForm.amount" :min="0" :max="selectedBill?.balanceAmount || 0" class="w-full" />
        </el-form-item>
        <el-form-item label="回款渠道">
          <el-select v-model="settleForm.channel" class="w-full">
            <el-option label="线下转账" value="offline" />
            <el-option label="线上支付" value="online" />
            <el-option label="内部记账" value="internal" />
          </el-select>
        </el-form-item>
        <el-form-item label="操作人">
          <el-input v-model="settleForm.operator" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="settleForm.note" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="settleDialogVisible = false">取消</el-button>
        <el-button type="primary" color="#00689E" :loading="settleLoading" @click="submitSettleBill">确认登记</el-button>
      </template>
    </el-dialog>
  </AppLayout>
</template>
