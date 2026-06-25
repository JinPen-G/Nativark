<script setup lang="ts">
import { ElMessage } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import type {
  PlatformAuditLogQuery,
  PlatformAuditLogRow,
  PlatformDictionaryGroup,
  PlatformDictionaryItem,
  PlatformNumberRule,
  TenantBootstrapPreview
} from "@store-rental/shared";
import {
  bootstrapTenant,
  generatePlatformNumber,
  getTenantBootstrapPreview,
  listPlatformAuditLogs,
  listPlatformDictionaries,
  listPlatformNumberRules,
  savePlatformDictionary,
  savePlatformNumberRule
} from "../api/client";
import AppLayout from "../components/AppLayout.vue";

const activeTab = ref("audit");
const loading = ref(false);
const auditRows = ref<PlatformAuditLogRow[]>([]);
const auditTotal = ref(0);
const dictionaries = ref<PlatformDictionaryGroup[]>([]);
const numberRules = ref<PlatformNumberRule[]>([]);
const selectedDictionaryCode = ref("");
const bootstrapPreview = ref<TenantBootstrapPreview>();
const generatedNo = ref("");

const auditQuery = reactive<PlatformAuditLogQuery>({
  action: "",
  operator: "",
  targetType: "",
  limit: 50
});

const dictionaryForm = reactive<PlatformDictionaryGroup>({
  code: "",
  name: "",
  module: "",
  description: "",
  items: [],
  updatedAt: "",
  updatedBy: ""
});

const tenantForm = reactive({
  tenantCode: "demo3",
  tenantName: "演示新租户",
  adminAccount: "admin",
  adminDisplayName: "租户管理员",
  adminPhone: "",
  storeCode: "STORE-DEMO3",
  storeName: "默认门市",
  operator: "平台管理员"
});

const selectedDictionary = computed(() =>
  dictionaries.value.find((item) => item.code === selectedDictionaryCode.value)
);

function cloneDictionary(group: PlatformDictionaryGroup) {
  Object.assign(dictionaryForm, JSON.parse(JSON.stringify(group)));
}

async function loadAuditLogs() {
  const result = await listPlatformAuditLogs(auditQuery);
  auditRows.value = result.rows;
  auditTotal.value = result.total;
}

async function loadGovernanceData() {
  loading.value = true;
  try {
    const [logs, dictionaryRows, ruleRows, preview] = await Promise.all([
      listPlatformAuditLogs(auditQuery),
      listPlatformDictionaries(),
      listPlatformNumberRules(),
      getTenantBootstrapPreview()
    ]);
    auditRows.value = logs.rows;
    auditTotal.value = logs.total;
    dictionaries.value = dictionaryRows;
    numberRules.value = ruleRows;
    bootstrapPreview.value = preview;
    selectedDictionaryCode.value = dictionaryRows[0]?.code ?? "";
    if (dictionaryRows[0]) {
      cloneDictionary(dictionaryRows[0]);
    }
  } finally {
    loading.value = false;
  }
}

function selectDictionary(code: string) {
  selectedDictionaryCode.value = code;
  if (selectedDictionary.value) {
    cloneDictionary(selectedDictionary.value);
  }
}

function addDictionaryItem() {
  dictionaryForm.items.push({
    code: `item_${Date.now()}`,
    label: "",
    value: "",
    sortNo: dictionaryForm.items.length * 10 + 10,
    enabled: true
  });
}

function removeDictionaryItem(row: PlatformDictionaryItem) {
  dictionaryForm.items = dictionaryForm.items.filter((item) => item !== row);
}

async function saveDictionary() {
  const saved = await savePlatformDictionary({
    ...dictionaryForm,
    operator: "平台管理员"
  });
  const index = dictionaries.value.findIndex((item) => item.code === saved.code);
  if (index >= 0) {
    dictionaries.value[index] = saved;
  } else {
    dictionaries.value.unshift(saved);
  }
  selectDictionary(saved.code);
  await loadAuditLogs();
  ElMessage.success("数据字典已保存");
}

async function saveNumberRule(row: PlatformNumberRule) {
  const saved = await savePlatformNumberRule({
    code: row.code,
    name: row.name,
    module: row.module,
    prefix: row.prefix,
    datePattern: row.datePattern,
    sequenceLength: row.sequenceLength,
    currentSequence: row.currentSequence,
    resetCycle: row.resetCycle,
    enabled: row.enabled,
    operator: "平台管理员"
  });
  const index = numberRules.value.findIndex((item) => item.code === saved.code);
  if (index >= 0) {
    numberRules.value[index] = saved;
  }
  await loadAuditLogs();
  ElMessage.success("编号规则已保存");
}

async function testGenerateNumber(row: PlatformNumberRule) {
  const result = await generatePlatformNumber(row.code, "平台管理员");
  generatedNo.value = result.generatedNo;
  const refreshed = await listPlatformNumberRules();
  numberRules.value = refreshed;
  await loadAuditLogs();
  ElMessage.success(`已生成编号 ${result.generatedNo}`);
}

async function submitTenantBootstrap() {
  const result = await bootstrapTenant(tenantForm);
  await loadGovernanceData();
  ElMessage.success(result.message);
}

onMounted(loadGovernanceData);
</script>

<template>
  <AppLayout>
    <template #header-actions>
      <el-button :loading="loading" @click="loadGovernanceData">
        <el-icon class="mr-1"><Refresh /></el-icon>
        刷新
      </el-button>
    </template>

    <div class="prototype-page-title">
      <div>
        <h1>平台治理中心</h1>
        <p>统一维护审计日志、数据字典、编号规则和租户初始化模板。</p>
      </div>
      <div class="flex gap-3">
        <el-tag type="success" effect="plain">MySQL 可落库</el-tag>
        <el-tag type="info" effect="plain">H5 / 企业端接口预留</el-tag>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
      <el-tab-pane label="日志审计" name="audit">
        <div class="grid grid-cols-1 xl:grid-cols-4 gap-3 mb-4">
          <el-input v-model="auditQuery.action" clearable placeholder="操作类型" />
          <el-input v-model="auditQuery.operator" clearable placeholder="操作人" />
          <el-select v-model="auditQuery.targetType" clearable placeholder="对象类型">
            <el-option label="租户" value="tenant" />
            <el-option label="数据字典" value="dictionary" />
            <el-option label="编号规则" value="number-rule" />
            <el-option label="系统参数" value="system-rules" />
          </el-select>
          <el-button type="primary" color="#00689E" @click="loadAuditLogs">查询</el-button>
        </div>

        <el-table :data="auditRows" height="520" border>
          <el-table-column prop="createdAt" label="操作时间" min-width="180" />
          <el-table-column prop="operator" label="操作人" width="120" />
          <el-table-column prop="action" label="操作类型" width="170" />
          <el-table-column prop="targetType" label="对象类型" width="130" />
          <el-table-column prop="targetId" label="对象ID" min-width="160" />
          <el-table-column prop="detail" label="详情" min-width="260" />
        </el-table>
        <div class="text-xs text-gray-400 mt-3">共 {{ auditTotal }} 条审计记录</div>
      </el-tab-pane>

      <el-tab-pane label="数据字典" name="dictionary">
        <div class="grid grid-cols-12 gap-4">
          <aside class="col-span-12 xl:col-span-3 border rounded-lg overflow-hidden">
            <button
              v-for="group in dictionaries"
              :key="group.code"
              class="w-full text-left px-4 py-3 border-b last:border-b-0 hover:bg-gray-50"
              :class="{ 'bg-blue-50 text-[#00689E] font-semibold': group.code === selectedDictionaryCode }"
              @click="selectDictionary(group.code)"
            >
              <div>{{ group.name }}</div>
              <div class="text-xs text-gray-400 mt-1">{{ group.code }}</div>
            </button>
          </aside>

          <section class="col-span-12 xl:col-span-9">
            <div class="grid grid-cols-1 xl:grid-cols-3 gap-3 mb-4">
              <el-input v-model="dictionaryForm.code" disabled placeholder="字典编码" />
              <el-input v-model="dictionaryForm.name" placeholder="字典名称" />
              <el-input v-model="dictionaryForm.module" placeholder="归属模块" />
            </div>
            <el-input
              v-model="dictionaryForm.description"
              class="mb-4"
              type="textarea"
              :rows="2"
              placeholder="说明"
            />
            <div class="flex justify-between items-center mb-3">
              <span class="font-semibold text-gray-700">字典项</span>
              <el-button type="primary" link icon="Plus" @click="addDictionaryItem">新增字典项</el-button>
            </div>
            <el-table :data="dictionaryForm.items" border>
              <el-table-column label="编码" min-width="150">
                <template #default="{ row }">
                  <el-input v-model="row.code" />
                </template>
              </el-table-column>
              <el-table-column label="显示名称" min-width="150">
                <template #default="{ row }">
                  <el-input v-model="row.label" />
                </template>
              </el-table-column>
              <el-table-column label="值" min-width="150">
                <template #default="{ row }">
                  <el-input v-model="row.value" />
                </template>
              </el-table-column>
              <el-table-column label="排序" width="110">
                <template #default="{ row }">
                  <el-input-number v-model="row.sortNo" :min="0" :controls="false" class="w-full" />
                </template>
              </el-table-column>
              <el-table-column label="启用" width="90">
                <template #default="{ row }">
                  <el-switch v-model="row.enabled" />
                </template>
              </el-table-column>
              <el-table-column label="操作" width="90">
                <template #default="{ row }">
                  <el-button type="danger" link @click="removeDictionaryItem(row)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
            <div class="flex justify-end mt-4">
              <el-button type="primary" color="#00689E" @click="saveDictionary">保存字典</el-button>
            </div>
          </section>
        </div>
      </el-tab-pane>

      <el-tab-pane label="编号规则" name="number">
        <el-table :data="numberRules" border>
          <el-table-column label="规则编码" prop="code" min-width="150" fixed="left" />
          <el-table-column label="名称" min-width="160">
            <template #default="{ row }"><el-input v-model="row.name" /></template>
          </el-table-column>
          <el-table-column label="模块" min-width="130">
            <template #default="{ row }"><el-input v-model="row.module" /></template>
          </el-table-column>
          <el-table-column label="前缀" width="110">
            <template #default="{ row }"><el-input v-model="row.prefix" /></template>
          </el-table-column>
          <el-table-column label="日期格式" width="140">
            <template #default="{ row }">
              <el-select v-model="row.datePattern">
                <el-option label="yyyyMMdd" value="yyyyMMdd" />
                <el-option label="yyyyMM" value="yyyyMM" />
                <el-option label="yyMMdd" value="yyMMdd" />
                <el-option label="无" value="none" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="流水位数" width="120">
            <template #default="{ row }">
              <el-input-number v-model="row.sequenceLength" :min="3" :max="12" :controls="false" class="w-full" />
            </template>
          </el-table-column>
          <el-table-column label="当前流水" width="120">
            <template #default="{ row }">
              <el-input-number v-model="row.currentSequence" :min="0" :controls="false" class="w-full" />
            </template>
          </el-table-column>
          <el-table-column prop="sample" label="示例" min-width="180" />
          <el-table-column label="启用" width="90">
            <template #default="{ row }"><el-switch v-model="row.enabled" /></template>
          </el-table-column>
          <el-table-column label="操作" width="170" fixed="right">
            <template #default="{ row }">
              <el-button type="primary" link @click="saveNumberRule(row)">保存</el-button>
              <el-button link @click="testGenerateNumber(row)">试生成</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="generatedNo" class="mt-4 text-sm text-gray-600">
          最新生成编号：<span class="font-semibold text-[#00689E]">{{ generatedNo }}</span>
        </div>
      </el-tab-pane>

      <el-tab-pane label="租户初始化" name="tenant">
        <div class="grid grid-cols-12 gap-6">
          <section class="col-span-12 xl:col-span-6">
            <el-form label-position="top">
              <div class="grid grid-cols-1 xl:grid-cols-2 gap-3">
                <el-form-item label="租户编码">
                  <el-input v-model="tenantForm.tenantCode" />
                </el-form-item>
                <el-form-item label="租户名称">
                  <el-input v-model="tenantForm.tenantName" />
                </el-form-item>
                <el-form-item label="管理员账号">
                  <el-input v-model="tenantForm.adminAccount" />
                </el-form-item>
                <el-form-item label="管理员姓名">
                  <el-input v-model="tenantForm.adminDisplayName" />
                </el-form-item>
                <el-form-item label="管理员手机">
                  <el-input v-model="tenantForm.adminPhone" />
                </el-form-item>
                <el-form-item label="默认门市编码">
                  <el-input v-model="tenantForm.storeCode" />
                </el-form-item>
                <el-form-item label="默认门市名称">
                  <el-input v-model="tenantForm.storeName" />
                </el-form-item>
                <el-form-item label="操作人">
                  <el-input v-model="tenantForm.operator" />
                </el-form-item>
              </div>
            </el-form>
            <el-button type="primary" color="#00689E" @click="submitTenantBootstrap">
              执行初始化
            </el-button>
          </section>

          <section class="col-span-12 xl:col-span-6 border rounded-lg p-4 bg-gray-50">
            <div class="font-semibold text-gray-700 mb-3">初始化模板</div>
            <div class="text-sm text-gray-500 mb-4">会初始化默认角色、系统参数、数据字典和编号规则。</div>
            <div class="space-y-4">
              <div>
                <div class="text-xs text-gray-400 mb-2">默认角色</div>
                <div class="flex flex-wrap gap-2">
                  <el-tag v-for="role in bootstrapPreview?.roles" :key="role.code">
                    {{ role.name }}
                  </el-tag>
                </div>
              </div>
              <div>
                <div class="text-xs text-gray-400 mb-2">数据字典</div>
                <div class="flex flex-wrap gap-2">
                  <el-tag v-for="code in bootstrapPreview?.dictionaries" :key="code" type="success">
                    {{ code }}
                  </el-tag>
                </div>
              </div>
              <div>
                <div class="text-xs text-gray-400 mb-2">编号规则</div>
                <div class="flex flex-wrap gap-2">
                  <el-tag v-for="code in bootstrapPreview?.numberRules" :key="code" type="warning">
                    {{ code }}
                  </el-tag>
                </div>
              </div>
            </div>
          </section>
        </div>
      </el-tab-pane>
    </el-tabs>
  </AppLayout>
</template>
