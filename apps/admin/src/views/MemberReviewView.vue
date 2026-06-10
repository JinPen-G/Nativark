<script setup lang="ts">
import { ElMessage } from "element-plus";
import { onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import type { MemberDetail, MemberReviewTask } from "@rimo/shared";
import { getMemberDetail, listMemberReviews, processMemberReview } from "../api/client";
import AppLayout from "../components/AppLayout.vue";

const route = useRoute();
const loading = ref(false);
const actionLoading = ref(false);
const rows = ref<MemberReviewTask[]>([]);
const currentReview = ref<MemberReviewTask | null>(null);
const currentMember = ref<MemberDetail | null>(null);
const drawerVisible = ref(false);
const reviewForm = reactive({
  action: "approve" as "approve" | "reject",
  remark: ""
});

async function loadRows() {
  loading.value = true;
  try {
    rows.value = await listMemberReviews();
    const memberId = String(route.query.memberId || "");
    if (memberId) {
      const match = rows.value.find((row) => row.memberId === memberId);
      if (match) {
        await openReview(match);
      }
    }
  } finally {
    loading.value = false;
  }
}

async function openReview(row: MemberReviewTask) {
  currentReview.value = row;
  currentMember.value = await getMemberDetail(row.memberId);
  reviewForm.action = row.reviewStatus === "rejected" ? "reject" : "approve";
  reviewForm.remark = row.remark || "";
  drawerVisible.value = true;
}

async function submit() {
  if (!currentReview.value) {
    return;
  }

  actionLoading.value = true;
  try {
    await processMemberReview(currentReview.value.id, {
      action: reviewForm.action,
      remark: reviewForm.remark,
      operator: "营运端审核"
    });
    ElMessage.success(reviewForm.action === "approve" ? "会员审核已通过" : "会员审核已驳回");
    drawerVisible.value = false;
    await loadRows();
  } catch {
    ElMessage.error("会员审核处理失败");
  } finally {
    actionLoading.value = false;
  }
}

onMounted(loadRows);
</script>

<template>
  <AppLayout>
    <div class="flex justify-between items-end mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-800">会员审核</h1>
        <p class="text-sm text-gray-500 mt-1">核验身份证、驾驶证、风险标签和资料完整性。</p>
      </div>
      <el-button @click="loadRows">刷新</el-button>
    </div>

    <div class="rimo-card p-5">
      <el-table v-loading="loading" :data="rows" stripe>
        <el-table-column prop="memberName" label="会员姓名" min-width="160" />
        <el-table-column prop="phoneMasked" label="手机号" width="140" />
        <el-table-column prop="submittedAt" label="提交时间" width="190" />
        <el-table-column label="风险标记" min-width="200">
          <template #default="{ row }">
            <el-tag v-for="flag in row.riskFlags" :key="flag" class="mr-2" type="warning" effect="plain">{{ flag }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="资料" min-width="160">
          <template #default="{ row }">{{ row.documents.join("、") }}</template>
        </el-table-column>
        <el-table-column label="审核状态" width="110">
          <template #default="{ row }">
            <el-tag :type="row.reviewStatus === 'pending' ? 'warning' : row.reviewStatus === 'approved' ? 'success' : 'danger'" effect="plain">
              {{ row.reviewStatus === "pending" ? "待审核" : row.reviewStatus === "approved" ? "已通过" : "已驳回" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" align="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openReview(row)">处理</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-drawer v-model="drawerVisible" size="720px" destroy-on-close>
      <template #header>
        <div class="text-lg font-semibold text-gray-800">会员审核处理</div>
      </template>
      <div v-if="currentReview && currentMember" class="space-y-5">
        <div class="rimo-card p-5">
          <div class="text-sm font-semibold text-gray-800 mb-4">会员资料</div>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="会员姓名">{{ currentMember.name }}</el-descriptions-item>
            <el-descriptions-item label="手机号">{{ currentMember.phone }}</el-descriptions-item>
            <el-descriptions-item label="身份证号">{{ currentMember.identityNoMasked || "未填写" }}</el-descriptions-item>
            <el-descriptions-item label="驾驶证号">{{ currentMember.driverLicenseNoMasked || "未填写" }}</el-descriptions-item>
            <el-descriptions-item label="等级">{{ currentMember.levelName }}</el-descriptions-item>
            <el-descriptions-item label="来源">{{ currentMember.source }}</el-descriptions-item>
          </el-descriptions>
        </div>

        <div class="rimo-card p-5">
          <div class="text-sm font-semibold text-gray-800 mb-4">审核动作</div>
          <el-form label-position="top">
            <el-form-item label="审核结果">
              <el-radio-group v-model="reviewForm.action">
                <el-radio-button label="approve">通过</el-radio-button>
                <el-radio-button label="reject">驳回</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="审核备注">
              <el-input v-model="reviewForm.remark" type="textarea" :rows="4" />
            </el-form-item>
          </el-form>
        </div>

        <div class="flex justify-end gap-3">
          <el-button @click="drawerVisible = false">取消</el-button>
          <el-button type="primary" color="#00689E" :loading="actionLoading" @click="submit">提交审核</el-button>
        </div>
      </div>
    </el-drawer>
  </AppLayout>
</template>
