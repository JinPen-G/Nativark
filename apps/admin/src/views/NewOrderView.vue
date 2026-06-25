<script setup lang="ts">
import { ElMessage } from "element-plus";
import { computed, onMounted, reactive, ref, watch } from "vue";
import {
  BillingMode,
  DispatchStatus,
  type MarketingPlanSummary,
  OrderMainStatus,
  PaymentStatus,
  StoreRentalMode,
  type CreateStoreRentalOrderResult,
  type CorporateSummary,
  type MemberSummary,
  type StoreRentalAvailabilityResult,
  type PricingQuoteResult
} from "@store-rental/shared";
import {
  checkStoreRentalAvailability,
  createStoreRentalOrder,
  listCorporates,
  listMarketingPlans,
  listMembers,
  quoteStoreRental
} from "../api/client";
import AppLayout from "../components/AppLayout.vue";
import { stores, valueAddedServices, vehicleGroups } from "../data/prototypeSeed";

const selectedMemberId = ref("");
const selectedCorporateId = ref("");
const reservationType = ref<"personal" | "enterprise">("personal");
const selectedGroupId = ref("ECONOMY");
const selectedMarketingPlanId = ref("");
const selectedCouponId = ref("");
const redeemCode = ref("");
const showRedeemInput = ref(false);
const pointsUsed = ref(0);
const paymentDialogVisible = ref(false);
const orderSuccessVisible = ref(false);
const collectionMode = ref<"deposit" | "pending" | "monthly">("deposit");
const selectedCreditCard = ref("card_visa");
const latestQuote = ref<PricingQuoteResult | null>(null);
const availabilityResult = ref<StoreRentalAvailabilityResult | null>(null);
const availabilityLoading = ref(false);
const membersLoading = ref(false);
const corporatesLoading = ref(false);
const memberRows = ref<MemberSummary[]>([]);
const corporateRows = ref<CorporateSummary[]>([]);
const marketingPlanRows = ref<MarketingPlanSummary[]>([]);

const rentalData = reactive({
  pickupLocation: "MONGKOK",
  returnLocation: "MONGKOK",
  pickupTime: new Date("2026-05-06T10:00:00+08:00"),
  returnTime: new Date("2026-05-08T10:00:00+08:00")
});

const services = ref(structuredClone(valueAddedServices));
const createdOrder = ref<CreateStoreRentalOrderResult>({
  id: "",
  orderNo: "",
  quoteNo: "",
  mainStatus: OrderMainStatus.PendingPayment,
  paymentStatus: PaymentStatus.Unpaid,
  dispatchStatus: DispatchStatus.Pending,
  totalAmount: 0,
  message: "",
  snapshots: {
    pricingVersion: "",
    priceVersionId: "",
    ruleVersion: "",
    vehicleGroupCode: "",
    pickupStoreCode: "",
    returnStoreCode: "",
    baseDailyAmount: 0
  }
});

const userCreditCards = [
  { id: "card_visa", brand: "Visa", last4: "2388", expiry: "09/29", isDefault: true },
  { id: "card_master", brand: "Master", last4: "6619", expiry: "12/28", isDefault: false }
];
const groupCodeMap: Record<string, string> = {
  ECONOMY: "GROUP_ECONOMY",
  SEVEN: "GROUP_SEVEN_SEATS",
  EV: "GROUP_EV"
};
const groupRows = ref<Array<(typeof vehicleGroups)[number]>>(structuredClone(vehicleGroups));

const currentMember = computed(() =>
  memberRows.value.find((item) => item.id === selectedMemberId.value)
);
const activeCorporates = computed(() =>
  corporateRows.value.filter((item) => item.status === "active")
);
const currentCorporate = computed(() =>
  activeCorporates.value.find((item) => item.id === selectedCorporateId.value)
);
const selectedGroup = computed(() => groupRows.value.find((item) => item.id === selectedGroupId.value) ?? groupRows.value[0]);
const canUsePersonalBenefits = computed(() => reservationType.value === "personal");
const billingMode = computed(() => (collectionMode.value === "monthly" ? BillingMode.Monthly : BillingMode.CustomerPay));
const selectedAvailability = computed(() =>
  availabilityResult.value?.groups.find(
    (group) => group.vehicleGroupCode === groupCodeMap[selectedGroup.value.id]
  )
);

const rentalHours = computed(() => {
  const pickup = new Date(rentalData.pickupTime).getTime();
  const returns = new Date(rentalData.returnTime).getTime();
  return Math.max(1, Math.ceil((returns - pickup) / 3_600_000));
});

const billableDays = computed(() => Math.max(1, Math.ceil(rentalHours.value / 24)));
const rentalDurationLabel = computed(() => `${rentalHours.value}小时`);
const rentalBillingLabel = computed(() => `${billableDays.value}天`);
const baseRentalTotalValue = computed(() => selectedGroup.value.dailyPrice * billableDays.value);
const selectedServiceTotal = computed(() =>
  services.value.reduce((total, service) => {
    if (!service.selected) {
      return total;
    }
    const amount = service.unit === "/天" ? service.price * billableDays.value : service.price;
    return total + amount * service.quantity;
  }, 0)
);
const discountAmountValue = computed(() => latestQuote.value?.discountAmount ?? 0);
const couponAmountValue = computed(() => (selectedCouponId.value ? 80 : 0));
const pointsAmountValue = computed(() => Math.floor(pointsUsed.value / 100));
const finalTotalValue = computed(() =>
  Math.max(0, baseRentalTotalValue.value + selectedServiceTotal.value - discountAmountValue.value - couponAmountValue.value - pointsAmountValue.value)
);
const depositAmountValue = computed(() => (collectionMode.value === "monthly" ? 0 : selectedGroup.value.deposit));
const depositPayAmount = computed(() => (latestQuote.value?.depositAmount ?? depositAmountValue.value));

const baseRentalTotal = computed(() => formatNumber(baseRentalTotalValue.value));
const discountAmount = computed(() => formatNumber(discountAmountValue.value));
const couponAmount = computed(() => formatNumber(couponAmountValue.value));
const pointsAmount = computed(() => formatNumber(pointsAmountValue.value));
const finalTotal = computed(() => formatNumber(latestQuote.value?.monthlySettlementAmount ?? latestQuote.value?.payableAmount ?? finalTotalValue.value));
const depositPayAmountText = computed(() => formatNumber(depositPayAmount.value));
const quoteExplanationLines = computed(() => latestQuote.value?.explanationLines ?? []);
const quoteBillingSegments = computed(() => latestQuote.value?.billingSegments ?? []);
const quoteHasRuleTrace = computed(() => quoteExplanationLines.value.length > 0 || quoteBillingSegments.value.length > 0);

const availableMarketingPlans = computed(() => [
  {
    id: "none",
    name: "不使用方案",
    scope: reservationType.value,
    manualVerification: false,
    qualificationName: undefined,
    requiredDocText: undefined,
    versionId: ""
  },
  ...marketingPlanRows.value
    .filter((plan) => plan.status === "effective")
    .filter(
      (plan) =>
        plan.customerScope === "all" ||
        plan.customerScope === reservationType.value
    )
    .map((plan) => ({
      id: plan.id,
      name: plan.displayName,
      scope: plan.customerScope,
      manualVerification: plan.manualVerification,
      qualificationName: plan.qualificationName,
      requiredDocText: plan.requiredDocText,
      versionId: plan.versionId
    }))
]);

const selectedMarketingPlan = computed(() => availableMarketingPlans.value.find((item) => item.id === selectedMarketingPlanId.value));
const marketingPlanEligibilityLabel = computed(() =>
  reservationType.value === "enterprise" ? "当前展示企业资格可用方案" : "当前展示个人会员可用方案"
);
const customerCoupons = computed(() => [
  { id: "coupon_80", name: "门市租车满 600 减 80", desc: "本月有效" },
  { id: "coupon_airport", name: "机场还车服务费减免", desc: "限机场门市" }
]);
const preAuthRuleText = computed(() => "预授权押金按租赁业务规则与车组押金标准计算");
const hasEnterpriseOption = computed(() => activeCorporates.value.length > 0);
const memberRiskWarnings = computed(() => {
  const member = currentMember.value;
  if (!member) {
    return [];
  }
  const warnings: string[] = [];
  if (member.status !== "active") {
    warnings.push("会员状态不可下单");
  }
  if (!member.identityVerified || !member.driverLicenseVerified) {
    warnings.push("身份证或驾驶证未完成认证");
  }
  if (member.tags.some((tag) => tag.includes("黑名单") || tag.includes("限制"))) {
    warnings.push("会员存在风控标签");
  }
  return warnings;
});
const corporateRiskWarnings = computed(() => {
  const corporate = currentCorporate.value;
  if (reservationType.value !== "enterprise" || !corporate) {
    return [];
  }
  const warnings: string[] = [];
  if (corporate.settlementMode !== "monthly" && collectionMode.value === "monthly") {
    warnings.push("企业未配置月结模式");
  }
  if (
    corporate.creditLimitAmount > 0 &&
    corporate.unpaidAmount + finalTotalValue.value > corporate.creditLimitAmount
  ) {
    warnings.push("企业未回款金额将超过授信额度");
  }
  if (corporate.contractStatus !== "active") {
    warnings.push("企业合同不是有效状态");
  }
  return warnings;
});
const orderRiskWarnings = computed(() => [
  ...memberRiskWarnings.value,
  ...corporateRiskWarnings.value
]);

const newPayment = reactive({
  gateway: "credit_card",
  amount: 0,
  processing: false
});

function formatNumber(value: number) {
  return `¥${Math.round(value).toLocaleString("zh-Hans-CN")}`;
}

function calculateServicePrice(service: (typeof valueAddedServices)[number]) {
  const amount = service.unit === "/天" ? service.price * billableDays.value : service.price;
  return formatNumber(amount * service.quantity);
}

function formatSignedAmount(value: number) {
  if (value === 0) {
    return formatNumber(0);
  }
  return `${value > 0 ? "+" : "-"} ${formatNumber(Math.abs(value))}`;
}

function quoteDayTypeLabel(dayType: PricingQuoteResult["billingSegments"][number]["dayType"]) {
  const labels: Record<PricingQuoteResult["billingSegments"][number]["dayType"], string> = {
    weekday: "平日",
    holiday: "假日",
    statutory_holiday: "国定假日"
  };
  return labels[dayType];
}

function selectVehicleGroup(group: (typeof vehicleGroups)[number]) {
  if (group.available <= 0) {
    return;
  }
  selectedGroupId.value = group.id;
}

function setCollectionMode(mode: "deposit" | "pending" | "monthly") {
  if (mode === "monthly" && reservationType.value !== "enterprise") {
    ElMessage.warning("企业月结仅支持企业预订");
    return;
  }
  if (mode === "monthly" && currentCorporate.value?.settlementMode !== "monthly") {
    ElMessage.warning("当前企业未配置月结模式");
    return;
  }
  collectionMode.value = mode;
}

function memberLevelTagType(levelName?: string) {
  if (levelName?.includes("黑金")) {
    return "warning";
  }
  if (levelName?.includes("黄金")) {
    return "success";
  }
  return "info";
}

function submitOrder() {
  if (!currentMember.value) {
    ElMessage.warning("请先选择客户");
    return;
  }
  if (memberRiskWarnings.value.length) {
    ElMessage.warning(memberRiskWarnings.value[0]);
    return;
  }
  if (reservationType.value === "enterprise" && !currentCorporate.value) {
    ElMessage.warning("请选择企业客户");
    return;
  }
  if (corporateRiskWarnings.value.length) {
    ElMessage.warning(corporateRiskWarnings.value[0]);
    return;
  }
  paymentDialogVisible.value = true;
}

async function loadCustomers() {
  membersLoading.value = true;
  corporatesLoading.value = true;
  try {
    const [members, corporates] = await Promise.all([listMembers(), listCorporates()]);
    memberRows.value = members;
    corporateRows.value = corporates;
    selectedMemberId.value = members[0]?.id ?? "";
    selectedCorporateId.value =
      corporates.find((item) => item.status === "active")?.id ?? "";
  } catch {
    ElMessage.error("会员或企业客户数据加载失败");
  } finally {
    membersLoading.value = false;
    corporatesLoading.value = false;
  }
}

async function loadMarketingPlanOptions() {
  try {
    marketingPlanRows.value = await listMarketingPlans();
  } catch {
    marketingPlanRows.value = [];
  }
}

async function refreshQuote() {
  try {
    latestQuote.value = await quoteStoreRental({
      planId: "plan_store_standard",
      vehicleGroupCode: groupCodeMap[selectedGroup.value.id] ?? "GROUP_ECONOMY",
      pickupStoreCode: rentalData.pickupLocation,
      returnStoreCode: rentalData.returnLocation,
      pickupAt: new Date(rentalData.pickupTime).toISOString(),
      returnAt: new Date(rentalData.returnTime).toISOString(),
      billingMode: billingMode.value,
      serviceCodes: services.value.filter((service) => service.selected).map((service) => service.id),
      customerType: reservationType.value,
      membershipLevel: currentMember.value?.levelName,
      marketingPlanId: selectedMarketingPlanId.value || undefined,
      corporateId:
        reservationType.value === "enterprise" ? currentCorporate.value?.id : undefined
    });
    if (!selectedMarketingPlanId.value && latestQuote.value?.selectedMarketingPlan) {
      selectedMarketingPlanId.value = latestQuote.value.selectedMarketingPlan.id;
    }
  } catch {
    latestQuote.value = null;
  }
}

async function refreshAvailability() {
  availabilityLoading.value = true;
  try {
    const result = await checkStoreRentalAvailability({
      mode: StoreRentalMode.Store,
      pickupStoreCode: rentalData.pickupLocation,
      returnStoreCode: rentalData.returnLocation,
      pickupAt: new Date(rentalData.pickupTime).toISOString(),
      returnAt: new Date(rentalData.returnTime).toISOString(),
      vehicleGroupCodes: Object.values(groupCodeMap)
    });
    availabilityResult.value = result;
    groupRows.value = groupRows.value.map((group) => {
      const groupAvailability = result.groups.find(
        (item) => item.vehicleGroupCode === groupCodeMap[group.id]
      );
      return {
        ...group,
        available: groupAvailability?.availableCount ?? group.available
      };
    });
  } catch {
    availabilityResult.value = null;
  } finally {
    availabilityLoading.value = false;
  }
}

async function refreshOrderPreview() {
  await Promise.all([refreshAvailability(), refreshQuote()]);
}

async function confirmPayment() {
  if (!currentMember.value) {
    return;
  }

  newPayment.processing = true;
  await refreshQuote();

  try {
    createdOrder.value = await createStoreRentalOrder({
      quoteNo: latestQuote.value?.quoteNo ?? `LOCAL-QT-${Date.now()}`,
      memberId: currentMember.value.id,
      corporateId: reservationType.value === "enterprise" ? currentCorporate.value?.id : undefined,
      customerName: currentMember.value.name,
      customerPhone: currentMember.value.phoneMasked,
      corporateShortName:
        reservationType.value === "enterprise"
          ? currentCorporate.value?.shortName
          : undefined,
      billingMode: billingMode.value,
      collectionMode: collectionMode.value
    });
    paymentDialogVisible.value = false;
    orderSuccessVisible.value = true;
  } catch {
    ElMessage.error("订单创建失败，请检查客户风控、企业授信和库存校验结果");
  } finally {
    newPayment.processing = false;
  }
}

function redeemCoupon() {
  if (!redeemCode.value.trim()) {
    ElMessage.warning("请输入优惠码");
    return;
  }
  selectedCouponId.value = "coupon_80";
  ElMessage.success("优惠码已兑换");
}

watch(
  [
    selectedGroupId,
    selectedMemberId,
    selectedMarketingPlanId,
    collectionMode,
    reservationType,
    selectedCorporateId,
    () => rentalData.pickupLocation,
    () => rentalData.returnLocation,
    () => rentalData.pickupTime,
    () => rentalData.returnTime,
    services
  ],
  refreshOrderPreview,
  { deep: true, immediate: true }
);

watch(
  reservationType,
  (value) => {
    if (value === "personal") {
      collectionMode.value = collectionMode.value === "monthly" ? "deposit" : collectionMode.value;
      selectedMarketingPlanId.value = "";
      return;
    }
    selectedMarketingPlanId.value = "";
    if (!currentCorporate.value) {
      selectedCorporateId.value = activeCorporates.value[0]?.id ?? "";
    }
  },
  { immediate: true }
);

watch(
  selectedMemberId,
  () => {
    pointsUsed.value = 0;
  }
);

watch(
  selectedCorporateId,
  () => {
    if (collectionMode.value === "monthly" && currentCorporate.value?.settlementMode !== "monthly") {
      collectionMode.value = "deposit";
    }
  }
);

watch(
  depositPayAmount,
  (amount) => {
    newPayment.amount = amount;
  },
  { immediate: true }
);

onMounted(() => {
  void loadCustomers();
  void loadMarketingPlanOptions();
});
</script>

<template>
  <AppLayout>
    <main class="custom-scroll relative z-0 bg-gray-50/50">
      <div class="w-full mx-auto">
        <div class="mb-4">
          <el-button icon="ArrowLeft" plain>返回</el-button>
        </div>

        <div class="grid grid-cols-12 gap-5 items-start">
          <div class="col-span-9 space-y-4">
            <div class="grid grid-cols-2 gap-4">
              <el-card shadow="never" class="!border-gray-200 !rounded-lg h-full flex flex-col" body-class="!p-4 flex-1">
                <template #header>
                  <div class="font-bold text-gray-800 flex items-center gap-2 text-base px-4 h-[45px] border-b border-gray-100 bg-gray-50/50">
                    <el-icon class="text-indigo-600"><User /></el-icon>
                    客户信息
                  </div>
                </template>
                <el-form label-position="top" size="default" v-loading="membersLoading">
                  <el-select v-model="selectedMemberId" placeholder="搜索会员 (姓名/手机号)" filterable class="w-full mb-3">
                    <el-option
                      v-for="member in memberRows"
                      :key="member.id"
                      :label="member.name + ' (' + member.phoneMasked + ')'"
                      :value="member.id"
                    >
                      <div class="flex justify-between items-center text-sm">
                        <span>{{ member.name }}</span>
                        <span class="text-gray-400 text-xs">{{ member.phoneMasked }}</span>
                      </div>
                    </el-option>
                  </el-select>

                  <div v-if="currentMember" class="space-y-3">
                    <div class="flex justify-between items-center bg-gray-50 p-2.5 rounded border border-gray-100">
                      <div>
                        <div class="font-bold text-gray-900 text-sm">{{ currentMember.name }}</div>
                        <div class="text-xs text-gray-500">{{ currentMember.phoneMasked }}</div>
                      </div>
                      <el-tag size="small" :type="memberLevelTagType(currentMember.levelName)" effect="plain">{{ currentMember.levelName }}</el-tag>
                    </div>

                    <div class="grid grid-cols-3 gap-2 text-[11px]">
                      <div class="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-slate-600">
                        会员状态：<span class="font-semibold text-slate-800">{{ currentMember.status }}</span>
                      </div>
                      <div class="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-slate-600">
                        认证：<span class="font-semibold text-slate-800">{{ currentMember.identityVerified && currentMember.driverLicenseVerified ? "已完成" : "待补充" }}</span>
                      </div>
                      <div class="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-slate-600">
                        积分：<span class="font-semibold text-slate-800">{{ currentMember.pointsBalance }}</span>
                      </div>
                    </div>

                    <div v-if="orderRiskWarnings.length" class="rounded border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                      <div v-for="warning in orderRiskWarnings" :key="warning" class="leading-5">
                        {{ warning }}
                      </div>
                    </div>

                    <div class="bg-gray-100 p-1 rounded-lg grid grid-cols-2 gap-1 border border-gray-200">
                      <div
                        class="cursor-pointer text-center py-1.5 text-xs font-bold rounded-md transition-all duration-200"
                        :class="reservationType === 'personal' ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-black/5' : 'text-gray-500 hover:text-gray-700'"
                        @click="reservationType = 'personal'"
                      >
                        个人预订
                      </div>
                      <div
                        class="cursor-pointer text-center py-1.5 text-xs font-bold rounded-md transition-all duration-200 relative select-none"
                        :class="[
                          reservationType === 'enterprise' ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-black/5' : 'text-gray-500 hover:text-gray-700',
                          !hasEnterpriseOption ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'
                        ]"
                        @click="hasEnterpriseOption && (reservationType = 'enterprise')"
                      >
                        企业预订
                      </div>
                    </div>

                    <div v-if="reservationType === 'enterprise'" class="space-y-2">
                      <el-select
                        v-model="selectedCorporateId"
                        filterable
                        placeholder="选择企业客户"
                        class="w-full"
                        v-loading="corporatesLoading"
                      >
                        <el-option
                          v-for="corporate in activeCorporates"
                          :key="corporate.id"
                          :label="corporate.shortName + ' / ' + corporate.contactName"
                          :value="corporate.id"
                        >
                          <div class="flex items-center justify-between gap-3">
                            <span>{{ corporate.shortName }}</span>
                            <span class="text-xs text-gray-400">授信 {{ corporate.creditLimitAmount }}</span>
                          </div>
                        </el-option>
                      </el-select>
                    </div>
                    <div v-if="reservationType === 'enterprise' && currentCorporate" class="text-xs text-indigo-600 bg-indigo-50 p-2 rounded text-center flex items-center justify-center gap-1 border border-indigo-100">
                      <el-icon><OfficeBuilding /></el-icon>
                      {{ currentCorporate.shortName }} · {{ currentCorporate.settlementMode === "monthly" ? "月结" : "预付" }}
                    </div>
                    <div v-if="reservationType === 'enterprise' && currentCorporate" class="text-[11px] leading-4 text-gray-500 bg-gray-50 p-2 rounded border border-gray-100">
                      {{ collectionMode === "monthly" ? "企业月结订单不发起支付或预授权，费用进入企业账单。" : "非月结企业预订使用企业资格行销方案，费用由客户本人支付，不支持优惠券和积分。" }}
                    </div>
                  </div>
                </el-form>
              </el-card>

              <el-card shadow="never" class="!border-gray-200 !rounded-lg h-full flex flex-col" body-class="!p-0 flex-1">
                <template #header>
                  <div class="font-bold text-gray-800 flex items-center gap-2 text-base px-4 h-[45px] border-b border-gray-100 bg-gray-50/50">
                    <el-icon class="text-indigo-600"><Calendar /></el-icon>
                    用车信息
                  </div>
                </template>
                <div class="p-4 space-y-3">
                  <div class="grid grid-cols-2 gap-3">
                    <div>
                      <div class="text-xs text-gray-500 mb-1">取车门店</div>
                      <el-select v-model="rentalData.pickupLocation" class="w-full">
                        <el-option v-for="store in stores" :key="store.code" :label="store.name" :value="store.code" />
                      </el-select>
                    </div>
                    <div>
                      <div class="text-xs text-gray-500 mb-1">取车时间</div>
                      <el-date-picker v-model="rentalData.pickupTime" type="datetime" placeholder="选择时间" class="w-full" style="width: 100%" />
                    </div>
                  </div>
                  <div class="grid grid-cols-2 gap-3">
                    <div>
                      <div class="text-xs text-gray-500 mb-1">还车门店</div>
                      <el-select v-model="rentalData.returnLocation" class="w-full">
                        <el-option v-for="store in stores" :key="store.code" :label="store.name" :value="store.code" />
                      </el-select>
                    </div>
                    <div>
                      <div class="text-xs text-gray-500 mb-1">还车时间</div>
                      <el-date-picker v-model="rentalData.returnTime" type="datetime" placeholder="选择时间" class="w-full" style="width: 100%" />
                    </div>
                  </div>
                <div class="text-xs bg-indigo-50 text-indigo-700 px-3 py-2 rounded border border-indigo-100">
                  预计租期：<span class="font-bold">{{ rentalDurationLabel }}</span>，计费：<span class="font-bold">{{ rentalBillingLabel }}</span>，按当前车组标准价试算。
                </div>
                <div class="text-xs bg-emerald-50 text-emerald-700 px-3 py-2 rounded border border-emerald-100">
                  可用性：<span class="font-bold">{{ selectedAvailability?.availableCount ?? "-" }}</span>
                  / {{ selectedAvailability?.totalCount ?? "-" }} 台可租
                  <span v-if="availabilityLoading" class="ml-1 text-gray-400">检查中...</span>
                  <div v-if="selectedAvailability?.warnings.length" class="mt-1 text-amber-600">
                    {{ selectedAvailability.warnings[0] }}
                  </div>
                </div>
                </div>
              </el-card>
            </div>

            <el-card shadow="never" class="!border-gray-200 !rounded-lg" body-class="!p-0">
              <template #header>
                <div class="font-bold text-gray-800 flex items-center gap-2 text-base px-4 h-[45px] border-b border-gray-100 bg-gray-50/50">
                  <el-icon class="text-indigo-600"><Van /></el-icon>
                  车组选择
                </div>
              </template>
              <div class="p-4">
                <div class="grid grid-cols-4 gap-3">
                  <div
                    v-for="group in groupRows"
                    :key="group.id"
                    class="cursor-pointer border rounded-lg p-3 relative hover:shadow-md transition-all duration-200 group bg-white"
                    :class="[
                      selectedGroupId === group.id ? 'border-indigo-500 bg-indigo-50/30' : 'border-gray-200 hover:border-indigo-300',
                      group.available <= 0 ? 'opacity-50 cursor-not-allowed bg-gray-50 hover:shadow-none hover:border-gray-200' : ''
                    ]"
                    @click="selectVehicleGroup(group)"
                  >
                    <div class="flex justify-between items-start mb-1">
                      <div class="font-bold text-gray-800 text-sm truncate pr-2">{{ group.name }}</div>
                      <el-tag size="small" :type="group.available > 0 ? 'success' : 'danger'" effect="light" class="!px-1 !h-5 !text-[10px]">
                        {{ group.available > 0 ? "剩" + group.available : "无库存" }}
                      </el-tag>
                    </div>
                    <div class="text-xs text-gray-500 truncate mb-2">{{ group.models }}</div>
                    <div class="flex items-end justify-between">
                      <div class="text-indigo-600 font-bold">
                        {{ group.dailyPrice }}<span class="text-xs font-normal text-gray-400">/天</span>
                      </div>
                      <div class="w-4 h-4 rounded-full border border-gray-300 flex items-center justify-center transition-colors" :class="{ 'bg-indigo-600 border-indigo-600': selectedGroupId === group.id }">
                        <el-icon v-if="selectedGroupId === group.id" class="text-white text-xs scale-75"><Check /></el-icon>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </el-card>

            <el-card shadow="never" class="!border-gray-200 !rounded-lg" body-class="!p-0">
              <template #header>
                <div class="font-bold text-gray-800 flex items-center gap-2 text-base px-4 h-[45px] border-b border-gray-100 bg-gray-50/50">
                  <el-icon class="text-indigo-600"><Goods /></el-icon>
                  增值服务
                </div>
              </template>
              <div class="p-0">
                <div class="grid grid-cols-2 divide-x divide-gray-100">
                  <div
                    v-for="service in services"
                    :key="service.id"
                    class="p-3 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-100"
                    :class="{ 'bg-indigo-50/30': service.selected }"
                  >
                    <el-checkbox v-model="service.selected" size="default">
                      <span class="text-sm text-gray-700 font-medium">{{ service.name }}</span>
                    </el-checkbox>
                    <div class="flex items-center gap-3">
                      <div class="text-gray-900 font-bold text-sm">¥{{ service.price }}{{ service.unit }}</div>
                      <el-input-number v-if="service.maxQuantity > 1" v-model="service.quantity" :min="1" :max="service.maxQuantity" size="small" controls-position="right" class="!w-20" :disabled="!service.selected" />
                    </div>
                  </div>
                </div>
              </div>
            </el-card>
          </div>

          <div class="col-span-3">
            <div class="sticky-summary space-y-4">
              <el-card shadow="hover" class="!border-indigo-100 !rounded-lg" body-class="!p-0">
                <template #header>
                  <div class="font-bold text-gray-800 flex items-center gap-2 text-base px-4 h-[45px] border-b border-indigo-50 bg-indigo-50/20">
                    <el-icon class="text-indigo-600"><Ticket /></el-icon>
                    优惠与折扣
                  </div>
                </template>
                <div class="p-4 space-y-4">
                  <div class="space-y-1">
                    <div class="text-xs font-bold text-gray-600">行销优惠方案</div>
                    <el-select v-model="selectedMarketingPlanId" size="default" class="w-full" :disabled="!currentMember">
                      <el-option label="不使用方案" value="none" />
                      <el-option v-for="plan in availableMarketingPlans.filter((plan) => plan.id !== 'none')" :key="plan.id" :label="plan.name" :value="plan.id">
                        <div class="flex items-center justify-between gap-3">
                          <span>{{ plan.name }}</span>
                          <el-tag v-if="plan.manualVerification" size="small" type="warning" effect="plain">取车核验</el-tag>
                        </div>
                      </el-option>
                    </el-select>
                    <div class="text-[11px] text-gray-400 leading-4">{{ currentMember ? marketingPlanEligibilityLabel : "选择客户后展示可用方案" }}</div>
                    <div v-if="selectedMarketingPlan?.manualVerification" class="text-[11px] text-amber-600 leading-4 bg-amber-50 border border-amber-100 rounded px-2 py-1">
                      该方案需取车时现场核验 {{ selectedMarketingPlan.qualificationName }}，未通过时门店会更换方案并重新计算费用。
                    </div>
                  </div>

                  <div v-if="canUsePersonalBenefits" class="space-y-2">
                    <div class="text-xs font-bold text-gray-600">优惠券</div>
                    <div class="flex gap-2">
                      <el-select v-model="selectedCouponId" placeholder="选择优惠券" size="default" class="w-full" clearable :disabled="!currentMember">
                        <el-option v-for="coupon in customerCoupons" :key="coupon.id" :label="coupon.name" :value="coupon.id">
                          <span class="float-left text-sm">{{ coupon.name }}</span>
                          <span class="float-right text-gray-400 text-xs">{{ coupon.desc }}</span>
                        </el-option>
                      </el-select>
                      <el-button :icon="showRedeemInput ? 'Minus' : 'Plus'" circle size="default" plain @click="showRedeemInput = !showRedeemInput" />
                    </div>
                    <div v-if="showRedeemInput" class="flex gap-2">
                      <el-input v-model="redeemCode" placeholder="输入优惠码兑换" size="default" class="flex-1" />
                      <el-button size="default" plain class="!px-4" @click="redeemCoupon">兑换</el-button>
                    </div>
                  </div>

                  <div v-if="canUsePersonalBenefits" class="space-y-1">
                    <div class="flex justify-between items-center">
                      <div class="text-xs text-gray-600 font-bold">
                        积分抵扣 <span class="font-normal text-gray-400">(余{{ currentMember ? currentMember.pointsBalance : 0 }})</span>
                      </div>
                    </div>
                    <div class="flex items-center gap-2">
                      <el-input-number v-model="pointsUsed" :min="0" :max="currentMember ? currentMember.pointsBalance : 0" :step="100" size="default" class="!w-full" :disabled="!currentMember" controls-position="right" />
                      <div class="text-orange-500 font-bold text-sm w-16 text-right whitespace-nowrap">-{{ pointsAmount }}</div>
                    </div>
                  </div>
                  <div v-else class="rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-xs text-indigo-700 leading-5">
                    企业身份订单只使用企业资格行销方案，不支持优惠券、兑换码和积分抵扣。
                  </div>
                </div>
              </el-card>

              <el-card shadow="hover" class="!border-indigo-100 !bg-slate-50/50 !rounded-lg" body-class="!p-0">
                <template #header>
                  <div class="font-bold text-gray-900 text-base px-4 h-[45px] flex items-center border-b border-indigo-100">费用明细</div>
                </template>
                <div class="p-4">
                  <div class="space-y-2 text-sm">
                    <div class="flex justify-between text-gray-600">
                      <span>租金 ({{ rentalBillingLabel }})</span>
                      <span class="font-medium">{{ baseRentalTotal }}</span>
                    </div>

                    <template v-if="services.some((service) => service.selected)">
                      <div class="text-xs font-bold text-gray-400 mt-2 mb-1">增值服务</div>
                      <div v-for="service in services" :key="service.id">
                        <div v-if="service.selected" class="flex justify-between text-gray-600 pl-2">
                          <span>
                            {{ service.name }}
                            <span v-if="service.quantity > 1" class="text-xs text-gray-400">x{{ service.quantity }}</span>
                          </span>
                          <span class="font-medium">{{ calculateServicePrice(service) }}</span>
                        </div>
                      </div>
                    </template>

                    <div v-if="discountAmountValue > 0 || couponAmountValue > 0 || pointsAmountValue > 0" class="border-t border-dashed border-gray-200 my-2 pt-2">
                      <div v-if="discountAmountValue > 0" class="flex justify-between text-green-600 text-xs">
                        <span>优惠金额</span>
                        <span>- {{ discountAmount }}</span>
                      </div>
                      <div v-if="couponAmountValue > 0" class="flex justify-between text-green-600 text-xs">
                        <span>优惠券</span>
                        <span>- {{ couponAmount }}</span>
                      </div>
                      <div v-if="pointsAmountValue > 0" class="flex justify-between text-orange-500 text-xs">
                        <span>积分</span>
                        <span>- {{ pointsAmount }}</span>
                      </div>
                    </div>
                  </div>

                  <div class="border-t border-gray-200 mt-4 pt-3">
                    <div class="flex justify-between items-baseline">
                      <span class="text-gray-600 text-sm">总计</span>
                      <span class="text-2xl font-bold text-indigo-600">{{ finalTotal }}</span>
                    </div>
                    <div v-if="latestQuote" class="mt-2 rounded border border-indigo-100 bg-indigo-50 px-2 py-1.5 text-[11px] text-indigo-700 leading-4">
                      价格版本：{{ latestQuote.snapshots.priceVersionId }} ·
                      行销版本：{{ latestQuote.snapshots.marketingPlanVersionId || "未使用" }} ·
                      会员等级：{{ latestQuote.snapshots.membershipPlanName || "未使用" }}
                    </div>
                    <div v-if="latestQuote && quoteHasRuleTrace" class="mt-3 border-t border-dashed border-gray-200 pt-3">
                      <div class="flex items-center justify-between text-xs font-bold text-gray-700">
                        <span>报价命中说明</span>
                        <span class="text-[11px] text-gray-400">{{ latestQuote.quoteNo }}</span>
                      </div>
                      <div v-if="quoteExplanationLines.length" class="mt-2 space-y-1.5">
                        <div v-for="line in quoteExplanationLines" :key="line.code" class="rounded bg-gray-50 px-2 py-1.5 text-[11px] leading-4">
                          <div class="flex justify-between gap-2">
                            <span class="font-medium text-gray-700">{{ line.title }}</span>
                            <span :class="line.amount < 0 ? 'text-green-600' : line.amount > 0 ? 'text-orange-600' : 'text-gray-400'">
                              {{ formatSignedAmount(line.amount) }}
                            </span>
                          </div>
                          <div class="mt-0.5 text-gray-500">{{ line.detail }}</div>
                        </div>
                      </div>
                      <div v-if="quoteBillingSegments.length" class="mt-2">
                        <div class="text-[11px] font-bold text-gray-400 mb-1">每日计费分段</div>
                        <div class="max-h-28 overflow-y-auto rounded border border-gray-100 bg-white">
                          <div
                            v-for="segment in quoteBillingSegments"
                            :key="`${segment.date}-${segment.dayType}`"
                            class="grid grid-cols-[1fr_auto] gap-2 border-b border-gray-50 px-2 py-1.5 text-[11px] last:border-b-0"
                          >
                            <div class="min-w-0">
                              <div class="truncate text-gray-700">{{ segment.date }} · {{ quoteDayTypeLabel(segment.dayType) }}</div>
                              <div class="truncate text-gray-400">{{ segment.marketingActionLabel || "按标准价" }}</div>
                            </div>
                            <div class="text-right">
                              <div class="font-medium text-gray-700">{{ formatNumber(segment.baseDailyAmount) }}</div>
                              <div v-if="segment.discountAmount > 0" class="text-green-600">- {{ formatNumber(segment.discountAmount) }}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div class="mt-2 flex items-center justify-between text-xs bg-blue-50 text-blue-700 px-2 py-1.5 rounded border border-blue-100">
                      <span>本次押金/预授权</span>
                      <span class="font-bold">{{ depositPayAmountText }}</span>
                    </div>
                  </div>

                  <el-button type="primary" size="large" color="#00689E" class="w-full mt-4 !rounded-lg !h-10 !text-base !font-bold shadow-lg shadow-[#00689E]/20" @click="submitOrder">
                    创建订单
                  </el-button>
                </div>
              </el-card>
            </div>
          </div>
        </div>
      </div>
    </main>

    <el-dialog
      v-model="paymentDialogVisible"
      :title="collectionMode === 'monthly' ? '创建企业月结订单' : collectionMode === 'pending' ? '创建待支付订单' : '添加预授权押金'"
      width="500px"
      destroy-on-close
      top="15vh"
      class="rounded-xl overflow-hidden"
      :close-on-click-modal="false"
    >
      <div class="p-1">
        <div class="mb-5">
          <div class="text-sm font-medium text-gray-700 mb-2">收款模式</div>
          <div class="grid grid-cols-3 gap-2">
            <div class="p-3 rounded-lg border cursor-pointer text-center transition-all" :class="collectionMode === 'deposit' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-gray-200 text-gray-600 hover:border-orange-200'" @click="setCollectionMode('deposit')">
              <div class="font-bold text-sm">预授权押金</div>
              <div class="text-xs mt-1">按规则配置</div>
            </div>
            <div class="p-3 rounded-lg border cursor-pointer text-center transition-all" :class="collectionMode === 'pending' ? 'border-red-500 bg-red-50 text-red-700' : 'border-gray-200 text-gray-600 hover:border-red-200'" @click="setCollectionMode('pending')">
              <div class="font-bold text-sm">暂不收款</div>
              <div class="text-xs mt-1">生成待支付</div>
            </div>
            <div
              class="p-3 rounded-lg border text-center transition-all"
              :class="[
                collectionMode === 'monthly' ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-200 text-gray-600',
                reservationType !== 'enterprise' || currentCorporate?.settlementMode !== 'monthly'
                  ? 'opacity-50 cursor-not-allowed'
                  : 'cursor-pointer hover:border-purple-200'
              ]"
              @click="setCollectionMode('monthly')"
            >
              <div class="font-bold text-sm">企业月结</div>
              <div class="text-xs mt-1">本次不收款</div>
            </div>
          </div>
        </div>

        <template v-if="collectionMode === 'deposit'">
          <div class="rounded-lg border border-blue-100 bg-blue-50 text-blue-700 text-sm px-3 py-2 mb-5">
            本期下单预授权押金仅支持线上预授权，不支持现金押金、线下押金或仅登记线下凭证。
          </div>
          <div class="space-y-4">
            <div class="text-sm font-medium text-gray-700 mb-2">选择支付渠道</div>
            <div class="grid grid-cols-2 gap-3">
              <div class="p-4 rounded-xl border-2 cursor-pointer transition-all relative" :class="newPayment.gateway === 'jiekou' ? 'border-orange-500 bg-orange-50 shadow-sm' : 'border-gray-200 hover:border-gray-300'" @click="newPayment.gateway = 'jiekou'">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                    <span class="text-orange-500 text-lg font-bold">街</span>
                  </div>
                  <div>
                    <div class="font-medium text-gray-800">街口支付</div>
                    <div class="text-xs text-gray-400">线上扫码</div>
                  </div>
                </div>
                <el-icon v-if="newPayment.gateway === 'jiekou'" class="absolute top-2 right-2 text-orange-500"><CircleCheck /></el-icon>
              </div>

              <div class="p-4 rounded-xl border-2 cursor-pointer transition-all relative" :class="newPayment.gateway === 'credit_card' ? 'border-indigo-500 bg-indigo-50 shadow-sm' : 'border-gray-200 hover:border-gray-300'" @click="newPayment.gateway = 'credit_card'">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                    <el-icon class="text-indigo-500 text-lg"><CreditCard /></el-icon>
                  </div>
                  <div>
                    <div class="font-medium text-gray-800">信用卡</div>
                    <div class="text-xs text-gray-400">用户绑定卡</div>
                  </div>
                </div>
                <el-icon v-if="newPayment.gateway === 'credit_card'" class="absolute top-2 right-2 text-indigo-500"><CircleCheck /></el-icon>
              </div>
            </div>

            <div v-if="newPayment.gateway === 'credit_card'" class="mt-4 p-4 bg-gray-50 rounded-xl border border-gray-200">
              <div class="text-sm font-medium text-gray-700 mb-3">选择信用卡</div>
              <div class="space-y-2">
                <div
                  v-for="card in userCreditCards"
                  :key="card.id"
                  class="p-3 bg-white rounded-lg border-2 cursor-pointer transition-all flex justify-between items-center"
                  :class="selectedCreditCard === card.id ? 'border-indigo-500 shadow-sm' : 'border-gray-100 hover:border-gray-300'"
                  @click="selectedCreditCard = card.id"
                >
                  <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded flex items-center justify-center" :class="card.brand === 'Visa' ? 'bg-blue-100' : 'bg-orange-100'">
                      <span class="text-xs font-bold" :class="card.brand === 'Visa' ? 'text-blue-600' : 'text-orange-600'">{{ card.brand.substring(0, 2) }}</span>
                    </div>
                    <div>
                      <div class="font-mono text-gray-800">**** **** **** {{ card.last4 }}</div>
                      <div class="text-xs text-gray-400">有效期: {{ card.expiry }}</div>
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    <el-tag v-if="card.isDefault" size="small" type="success" effect="plain">默认卡</el-tag>
                    <el-icon v-if="selectedCreditCard === card.id" class="text-indigo-500"><CircleCheck /></el-icon>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="mt-6 p-4 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl border border-indigo-100">
            <div class="flex justify-between items-center mb-3">
              <span class="text-sm font-medium text-gray-700">本次预授权金额</span>
              <span class="text-xs text-gray-400">订单总额: {{ formatNumber(finalTotalValue) }}</span>
            </div>
            <el-input-number v-model="newPayment.amount" :min="0" :max="depositPayAmount" :controls="false" class="w-full" size="large" :precision="0" disabled />
            <div class="text-xs text-indigo-500 mt-2">{{ preAuthRuleText }}，剩余租金在取车时补足，还车只处理差额结算。</div>
          </div>
        </template>

        <div v-else-if="collectionMode === 'pending'" class="p-4 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
          暂不收款模式下，本次创建订单不发起预授权。订单创建后状态为“待支付”，支付状态为“未支付”，车组库存保留30分钟；超时未完成预授权时自动取消并释放库存。
        </div>
        <div v-else class="p-4 bg-purple-50 border border-purple-100 rounded-xl text-sm text-purple-700">
          企业月结模式下，本次创建订单不发起支付、不发起预授权。订单创建后状态为“已预订”，支付状态为“企业月结”，最终费用进入企业月结账单。
        </div>

        <div class="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div class="bg-gray-50 border border-gray-100 rounded-lg p-3">
            <div class="text-gray-400 mb-1">订单总额</div>
            <div class="font-bold text-gray-800">{{ formatNumber(finalTotalValue) }}</div>
          </div>
          <div class="bg-blue-50 border border-blue-100 rounded-lg p-3">
            <div class="text-blue-500 mb-1">本次押金/预授权</div>
            <div class="font-bold text-blue-700">{{ depositPayAmountText }}</div>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="flex gap-3">
          <el-button class="flex-1" size="large" @click="paymentDialogVisible = false">取消</el-button>
          <el-button type="primary" class="flex-1" size="large" :loading="newPayment.processing" @click="confirmPayment">
            {{ collectionMode === "monthly" || collectionMode === "pending" ? "确认创建" : "发起预授权" }}
          </el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog v-model="orderSuccessVisible" title="订单创建成功" width="520px" center destroy-on-close :close-on-click-modal="false">
      <div class="space-y-4">
        <div class="text-center">
          <div class="mx-auto w-14 h-14 rounded-full bg-green-100 text-green-600 flex items-center justify-center mb-3">
            <el-icon class="text-3xl"><CircleCheck /></el-icon>
          </div>
          <div class="font-bold text-gray-900 text-lg">{{ createdOrder.orderNo }}</div>
          <div class="text-xs text-gray-500 mt-1">
            {{ createdOrder.mainStatus === "pending_payment" ? "车组库存已临时保留30分钟，待支付完成后进入正常派车，并已保存订单快照版本。" : "车组库存已锁定，订单已写入门市租车订单列表，并保存订单计费快照和规则快照。" }}
          </div>
        </div>
        <div class="grid grid-cols-3 gap-3 text-center">
          <div class="rounded-lg bg-gray-50 border border-gray-100 p-3">
            <div class="text-xs text-gray-400 mb-1">主状态</div>
            <div class="font-bold text-gray-800">{{ createdOrder.mainStatus }}</div>
          </div>
          <div class="rounded-lg bg-gray-50 border border-gray-100 p-3">
            <div class="text-xs text-gray-400 mb-1">支付状态</div>
            <div class="font-bold text-gray-800">{{ createdOrder.paymentStatus }}</div>
          </div>
          <div class="rounded-lg bg-gray-50 border border-gray-100 p-3">
            <div class="text-xs text-gray-400 mb-1">派车状态</div>
            <div class="font-bold text-gray-800">{{ createdOrder.dispatchStatus }}</div>
          </div>
        </div>
        <div class="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
          报价号：{{ createdOrder.quoteNo }} · 价格版本：{{ createdOrder.snapshots.priceVersionId || createdOrder.snapshots.pricingVersion }} · 行销版本：{{ createdOrder.snapshots.marketingPlanVersionId || "未使用" }} · 规则版本：{{ createdOrder.snapshots.ruleVersion }}
        </div>
      </div>
      <template #footer>
        <el-button type="primary" color="#00689E" @click="orderSuccessVisible = false">知道了</el-button>
      </template>
    </el-dialog>
  </AppLayout>
</template>
