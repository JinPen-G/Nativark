# 可选 Web 客户端

客户网站与员工门店端共用会话隔离和 UIArc 视觉基础，分别从 `@rental-os/platform-client-web/customer`、`/staff` 选择入口。包根只导出浏览器辅助与类型；零 Core 底座没有反向依赖。源码出口沿现有公共 UI 包惯例交由宿主打包，不携带独立 Auth 或 Rental 业务。

[外壳](src/Shell.tsx) → [浏览器路由和原定位](src/browser.ts) → [客户端合同](../platform-client-contracts/README.md)。外壳只消费原服务投影与 Core 贡献。客户使用 `client`，门店使用 `staff`，选错受众拒绝装配。

## 显式装配

```tsx
import { createClientRuntime, createClientView } from '@rental-os/platform-client-contracts';
import { createBrowserOperationStore } from '@rental-os/platform-client-web';
import { CustomerWebsite } from '@rental-os/platform-client-web/customer';
import '@rental-os/platform-client-web/styles.css';

// session/access/contributions 来自已选 Core 的正式客户端工厂。
const runtime = createClientRuntime({ surface: 'customer-web', session, access, contributions });
const store = createBrowserOperationStore(window.localStorage, 'customer-web');
const view = createClientView(runtime, store);
// React 宿主：<CustomerWebsite view={view} brand={{ name: '已核租户品牌' }} />
// 卸载顺序：root.unmount(); view.dispose(); runtime.dispose();
```

员工宿主改为 `staff-web`、独立存储命名空间与 `StaffWeb`。上述变量须由原宿主提供，缺失时不要创建恒真授权或虚构账号。完整模板入口见 [客户端模板](../../templates/platform-clients/README.md)。`brand` 为已核品牌文本和合法十六进制主色；不接受原始 HTML、外链脚本或模型指定地址。

## 页面行为

- 客户导航置顶；门店采用工作范围与导航侧栏，窄屏转为纵向。公共配色、字体、翻译函数沿 `platform-admin` 正式窄出口复用，未采用管理员登录、管理员 LocaleProvider 存储或后台权限上下文。
- 搜索交 Core 读取；扫码枪可直接输入并确认。相机扫码为微信原入口；Web 不承诺收银硬件或相机权限兼容。扫码结果只能进入已登记路由。
- 所有控件至少 48px 高，支持键盘、明确焦点和中英切换。列表、空态、加载、拒绝、停用、不可用、原结果待核分开显示。Core 文本按原事实展示，不翻译业务内容。
- 路由 hash 只携带页面与业务定位，不采用 URL 中的身份/租户/地点。直接进入仍经过同一当前准入。会话变化同步清页面、输入与搜索；隐藏或 bfcache 离开时清展示并取消读取，恢复前台先核原会话。
- 动作需展开确认；有待核原操作时仅可读取原结果。持久存储无法写入时不派发。取消请求、退出、弱网和失应答均不自动重发。原收据独立于普通页面停用检查，是否可读仍由当前权威决定。

宿主必须订阅原撤权/Core停用事件，更新会话权限修订或调用 `runtime.invalidate()`。这个通知不能替代请求前后及服务端的当前复权。原请求运输与 Auth 采用必须遵守 `ClientLifetime`；通用 UI 无法修复原 Auth 在旧响应中错误地保存令牌。

## 构建与实际边界

准备锁定依赖后运行 `npm run build -w @rental-os/platform-client-web`（源码包类型检查），实际浏览器制品由所选 Web 模板的 Vite build 生成。根 `build` 不自动选择客户端。只读依赖类型核对和进程内冒烟不代表真实 Rental 服务接通，也不替代微信开发者工具和真机证据。

业务读写与缺件由 Rental 原作者在独立仓适配。没有真实会话、当前准入或普通动作收据时保持不可用；禁止通过管理员会话、模拟数据或查询当前对象状态来冒充原收据。
