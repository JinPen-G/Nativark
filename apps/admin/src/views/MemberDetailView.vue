<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { MemberDetail, SaveMemberRequest } from "@store-rental/shared";
import { getMemberDetail, processMemberRisk, saveMember } from "../api/client";
import AppLayout from "../components/AppLayout.vue";
import { useAuthStore } from "../stores/auth";

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const loading = ref(false);
const saving = ref(false);
const member = ref<MemberDetail | null>(null);

const form = reactive<SaveMemberRequest>({
  name: "",
  phone: "",
  source: "营运端录入",
  levelName: "白银会员",
  status: "pending_review",
  tags: [],
  identityVerified: false,
  driverLicenseVerified: false
});
const tagsText = ref("");

const isCreate = computed(() => route.params.id === "new");
const canRunRiskAction = computed(() =>
  authStore.hasAnyPermission([
    "store-rental:member:manage",
    "store-rental:member:risk-action"
  ])
);

function applyDetail(detail: MemberDetail) {
  member.value = detail;
  Object.assign(form, {
    id: detail.id,
    name: detail.name,
    phone: detail.phone,
    email: detail.email,
    source: detail.source,
    levelName: detail.levelName,
    status: detail.status,
    tags: detail.tags,
    identityVerified: detail.identityVerified,
    driverLicenseVerified: detail.driverLicenseVerified,
    identityNoMasked: detail.identityNoMasked,
    driverLicenseNoMasked: detail.driverLicenseNoMasked,
    birthday: detail.birthday,
    emergencyContactName: detail.emergencyContactName,
    emergencyContactPhone: detail.emergencyContactPhone,
    notes: detail.notes,
    riskNote: detail.riskNote
  });
  tagsText.value = detail.tags.join("、");
}

async function loadData() {
  if (isCreate.value) {
    member.value = null;
    Object.assign(form, {
      id: undefined,
      name: "",
      phone: "",
      email: "",
      source: "营运端录入",
      levelName: "白银会员",
      status: "pending_review",
      tags: [],
      identityVerified: false,
      driverLicenseVerified: false,
      identityNoMasked: "",
      driverLicenseNoMasked: "",
      birthday: "",
      emergencyContactName: "",
      emergencyContactPhone: "",
      notes: "",
      riskNote: ""
    });
    tagsText.value = "";
    return;
  }

  loading.value = true;
  try {
    const detail = await getMemberDetail(String(route.params.id));
    applyDetail(detail);
  } finally {
    loading.value = false;
  }
}

async function submit() {
  if (!form.name || !form.phone) {
    ElMessage.warning("请填写会员姓名和手机号");
    return;
  }

  saving.value = true;
  try {
    const saved = await saveMember({
      ...form,
      tags: tagsText.value
        .split(/[、,，]/)
        .map((item) => item.trim())
        .filter(Boolean)
    });
    applyDetail(saved);
    ElMessage.success("会员资料已保存");
    if (isCreate.value) {
      await router.replace(`/members/${saved.id}`);
    }
  } catch {
    ElMessage.error("会员资料保存失败");
  } finally {
    saving.value = false;
  }
}

async function runRiskAction(action: "suspend" | "blacklist" | "restore") {
  if (!member.value) {
    return;
  }
  if (!canRunRiskAction.value) {
    ElMessage.warning("当前角色没有会员风控动作权限");
    return;
  }

  const actionText = {
    suspend: "暂停租车资格",
    blacklist: "加入黑名单",
    restore: "恢复租车资格"
  }[action];
  try {
    const result = await ElMessageBox.prompt(`请输入${actionText}原因`, actionText, {
      confirmButtonText: "确认",
      cancelButtonText: "取消",
      inputPattern: /\S+/,
      inputErrorMessage: "必须填写原因"
    });
    const response = await processMemberRisk(member.value.id, {
      action,
      reason: result.value,
      operator: "营运风控"
    });
    applyDetail(response.member);
    ElMessage.success(response.message);
  } catch {
    // 用户取消时不提示。
  }
}

onMounted(loadData);
</script>

<template>
  <AppLayout>
    <div class="flex justify-between items-end mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-800">{{ isCreate ? "新增会员" : "会员详情" }}</h1>
        <p class="text-sm text-gray-500 mt-1">维护会员基础信息、认证状态、风险备注和历史记录。</p>
      </div>
      <div class="flex gap-3">
        <el-button @click="router.push('/members')">返回列表</el-button>
        <el-button
          v-if="canRunRiskAction && member && member.status === 'active'"
          type="warning"
          plain
          @click="runRiskAction('suspend')"
        >
          暂停资格
        </el-button>
        <el-button
          v-if="canRunRiskAction && member && member.status !== 'blacklisted'"
          type="danger"
          plain
          @click="runRiskAction('blacklist')"
        >
          加入黑名单
        </el-button>
        <el-button
          v-if="canRunRiskAction && member && ['suspended', 'blacklisted'].includes(member.status)"
          type="success"
          plain
          @click="runRiskAction('restore')"
        >
          恢复资格
        </el-button>
        <el-button type="primary" color="#00689E" :loading="saving" @click="submit">保存</el-button>
      </div>
    </div>

    <div v-loading="loading" class="grid grid-cols-12 gap-5">
      <div class="col-span-12 xl:col-span-8 sr-card p-5">
        <el-form label-position="top">
          <div class="grid grid-cols-12 gap-4">
            <el-form-item label="会员姓名" required class="col-span-12 md:col-span-4">
              <el-input v-model="form.name" />
            </el-form-item>
            <el-form-item label="手机号" required class="col-span-12 md:col-span-4">
              <el-input v-model="form.phone" />
            </el-form-item>
            <el-form-item label="来源" class="col-span-12 md:col-span-4">
              <el-select v-model="form.source" class="w-full">
                <el-option label="H5 注册" value="H5 注册" />
                <el-option label="门店录入" value="门店录入" />
                <el-option label="企业导入" value="企业导入" />
                <el-option label="营运端录入" value="营运端录入" />
              </el-select>
            </el-form-item>
            <el-form-item label="会员等级" class="col-span-12 md:col-span-4">
              <el-select v-model="form.levelName" class="w-full">
                <el-option label="白银会员" value="白银会员" />
                <el-option label="黄金会员" value="黄金会员" />
                <el-option label="黑金会员" value="黑金会员" />
              </el-select>
            </el-form-item>
            <el-form-item label="会员状态" class="col-span-12 md:col-span-4">
              <el-select v-model="form.status" class="w-full">
                <el-option label="待审核" value="pending_review" />
                <el-option label="正常" value="active" />
                <el-option label="已暂停" value="suspended" />
                <el-option label="黑名单" value="blacklisted" />
              </el-select>
            </el-form-item>
            <el-form-item label="标签" class="col-span-12 md:col-span-4">
              <el-input v-model="tagsText" placeholder="多个标签用 、 分隔" />
            </el-form-item>
            <el-form-item label="邮箱" class="col-span-12 md:col-span-6">
              <el-input v-model="form.email" />
            </el-form-item>
            <el-form-item label="生日" class="col-span-12 md:col-span-6">
              <el-input v-model="form.birthday" placeholder="YYYY-MM-DD" />
            </el-form-item>
            <el-form-item label="身份证号" class="col-span-12 md:col-span-6">
              <el-input v-model="form.identityNoMasked" />
            </el-form-item>
            <el-form-item label="驾驶证号" class="col-span-12 md:col-span-6">
              <el-input v-model="form.driverLicenseNoMasked" />
            </el-form-item>
            <el-form-item label="紧急联系人" class="col-span-12 md:col-span-6">
              <el-input v-model="form.emergencyContactName" />
            </el-form-item>
            <el-form-item label="紧急联系人电话" class="col-span-12 md:col-span-6">
              <el-input v-model="form.emergencyContactPhone" />
            </el-form-item>
            <el-form-item class="col-span-12 md:col-span-6">
              <template #label>认证状态</template>
              <div class="flex gap-6 mt-2">
                <el-checkbox v-model="form.identityVerified">身份证已认证</el-checkbox>
                <el-checkbox v-model="form.driverLicenseVerified">驾驶证已认证</el-checkbox>
              </div>
            </el-form-item>
            <el-form-item label="风控备注" class="col-span-12">
              <el-input v-model="form.riskNote" type="textarea" :rows="3" />
            </el-form-item>
            <el-form-item label="内部备注" class="col-span-12">
              <el-input v-model="form.notes" type="textarea" :rows="4" />
            </el-form-item>
          </div>
        </el-form>
      </div>

      <div class="col-span-12 xl:col-span-4 space-y-5">
        <div class="sr-card p-5" v-if="member">
          <div class="text-sm font-semibold text-gray-800">会员概览</div>
          <div class="mt-4 space-y-3 text-sm">
            <div class="flex justify-between"><span class="text-gray-500">会员状态</span><span>{{ member.status }}</span></div>
            <div class="flex justify-between"><span class="text-gray-500">认证状态</span><span>{{ member.identityVerified && member.driverLicenseVerified ? "已认证" : "待补充" }}</span></div>
            <div v-if="member.riskNote" class="rounded border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {{ member.riskNote }}
            </div>
            <div class="flex justify-between"><span class="text-gray-500">注册时间</span><span>{{ member.registerAt }}</span></div>
            <div class="flex justify-between"><span class="text-gray-500">累计订单</span><span>{{ member.totalOrders }}</span></div>
            <div class="flex justify-between"><span class="text-gray-500">累计消费</span><span>¥{{ member.totalSpendAmount }}</span></div>
            <div>
              <div class="text-gray-500 mb-2">最近订单</div>
              <el-tag v-for="orderNo in member.recentOrderNos" :key="orderNo" class="mr-2 mb-2" effect="plain">
                {{ orderNo }}
              </el-tag>
            </div>
          </div>
        </div>

        <div class="sr-card p-5" v-if="member">
          <div class="text-sm font-semibold text-gray-800 mb-4">操作记录</div>
          <el-timeline>
            <el-timeline-item
              v-for="item in member.timeline"
              :key="item.id"
              :timestamp="item.at"
              placement="top"
            >
              <div class="font-medium text-gray-800">{{ item.action }}</div>
              <div class="text-xs text-gray-500 mt-1">{{ item.operator }} · {{ item.remark || "无备注" }}</div>
            </el-timeline-item>
          </el-timeline>
        </div>
      </div>
    </div>
  </AppLayout>
</template>
