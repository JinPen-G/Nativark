<script setup lang="ts">
import { ElMessage } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import type { StoreValueAddedServiceSummary } from "@store-rental/shared";
import {
  listValueAddedServices,
  saveValueAddedService as persistValueAddedService
} from "../api/client";
import AppLayout from "../components/AppLayout.vue";
import { storeServiceRows } from "../data/prototypeSeed";

const activeTab = ref("store");
const dialogVisible = ref(false);
const inventoryDialogVisible = ref(false);
const serviceVersionDialogVisible = ref(false);
const isEditService = ref(false);
const rows = ref<StoreValueAddedServiceSummary[]>(structuredClone(storeServiceRows));
const selectedService = ref<StoreValueAddedServiceSummary | null>(null);

const currentService = reactive<StoreValueAddedServiceSummary>({
  id: "",
  name: "",
  code: "",
  category: "insurance",
  memberLimit: "不限",
  price: 0,
  unit: "/天",
  maxQuantity: 1,
  trackInventory: false,
  totalStock: 0,
  status: "enabled",
  version: "",
  description: ""
});

const totalStock = computed(() => rows.value.reduce((total, row) => total + (row.totalStock ?? 0), 0));

async function loadRows() {
  try {
    rows.value = await listValueAddedServices();
  } catch {
    rows.value = structuredClone(storeServiceRows);
  }
}

function categoryName(category: StoreValueAddedServiceSummary["category"]) {
  return category === "insurance" ? "保险" : category === "equipment" ? "设备" : "服务";
}

function openCreate() {
  isEditService.value = false;
  Object.assign(currentService, {
    id: "",
    name: "",
    code: "",
    category: "insurance",
    memberLimit: "不限",
    price: 0,
    unit: "/天",
    maxQuantity: 1,
    trackInventory: false,
    totalStock: 0,
    status: "enabled",
    version: "SVC-STORE-DRAFT",
    description: ""
  });
  dialogVisible.value = true;
}

function openEdit(row: StoreValueAddedServiceSummary) {
  isEditService.value = true;
  Object.assign(currentService, structuredClone(row));
  dialogVisible.value = true;
}

async function saveService() {
  if (!currentService.name || !currentService.code) {
    ElMessage.warning("请填写服务名称和服务编码");
    return;
  }
  let savedService = structuredClone(currentService);
  try {
    savedService = await persistValueAddedService(savedService);
  } catch {
    savedService = {
      ...savedService,
      id: savedService.id || `svc_${Date.now()}`,
      version: savedService.version || `SVC-STORE-${Date.now()}`
    };
  }

  if (isEditService.value) {
    const index = rows.value.findIndex((row) => row.id === currentService.id);
    if (index >= 0) {
      rows.value[index] = savedService;
    }
  } else {
    rows.value.unshift(savedService);
  }
  dialogVisible.value = false;
  ElMessage.success("增值服务已保存");
}

function openInventory(row: StoreValueAddedServiceSummary) {
  selectedService.value = row;
  inventoryDialogVisible.value = true;
}

function openVersion(row: StoreValueAddedServiceSummary) {
  selectedService.value = row;
  serviceVersionDialogVisible.value = true;
}

onMounted(loadRows);
</script>

<template>
  <AppLayout>
    <div class="flex justify-between items-end mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-800 tracking-tight">增值服务管理</h1>
        <p class="text-gray-500 text-sm mt-1">管理门市租赁及分时租赁的增值服务、保险及设备租赁项目。</p>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="sr-page-tabs bg-white rounded-xl shadow-sm border border-gray-100 min-h-[500px]">
      <el-tab-pane name="store">
        <template #label>
          <span class="flex items-center gap-2"><el-icon><Shop /></el-icon><span>门市租赁</span></span>
        </template>
        <div class="p-6">
          <div class="flex justify-between items-center mb-6">
            <div class="text-sm text-gray-500">
              <span class="font-bold text-gray-700">说明：</span>
              管理门市业务下的实时下单可选服务，价格与库存将写入订单级基线快照。
            </div>
            <el-button type="primary" color="#00689E" @click="openCreate">
              <el-icon class="mr-1"><Plus /></el-icon>
              新增门市服务
            </el-button>
          </div>

          <el-table :data="rows" stripe style="width: 100%">
            <el-table-column prop="name" label="服务名称" min-width="180">
              <template #default="{ row }">
                <div class="font-bold text-gray-800">{{ row.name }}</div>
                <div class="text-xs text-indigo-500 cursor-pointer underline decoration-dotted" @click="openVersion(row)">{{ row.version }}</div>
              </template>
            </el-table-column>
            <el-table-column label="类型" width="100">
              <template #default="{ row }"><el-tag effect="plain">{{ categoryName(row.category) }}</el-tag></template>
            </el-table-column>
            <el-table-column label="适用会员" min-width="120">
              <template #default="{ row }">{{ row.memberLimit }}</template>
            </el-table-column>
            <el-table-column label="价格" width="140">
              <template #default="{ row }">
                <span class="font-mono font-bold text-gray-800">¥{{ row.price }}{{ row.unit }}</span>
              </template>
            </el-table-column>
            <el-table-column label="库存/数量" width="130" align="center">
              <template #default="{ row }">
                <div v-if="row.trackInventory" class="text-sm font-bold text-gray-800">{{ row.totalStock }} 件</div>
                <div v-else><span class="text-gray-400 text-xs">无限库存</span></div>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="row.status === 'enabled' ? 'success' : 'info'" effect="plain">{{ row.status === "enabled" ? "启用" : "禁用" }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="200" align="right">
              <template #default="{ row }">
                <el-button type="primary" link @click="openEdit(row)">编辑</el-button>
                <el-button v-if="row.trackInventory" type="primary" link @click="openInventory(row)">库存</el-button>
                <el-button type="primary" link @click="openVersion(row)">历史版本</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <el-tab-pane name="sharing">
        <template #label>
          <span class="flex items-center gap-2"><el-icon><Clock /></el-icon><span>分时租车</span></span>
        </template>
        <div class="p-6 text-sm text-gray-400">分时租车本期暂不开发，仅保留原型页签位置。</div>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="dialogVisible" :title="isEditService ? '编辑增值服务' : '新增门市服务'" width="760px" destroy-on-close>
      <el-form :model="currentService" label-position="top">
        <el-form-item label="适用场景 (必选)" required class="mb-0">
          <el-checkbox checked disabled>门市租赁</el-checkbox>
          <div class="text-xs text-indigo-400 mt-1">* 勾选不同场景将分别配置价格</div>
        </el-form-item>

        <div class="grid grid-cols-12 gap-4 mt-4">
          <el-form-item label="服务名称" required class="col-span-12 md:col-span-6">
            <el-input v-model="currentService.name" placeholder="例如：全车驾乘险" size="large" />
          </el-form-item>
          <el-form-item label="服务编码" required class="col-span-12 md:col-span-6">
            <el-input v-model="currentService.code" placeholder="例如：INSURANCE_FULL" size="large" />
          </el-form-item>
          <el-form-item label="服务类型" class="col-span-12 md:col-span-4">
            <el-select v-model="currentService.category" class="w-full" size="large">
              <el-option label="保险类" value="insurance" />
              <el-option label="设备类" value="equipment" />
              <el-option label="服务类" value="service" />
            </el-select>
          </el-form-item>
          <el-form-item label="会员限制" class="col-span-12 md:col-span-4">
            <el-select v-model="currentService.memberLimit" placeholder="不限" size="large" style="width: 100%">
              <el-option label="不限" value="不限" />
              <el-option label="黄金会员及以上" value="黄金会员及以上" />
              <el-option label="黑钻会员及以上" value="黑钻会员及以上" />
            </el-select>
          </el-form-item>
          <el-form-item label="状态" class="col-span-12 md:col-span-4">
            <el-select v-model="currentService.status" class="w-full" size="large">
              <el-option label="启用" value="enabled" />
              <el-option label="禁用" value="disabled" />
            </el-select>
          </el-form-item>
        </div>

        <el-divider content-position="left">门市租赁定价</el-divider>
        <div class="grid grid-cols-12 gap-4">
          <el-form-item label="价格" required class="col-span-12 md:col-span-3">
            <el-input-number v-model="currentService.price" :min="0" :precision="0" class="w-full" />
          </el-form-item>
          <el-form-item label="计价单位" class="col-span-12 md:col-span-3">
            <el-select v-model="currentService.unit" class="w-full">
              <el-option label="/天" value="/天" />
              <el-option label="/次" value="/次" />
            </el-select>
          </el-form-item>
          <el-form-item label="最大加购数量" class="col-span-12 md:col-span-3">
            <el-input-number v-model="currentService.maxQuantity" :min="1" class="w-full" />
          </el-form-item>
          <el-form-item label="库存管理" class="col-span-12 md:col-span-3">
            <el-switch v-model="currentService.trackInventory" active-text="启用" inactive-text="关闭" />
          </el-form-item>
          <el-form-item v-if="currentService.trackInventory" label="总库存" class="col-span-12 md:col-span-3">
            <el-input-number v-model="currentService.totalStock" :min="0" class="w-full" />
          </el-form-item>
          <el-form-item label="服务说明" class="col-span-12">
            <el-input v-model="currentService.description" type="textarea" :rows="3" placeholder="描述服务内容和注意事项..." />
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" color="#00689E" @click="saveService">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="inventoryDialogVisible" title="门店库存管理" width="720px" class="inventory-dialog">
      <div class="grid grid-cols-3 gap-4 mb-5">
        <div class="rounded-xl bg-[#00689E] text-white p-4">
          <div class="text-white/70 text-sm">总库存</div>
          <div class="text-2xl font-bold">{{ selectedService?.totalStock ?? totalStock }}</div>
        </div>
        <div class="rounded-xl bg-slate-50 border border-slate-100 p-4">
          <div class="text-slate-400 text-sm">旺角门市</div>
          <div class="text-xl font-bold text-slate-800">8</div>
        </div>
        <div class="rounded-xl bg-slate-50 border border-slate-100 p-4">
          <div class="text-slate-400 text-sm">中环门市</div>
          <div class="text-xl font-bold text-slate-800">5</div>
        </div>
      </div>
      <el-table :data="[{ store: '旺角门市', stock: 8 }, { store: '中环门市', stock: 5 }, { store: '机场门市', stock: 5 }]" border>
        <el-table-column prop="store" label="门店" />
        <el-table-column label="库存">
          <template #default="{ row }"><el-input-number v-model="row.stock" :min="0" /></template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="inventoryDialogVisible = false">取消</el-button>
        <el-button type="primary" color="#00689E" @click="inventoryDialogVisible = false">保存库存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="serviceVersionDialogVisible" title="增值服务历史版本" width="880px" destroy-on-close>
      <div v-if="selectedService" class="space-y-4">
        <div class="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3">
          <div class="font-mono font-bold text-gray-900">{{ selectedService.version }}</div>
          <div class="text-sm text-gray-700 mt-1">{{ selectedService.name }} 当前版本</div>
        </div>
        <div class="font-bold text-gray-800">基础信息</div>
        <el-table :data="[
          { label: '服务名称', value: selectedService.name },
          { label: '服务编码', value: selectedService.code },
          { label: '状态', value: selectedService.status === 'enabled' ? '启用' : '禁用' }
        ]" border size="small">
          <el-table-column prop="label" label="配置项" width="170" />
          <el-table-column prop="value" label="内容" />
        </el-table>
        <div class="font-bold text-gray-800">价格与库存</div>
        <el-table :data="[{
          scope: '门市租赁',
          pricing: '¥' + selectedService.price + selectedService.unit,
          limit: selectedService.maxQuantity + ' 件',
          inventory: selectedService.trackInventory ? '按门店库存' : '无限供应',
          remark: selectedService.description
        }]" border size="small">
          <el-table-column prop="scope" label="适用范围" min-width="160" />
          <el-table-column prop="pricing" label="价格规则" min-width="180" />
          <el-table-column prop="limit" label="数量限制" width="120" />
          <el-table-column prop="inventory" label="库存口径" min-width="160" />
          <el-table-column prop="remark" label="说明" min-width="220" />
        </el-table>
      </div>
      <template #footer>
        <el-button @click="serviceVersionDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </AppLayout>
</template>
