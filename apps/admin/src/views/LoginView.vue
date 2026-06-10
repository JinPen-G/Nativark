<script setup lang="ts">
import { ElMessage } from "element-plus";
import { computed, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();
const loading = ref(false);
const currentLang = ref("zh-CN");
const captchaUrl = ref("mock-captcha");
const langOptions = [
  { label: "简中", value: "zh-CN" },
  { label: "繁中", value: "zh-TW" },
  { label: "EN", value: "en-US" }
];
const i18nTexts = {
  "zh-CN": {
    brandTitle: "RIMO Rental Solution",
    brandSubtitle: "统一管理车辆资产、订单租赁、会员与企业客户，支撑多场景的用车业务运营。",
    brandBullet1: "实时掌握车辆状态与调度排程",
    brandBullet2: "多维度会员与企业客户管理",
    brandBullet3: "支持门市租赁、分时租赁等多业务模式",
    title: "营运后台登录",
    subtitle: "请使用分配的后台账号登录 RIMO Rental 管理系统。",
    tenantLabel: "群组代码 / 租户编码",
    tenantPlaceholder: "请输入所属租户的群组代码",
    accountLabel: "账号",
    accountPlaceholder: "邮箱 / 手机号 / 工号",
    passwordLabel: "密码",
    passwordPlaceholder: "请输入密码",
    captchaLabel: "验证码",
    captchaPlaceholder: "请输入右侧验证码",
    captchaPlaceholderImage: "点击获取验证码",
    captchaRefresh: "看不清？换一张",
    rememberMe: "记住我（7 天内免登录）",
    forgotPassword: "忘记密码？",
    loginButton: "登录",
    footerNote: "如需开通后台账号，请联系系统管理员。"
  },
  "zh-TW": {
    brandTitle: "RIMO Rental Solution",
    brandSubtitle: "統一管理車輛資產、訂單租賃、會員與企業客戶，支援多場景的用車業務營運。",
    brandBullet1: "即時掌握車輛狀態與調度排程",
    brandBullet2: "多維度會員與企業客戶管理",
    brandBullet3: "支援門市租賃、分時租賃等多業務模式",
    title: "後台登入",
    subtitle: "請使用分配的後台帳號登入 RIMO Rental 管理系統。",
    tenantLabel: "群組代碼 / 租戶編碼",
    tenantPlaceholder: "請輸入所屬租戶的群組代碼",
    accountLabel: "帳號",
    accountPlaceholder: "Email / 手機號 / 工號",
    passwordLabel: "密碼",
    passwordPlaceholder: "請輸入密碼",
    captchaLabel: "驗證碼",
    captchaPlaceholder: "請輸入右側驗證碼",
    captchaPlaceholderImage: "點擊取得驗證碼",
    captchaRefresh: "看不清？換一張",
    rememberMe: "記住我（7 天內免登入）",
    forgotPassword: "忘記密碼？",
    loginButton: "登入",
    footerNote: "如需開通後台帳號，請聯繫系統管理員。"
  },
  "en-US": {
    brandTitle: "RIMO Rental Solution",
    brandSubtitle: "Manage vehicles, rentals, and customers in one place to support multi-scenario fleet operations.",
    brandBullet1: "Real-time vehicle status & dispatch scheduling",
    brandBullet2: "Unified member and enterprise customer management",
    brandBullet3: "Supports counter rental and time-share business models",
    title: "Admin Sign In",
    subtitle: "Use your assigned admin account to sign in to the RIMO Rental console.",
    tenantLabel: "Tenant / Group Code",
    tenantPlaceholder: "Enter your tenant/group code",
    accountLabel: "Account",
    accountPlaceholder: "Email / phone / employee ID",
    passwordLabel: "Password",
    passwordPlaceholder: "Enter password",
    captchaLabel: "Captcha",
    captchaPlaceholder: "Enter captcha",
    captchaPlaceholderImage: "Get captcha",
    captchaRefresh: "Refresh",
    rememberMe: "Remember me for 7 days",
    forgotPassword: "Forgot password?",
    loginButton: "Sign in",
    footerNote: "Contact your system administrator to request an admin account."
  }
};

const texts = computed(() => i18nTexts[currentLang.value as keyof typeof i18nTexts]);
const form = reactive({
  tenantCode: "demo",
  account: "admin",
  password: "123456",
  captcha: "R7K9",
  rememberMe: true
});

function refreshCaptcha() {
  captchaUrl.value = `mock-captcha-${Date.now()}`;
  form.captcha = "R7K9";
}

async function handleLogin() {
  if (!form.tenantCode.trim() || !form.account.trim() || !form.password.trim()) {
    ElMessage.warning("请输入租户编码、账号和密码");
    return;
  }
  if (!form.captcha.trim()) {
    ElMessage.warning("请输入验证码");
    return;
  }

  loading.value = true;
  try {
    await authStore.login(form);
    ElMessage.success("登录成功，正在跳转...");
    await router.push(String(route.query.redirect ?? "/rental-rules"));
  } catch {
    ElMessage.error("登录失败，请使用 demo/admin、demo/store 或 demo/pricing，密码 123456");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen bg-gray-100 flex items-center justify-center p-4">
    <div class="w-full max-w-5xl min-h-[640px] bg-white rounded-2xl shadow-2xl overflow-hidden flex">
      <div class="login-brand hidden lg:flex lg:w-1/2 text-white flex-col justify-between p-8">
        <div>
          <div class="space-y-4">
            <h2 class="text-3xl font-semibold leading-tight">
              {{ texts.brandTitle }}
            </h2>
            <p class="text-white/80 text-sm leading-relaxed">
              {{ texts.brandSubtitle }}
            </p>
            <ul class="mt-4 space-y-2 text-sm text-white/85">
              <li class="flex items-center">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-300 mr-2 shadow-sm shadow-emerald-900/40"></span>
                {{ texts.brandBullet1 }}
              </li>
              <li class="flex items-center">
                <span class="w-1.5 h-1.5 rounded-full bg-amber-300 mr-2 shadow-sm shadow-amber-900/40"></span>
                {{ texts.brandBullet2 }}
              </li>
              <li class="flex items-center">
                <span class="w-1.5 h-1.5 rounded-full bg-sky-300 mr-2 shadow-sm shadow-sky-900/40"></span>
                {{ texts.brandBullet3 }}
              </li>
            </ul>
          </div>
        </div>
        <div class="text-xs text-white/60 mt-8">
          © {{ new Date().getFullYear() }} RIMO Rental. All rights reserved.
        </div>
      </div>

      <div class="w-full lg:w-1/2 px-6 py-8 sm:px-10 sm:py-10 flex flex-col bg-white">
        <div class="flex items-center justify-between mb-8">
          <div class="text-xl font-bold tracking-wider text-[#00689E]">RIMO</div>
          <el-segmented v-model="currentLang" size="small" :options="langOptions" />
        </div>

        <div class="mb-8 min-h-[92px]">
          <h1 class="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
            {{ texts.title }}
          </h1>
          <p class="mt-2 text-sm text-gray-500 leading-relaxed">
            {{ texts.subtitle }}
          </p>
        </div>

        <el-form size="large" label-position="top" class="space-y-4">
          <el-form-item :label="texts.tenantLabel">
            <el-input
              v-model="form.tenantCode"
              :placeholder="texts.tenantPlaceholder"
              autocomplete="organization"
            >
              <template #prefix>
                <el-icon><Tickets /></el-icon>
              </template>
            </el-input>
          </el-form-item>

          <el-form-item :label="texts.accountLabel">
            <el-input
              v-model="form.account"
              :placeholder="texts.accountPlaceholder"
              autocomplete="username"
            >
              <template #prefix>
                <el-icon><User /></el-icon>
              </template>
            </el-input>
          </el-form-item>

          <el-form-item :label="texts.passwordLabel">
            <el-input
              v-model="form.password"
              :placeholder="texts.passwordPlaceholder"
              show-password
              type="password"
              autocomplete="current-password"
            >
              <template #prefix>
                <el-icon><Lock /></el-icon>
              </template>
            </el-input>
          </el-form-item>

          <div class="grid grid-cols-3 gap-3">
            <el-form-item class="col-span-2" :label="texts.captchaLabel">
              <el-input v-model="form.captcha" :placeholder="texts.captchaPlaceholder" autocomplete="off">
                <template #prefix>
                  <el-icon><CircleCheck /></el-icon>
                </template>
              </el-input>
            </el-form-item>
            <div class="flex flex-col justify-end">
              <button
                type="button"
                class="h-[42px] w-full flex items-center justify-center rounded-lg border text-sm cursor-pointer select-none bg-gray-50 hover:bg-gray-100 border-gray-200 text-gray-600"
                @click="refreshCaptcha"
              >
                <span v-if="captchaUrl">R7K9</span>
                <span v-else>{{ texts.captchaPlaceholderImage }}</span>
              </button>
              <button type="button" class="mt-1 text-xs text-gray-400 hover:text-gray-500 text-right" @click="refreshCaptcha">
                {{ texts.captchaRefresh }}
              </button>
            </div>
          </div>

          <div class="flex items-center justify-between mt-1 mb-2">
            <el-checkbox v-model="form.rememberMe">
              {{ texts.rememberMe }}
            </el-checkbox>
            <a href="#" class="text-xs text-[#00689E] hover:text-sky-600">
              {{ texts.forgotPassword }}
            </a>
          </div>

          <el-button
            type="primary"
            :loading="loading"
            :disabled="loading"
            color="#00689E"
            class="w-full h-11 mt-3 text-base font-semibold"
            @click="handleLogin"
          >
            {{ texts.loginButton }}
          </el-button>
        </el-form>

        <div class="mt-auto pt-8 text-xs text-gray-400 text-center">
          {{ texts.footerNote }}
        </div>
      </div>
    </div>
  </div>
</template>
