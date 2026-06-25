<script setup lang="ts">
import { ElMessage } from "element-plus";
import { onMounted, reactive, ref } from "vue";
import type { MembershipPlanSummary, SaveMembershipPlanRequest } from "@store-rental/shared";
import { listMembershipPlans, saveMembershipPlan } from "../api/client";
import AppLayout from "../components/AppLayout.vue";

const rows = ref<MembershipPlanSummary[]>([]);
const loading = ref(false);
const saving = ref(false);
const dialogVisible = ref(false);
const form = reactive<SaveMembershipPlanRequest>({
  code: "",
  name: "",
  tierRank: 1,
  status: "enabled",
  upgradeCondition: "",
  benefitSummary: "",
  orderDiscountPercent: 0,
  depositDiscountPercent: 0,
  freeServiceCount: 0
});

async function loadData() {
  loading.value = true;
  try {
    rows.value = await listMembershipPlans();
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  Object.assign(form, {
    id: undefined,
    code: "",
    name: "",
    tierRank: rows.value.length + 1,
    status: "enabled",
    upgradeCondition: "",
    benefitSummary: "",
    orderDiscountPercent: 0,
    depositDiscountPercent: 0,
    freeServiceCount: 0
  });
  dialogVisible.value = true;
}

function openEdit(row: MembershipPlanSummary) {
  Object.assign(form, row);
  dialogVisible.value = true;
}

async function submit() {
  saving.value = true;
  try {
    await saveMembershipPlan(form);
    ElMessage.success("等级方案已保存");
    dialogVisible.value = false;
    await loadData();
  } catch {
    ElMessage.error("等级方案保存失败");
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
        <h1 class="text-2xl font-bold text-gray-800">客户等级方案</h1>
        <p class="text-sm text-gray-500 mt-1">维护会员等级、升级条件和权益策略。</p>
      </div>
      <el-button type="primary" color="#00689E" @click="openCreate">新增等级</el-button>
    </div>

    <div class="sr-card p-5">
      <el-table v-loading="loading" :data="rows" stripe>
        <el-table-column prop="name" label="等级名称" min-width="160" />
        <el-table-column prop="code" label="等级编码" width="160" />
        <el-table-column prop="tierRank" label="层级" width="80" align="center" />
        <el-table-column label="权益摘要" min-width="260" prop="benefitSummary" />
        <el-table-column label="升级条件" min-width="240" prop="upgradeCondition" />
        <el-table-column label="租金折扣" width="100" align="right">
          <template #default="{ row }">{{ row.orderDiscountPercent }}%</template>
        </el-table-column>
        <el-table-column label="押金折扣" width="100" align="right">
          <template #default="{ row }">{{ row.depositDiscountPercent }}%</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'enabled' ? 'success' : 'info'" effect="plain">
              {{ row.status === "enabled" ? "启用" : "停用" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" align="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" :title="form.id ? '编辑等级方案' : '新增等级方案'" width="720px">
      <el-form label-position="top">
        <div class="grid grid-cols-12 gap-4">
          <el-form-item label="等级编码" class="col-span-12 md:col-span-4">
            <el-input v-model="form.code" />
          </el-form-item>
          <el-form-item label="等级名称" class="col-span-12 md:col-span-4">
            <el-input v-model="form.name" />
          </el-form-item>
          <el-form-item label="层级" class="col-span-12 md:col-span-4">
            <el-input-number v-model="form.tierRank" :min="1" class="w-full" />
          </el-form-item>
          <el-form-item label="升级条件" class="col-span-12">
            <el-input v-model="form.upgradeCondition" />
          </el-form-item>
          <el-form-item label="权益摘要" class="col-span-12">
            <el-input v-model="form.benefitSummary" type="textarea" :rows="3" />
          </el-form-item>
          <el-form-item label="租金折扣 (%)" class="col-span-12 md:col-span-4">
            <el-input-number v-model="form.orderDiscountPercent" :min="0" :max="100" class="w-full" />
          </el-form-item>
          <el-form-item label="押金折扣 (%)" class="col-span-12 md:col-span-4">
            <el-input-number v-model="form.depositDiscountPercent" :min="0" :max="100" class="w-full" />
          </el-form-item>
          <el-form-item label="免服务次数" class="col-span-12 md:col-span-4">
            <el-input-number v-model="form.freeServiceCount" :min="0" class="w-full" />
          </el-form-item>
          <el-form-item label="状态" class="col-span-12">
            <el-radio-group v-model="form.status">
              <el-radio-button label="enabled">启用</el-radio-button>
              <el-radio-button label="disabled">停用</el-radio-button>
            </el-radio-group>
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" color="#00689E" :loading="saving" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </AppLayout>
</template>
