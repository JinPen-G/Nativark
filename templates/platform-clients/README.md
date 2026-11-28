# 按需选择的客户端模板

客户网站、员工门店 Web、微信客户和微信员工是四个独立入口；选择一个端不启用其他端，零 Core 底座不加载这些模板。公共合同来自 `@rental-os/platform-client-contracts`，Web 外壳来自 `@rental-os/platform-client-web`，微信使用原生 App/Page/WXML/WXSS。租赁页面、API、授权和业务规则继续位于独立 Rental 仓库。

本目录已接入正式 Rental 贡献工厂，提供运输、凭据槽及生命周期适配。普通页面、动作和原收据分别消费原服务当前门禁；缺宿主设置或原权威时保持不可用。当前仍缺真实宿主证据及明确的门店范围映射，不能据此宣称 A03 完成。

## 固定来源与选装

客户端从 Zelo 基线 `d6ccb0dcad63ee2e06043b71c2651f326c7e8e3a` 开发，已普通合入宿主所需固定底座 `5a6bbbf7593414a122a060018cb1abd87f1c20bf`，候选在 [PR #14](https://github.com/JinPen-G/Zelo/pull/14)。运行组合必须再锁定所选 PR 提交的完整 SHA。业务依赖固定为 [Rental 268b9bfbf5b753ff8a6c280577dab9aa37f11e22](https://github.com/JinPen-G/Zelo-rental-core/commit/268b9bfbf5b753ff8a6c280577dab9aa37f11e22)，基于 Rental main `1ca7374a64db65bada538254cc95aba7950ea588`；对应 [Rental PR #4](https://github.com/JinPen-G/Zelo-rental-core/pull/4)。

| 选择 | 独立入口 | 在已准备锁定依赖的组合中构建 |
| --- | --- | --- |
| 客户网站 | [customer-web](customer-web/main.tsx) / `assembleCustomer` | `npm run build:client-customer-web` |
| 员工门店 Web | [staff-web](staff-web/main.tsx) / `assembleStaff` | `npm run build:client-staff-web` |
| 微信客户 | [wechat-customer](wechat-customer/app.ts) / `assembleCustomer` | `npm run build:client-wechat-customer` |
| 微信员工 | [wechat-staff](wechat-staff/app.ts) / `assembleStaff` | `npm run build:client-wechat-staff` |

所选宿主显式提供同版 `platform-contracts`、`core-contracts`、`platform-client-contracts` 构建产物。Web 再选择 `platform-client-web`；微信再选择 [原生适配](wechat/src/index.ts)，两者不互相依赖。UIArc 配色与字体从 `platform-admin` 正式窄出口复用，不采用管理员会话。微信产物不引入 React 或浏览器 DOM。

首个业务接线使用 [rental](rental/package.json) 的 `@rental-os/client-template-rental/browser` 或 `/wechat`。它以**可选 peer `@rental-os/rental-core@0.2.2`** 声明组合要求；单独准备零 Core 底座不会因此安装 Rental。选择这份接线时，由组合宿主提供上述固定 SHA 的 Rental 源码包及其正式出口 `@rental-os/rental-core/clients/contribution`。版本号 `0.2.2` 本身不能证明包含该出口，不能去注册表猜测包或用浮动分支替换来源。此候选不构成已发布发行资产。

原 Rental 工厂曾按 Zelo 合同 `63340342ae46ef545f0078f2a035dfdc62703874` 编写；本候选已用其固定源码核对后继合同、Runtime、Operations 和四端运输的兼容性。源码消费沿正式出口，未把 Rental Controller、DTO 或业务实现复制到 Zelo。

### 单端源码准备入口

在包含本客户端提交的公开 Zelo Git 检出中使用 [prepare.cjs](prepare.cjs)。准备不需要预先安装依赖，只读取指定完整 SHA 的 Git 对象；不采用工作区未提交文件，也不读取 `.env` 或私有 `docs`。先查看选中的源码与依赖：

```powershell
npm run prepare:client -- --surface customer-web --client-commit <客户端完整SHA> --rental-repo D:/sources/Zelo-rental-core --rental-commit 268b9bfbf5b753ff8a6c280577dab9aa37f11e22 --plan
```

将 `--plan` 改为 `--out D:/clients/customer-web` 才写出源码。父目录须已存在，目标目录须不存在；既有目录或链接明确拒绝覆盖。`--surface` 只接受表中四个入口中的一个，其他三个端不会加入输出 workspace 或锁。原公共主题包声明的依赖仍按其正式锁保留；这不启用管理员登录、其他客户端或服务端。

默认公共底座源码来自同一个 `--client-commit`。显式装配另一固定底座时，同时指定 `--platform-repo <Zelo目录> --platform-commit <底座完整SHA>`；准备器只叠加本客户端拥有的包与锁条目，其他公共包仍来自所选底座。Rental SHA、包版本和贡献出口必须与模板已固定来源一致，不能传入浮动分支或同版本的其他提交。该操作仅准备客户端源码，不核定远端 API 的安装、兼容、权限或业务就绪。

输出的 `client.workspace.json` 登记底座、客户端、Rental 完整 SHA、所选 workspace 和原锁摘要。然后在**输出目录**显式执行 `npm ci --ignore-scripts --no-audit --no-fund` 与 `npm run build`；后者只构建三个公共合同、核所选外壳/接线/入口类型并构建该端，不执行全仓构建、Prisma 或 Core 服务端脚本。配置本端 `connection.ts` 后重新构建，产物位于本端的 `dist/`。取消准备或写出失败时只清理本次创建且字节未变的文件；清理受阻会明确报告原位置，不覆盖并发改动。

这份开发源码工作区不是标准发行资产、部署包或业务通过证明。模板还须按下文取得实际宿主与微信证据；零 Core 发行仍独立，安装/生成器收录时可消费这个明确的单端入口，不能默认加入全部客户端。

## 宿主设置与运行

每端的 `connection.ts` 是明确的非敏感连接设置，默认 `undefined`。在获授权独立宿主填入可信 HTTPS API 来源、原 tenantCode、品牌名；微信客户还需原应用 AppID。不要填密码、token、任意用户提供的 URL 或本地推测的主体范围。例如设置的结构如下，地址和租户只是格式示意，不能当可用环境：

```ts
import type { RentalClientHostConfiguration } from '@rental-os/client-template-rental/config';

export const connection: RentalClientHostConfiguration = {
  apiOrigin: 'https://approved-host.example',
  tenantCode: 'approved-tenant',
  brand: { name: '已核租户品牌', primaryColor: '#0f766e' },
  // 仅微信客户需 appId: 原已授权 wx 应用 ID
};
```

各端 `assembly.ts` 调用真实 `createRentalWebAssembly` / `createRentalWechatAssembly`，直接采用固定原工厂的 `session/access/contribution`，不自行实现业务或额外注入页面授权。运输按正式宿主公共 `RequestIdInterceptor` 解开一层 `{ data, requestId }` JSON 信封，再交给工厂；缺少 `data` 的成功响应保持不可用，不递归解包业务对象。普通页面请求原 `contribution-page-access`：客户核本人订单读范围，员工核 `order:view` 和原地点/dataScope；外层原 Core 门禁拒绝停用，不能用 `canAct` 或 `order:operate` 写权代替只读页。动作继续走原 `contribution-access`，原收据独立走历史许可。若改接其他 Core，只替换 `assembly.ts` 的正式贡献、会话和准入，外壳合同保持通用。

所有模板使用 `envDir: false`，构建不读 `.env`；没有默认服务器或 HTTP 代理。Web build 输出各模板 `dist/`，由实际宿主托管。跨来源时由原 API 明确允许该网站来源及 `Authorization` / `Idempotency-Key`，不能让模板代理绕过服务端策略。Web hash 只携带登记路由与对象定位，不携带身份。

微信 build 输出独立 `dist/app.js`、`dist/pages/client/index.js`、共享代码及原生视图资产。用微信开发者工具分别导入 `wechat-customer` 和 `wechat-staff`，两份 `project.config.json` 均指向自己的 `dist/`。导入时分别填写已获授权的真实 AppID；开发者工具写入的应用设置保留在各自选装工作区，不复制已有业务应用配置冒充本模板授权。合法域名校验保持开启，并在原应用配置所用 API 的 request 合法域名。客户连接设置的 AppID 必须与导入的应用一致。客户、员工是两个独立应用/会话，不用管理员登录替代。

微信深链只使用登记定位，例如 `pages/client/index?route=rental.my-order&orderId=<原订单ID>`；员工服务页使用 `route=rental.service-occurrence&orderId=<原订单ID>&occurrenceId=<原发生项ID>`。原服务仍校验每个参数。微信启动等待安全随机源和正式装配完成，隐藏/卸载页面不采用迟到启动结果；缺少 `wx.getRandomValues` 时保持不可用，开发者须选择支持该 API 的基础库并在真机核对。

客户端源码未进入固定基线的零 Core 归档白名单。上述单端准备入口提供显式依赖闭包、原锁投影和单端命令；最终发行收录仍需安装/生成器组合固定接入，不把八个客户端 workspace 全部强加给零 Core。此片未改发行白名单、生成器或原有 CI；新增的独立客户端 CI 见下文。

## 原业务链与隔离

正式工厂 `createRentalCustomerClient` / `createRentalStaffClient` 返回 `session`、`access`、`contribution`；宿主将单个贡献装为 `contributions: [contribution]`。两条代表链均不要求 AI 或企业身份：

| 身份 | 页面与动作 | 原 HTTP 与收据 |
| --- | --- | --- |
| 客户 `client` | 我的订单 → 订单详情 → 取消订单 | `/api/client/v1/orders`；原 `POST /orders/:id/cancel/preview`、`POST /orders/:id/cancel`；`GET /orders/:id/cancel-receipt` 携带原键 |
| 员工 `staff` | 订单服务 → 订单服务明细 → 服务执行 → 开始服务 | `/api/staff/v1/rental/v1/orders`；原 `POST /orders/:id/services/:occurrenceId/execution`，固定 `{action: 'start'}`；同级 `GET /execution-receipt` 携带原键 |

客户只读当前空间本人订单；员工沿原订单读/操作权限、workspace、locationScope 和 dataScope。首期列表最多 50 条，当前贡献没有搜索或扫码能力，外壳按贡献隐藏这些入口。费用、取消资格及服务状态由 Rental 决定。顶层导航只接受 `navigation: true`；详情必须由登记目标及参数进入。

原会话工厂负责登录、可信上下文复核、采用与退出；运输不签发凭据、不自动轮换或重放。Web 凭据放独立 `sessionStorage` 槽，微信放独立原生存储槽，均按端、API 来源和 tenantCode 区分。原操作引用另存，只含业务原键、动作和目标，再按 audience/tenant/本人/workspace/location 分区；改变服务器来源不会读到另一个服务器的待核引用。

每次读取和交付前复核当前权限。退出、切身份/范围、失效和后台切换清展示与表单，旧成功和旧鉴权错误不覆盖新会话。清除原对象定位后返回登记首页，不保留缺参数的详情；明确等待登录的深链仍由新会话复权。授权适配必须在原令牌采用前遵守 `ClientLifetime`。原宿主的撤权/停用事件应更新会话修订或使 Runtime 失效，不能只靠菜单隐藏；真实请求仍由原服务拒绝。

微信页面的 `onHide` 与 `onUnload` 均结束当前页面寿命。即使卸载前没有收到隐藏事件，仍阻止原键持久化或动作准备的迟到完成继续派发；已保存的原引用保留，后续只按原收据核对。

写入前必须持久保存原引用。Web 与微信运输均只发送一次，等待超时为 30 秒；Web 在结束时释放计时器和取消监听。超时、取消或断线不能证明未提交，`unknown` 保留原键，仅重读原收据，不换键重试。安全随机源或存储失败时拒绝派发。原收据复权独立于普通页面开关；当前对象状态不替代原收据。

## 待补的 Rental 接点

固定 `268b9bfb` 保留 `34baba2` 原客户端贡献和上下文字节，并组合支持底座 `0.3.0` 的 `0.2.2` 候选及完整 v2 安装观察；该后继只更新完整底座的配对说明与 CI。普通页面只读准入、原取消收据、员工服务开始与原收据及生命周期感知会话均由原贡献提供。本端直接复用原 `access`，不再请求另一套业务工厂。

剩余**可验证的门店范围观察与切换**：`src/contracts.ts` 区分经营空间 `BusinessWorkspace` 和履约地点 `RentalFulfillmentLocation`，不能把切空间作为切门店证据。`src/client-contribution-context.ts` 目前只返回 workspace；`src/http-staff-auth.controller.ts` 将原 locationScope 编入权限指纹，但没有已选 `locationId/locationName`。`clients/contribution/session.ts` 的选择列表/切换也只提供 workspace。

Rental 已有 `clients/staff/context.ts` 的 `createRentalStaffContext`：`loadContext` 根据原 session-context、地点列表及启用状态筛选可用地点，`setCurrentLocation` 只改变本机筛选，不改变服务端权限。最小接续是在原贡献中沿这份能力或同一原服务权威投影当前选择/名称、提供已核候选，并让订单服务列表消费该筛选；切换时发布新观察，使旧页面、请求和原引用分区失效。不要在 Zelo 重写地点业务或增加第二套 Auth，也不能把本机选择升级为服务端授权。当前通用端尚未消费此地点选择，门店切换验收仍未完成。

合入前还须核已定版组合，当前 `0.2.2` 只用于这次开发接线，不代表最终发行组合。缺真实权威仍失败关闭；离线替身不成为生产依赖。

固定 `268b9bfb` 的真实首次员工改密尚有原 Guard 缺口：[CI 46124397790](https://github.com/JinPen-G/Zelo/actions/runs/46124397790) 已完成普通员工建号和 `/staff/v1/auth/login`，随后 `/staff/v1/auth/change-password` 返回 403。原 `src/http-auth.ts` 的 `mustChangePassword` 分支只允许 `/auth/*`，遗漏已经在员工政策及 Controller 登记的改密入口。须由 Rental 修复该精确恢复路径，仍保持 staff audience、原会话/密码及后续业务拒绝；不能用管理员 token、直接改库或放宽全体 staff 路由解决。CI 保留员工原改密断言，安排在独立客户链后执行；两端成功证据分别保存，某端失败不等于另一端或 A03 通过。

## 独立 Web 宿主 CI

[zelo-client-ci.yml](../../.github/workflows/zelo-client-ci.yml) 固定 Node `24.13.0`、原 MySQL `8.4` 镜像摘要及 runner 预装的配套 Chrome/ChromeDriver，直接使用 W3C WebDriver，没有新增测试脚本或框架。独立源码 job 沿上述公开准备入口，对四端逐个执行原锁安装、必要类型和构建，每次输出只含一个端；它使用当前客户端提交所含的底座源码，不启动 API、数据库或浏览器，不能计为目标宿主通过。

API 新装输入是 Zelo `5a6bbbf7593414a122a060018cb1abd87f1c20bf` 与上述 Rental 固定 SHA。真实宿主 job 的两个 Web 分别调用同一准备器，在所选新底座上叠加当前客户端的必要包和原锁条目，各自构建，不共享可写依赖。报告同时登记底座、Rental、客户端完整 SHA，不把任意两条活动分支称作固定组合。

前检沿原内存编译入口消费固定源码的正式 `@rental-os/rental-core/manifest` 工厂，再用正式版本合同检查兼容范围、同源 SDK、客户端贡献出口、固定来源及可选 peer。仓库根 `core.manifest.json` 是历史发行发现快照，不代替新候选工厂；前检没有制成发行归档，也不修改历史清单。当前 Rental 候选声明底座范围 `>=0.2.0 <0.4.0`、新装 SDK `0.2.5`，与所选底座一致。任何缺项仍报告 `unavailable` 并阻止宿主启动；齐备只表示可以尝试真实宿主。**前检成功不表示宿主或 A03 通过，跳过的宿主没有验收证据。**

组合可用后，工作流沿 `tools/prepare-workspace.cjs --fresh-ai`、底座 `package-rental-host.cjs --fresh-ai`、完整 v2 锁和原 18 份迁移制备独占宿主；只在本 job 的 MySQL 中执行原平台与 Rental 初始化。管理员只用于建租户、授 Core 权、成员分配与绑定和建号，浏览器分别登录原客户与普通员工身份，读取真实贡献上下文核对 audience/本人。两个本地 HTTPS 入口只转发原请求，不注入管理员身份或改写业务应答；临时证书仅供该 job 的回环浏览器使用。

当前已编写的宿主步骤包含真实登录、订单导航与详情、客户取消、员工服务开始、手机窄屏、Core 停用直达拒绝、员工撤权和退出，尚未执行。客户取消通过回环代理在转交一次原动作并收到原应答后断开连接，核 `unknown` 持久保留同一原键，再在普通 Core 停用时读取原收据；不伪造业务应答、不重发动作。切身份时延后原客户详情应答，退出后登录另一普通客户，确认旧对象/待核内容不进入新页面；另一实际租户的普通客户用自己凭据访问原订单，由正式服务拒绝。

门店端在浏览器 `820×1180` 视口使用 W3C touch pointer 执行服务动作，再核手机窄屏。这是浏览器触摸输入证据的准备，不能称为实体平板或微信真机已验。临时账号、密钥、浏览器 profile、依赖和构建目录统一留在 job 的 `output/.tmp/zelo-client-ci`，退出时关闭本 job 进程并清理；只上传不含凭据的结果和必要页面截图，保留七天。已验证地点切换和微信宿主仍单独接续。

### 原业务样本的最小接续

原 `ai-fresh-initialize` 只建立品类，正式租户 `seedState` 不生成商品、地点、客户或订单。历史 `seed-demo-order-scenarios` 依赖旧演示租户、预存资产、环境文件和模拟支付，不能用作此新装样本。现已沿固定 Rental Controller、DTO、品类和规则合同编写以下正式准备链，不复制行业规则或直接写库；输入已用原 DTO 离线核对，实际业务准备仍须组合可用后运行：

| 准备对象 | 已有正式入口 | 仍需的固定业务依据 |
| --- | --- | --- |
| 租户与空间 | SaaS `POST /api/platform/tenant-bootstrap`；原 Core 部署准入、租户授权、成员分配、租户及 `rental-workspace` 绑定 | 当前组合兼容及 SDK 声明；不能从初始化返回的模板计数推断已生成订单 |
| 普通客户 | `POST /api/membership/personal` 由受权管理员建号；客户 `/api/client/v1/auth/login`、`change-password` 后重新登录 | 已编写必要建号链；不请求管理员 token 作为客户身份 |
| 普通员工 | `POST /api/platform/roles` 精确订单读/操作权，`POST /api/platform/users/access` 原空间及 locationScope；员工 `/api/staff/v1/auth/login`、`change-password` | 地点投影/选择沿前述原贡献补片；全地点权限的 CI 账号不证明已完成门店切换 |
| 本人可取消订单 | 原经营主体、地点、型号、库存、定价和报价入口 → `POST /api/rental/v1/orders` | 已编写 `camping` 数量型商品、`calendar_day` 原价、`store_pickup_return` 地点及个人 bookingIdentity；必须实际取得原 `draft` 订单并由客户预览、取消及读 `cancel-receipt` |
| 可开始的服务发生项 | 原服务配置纳入报价/订单 → `POST /api/rental/v1/orders/:id/confirm` → `/allocate` → 员工 `/services/:occurrenceId/execution` | 已编写原支持服务及已发布的 `pickup` 付款时机规则；报价保留正常租金与押金，尚未收款或领取。必须由确认/配货产生 `ReadyForPickup` 与 `not_started`，再由员工开始服务；不改订单状态、不伪造支付或收据 |

该 CI 租户的营业规则是通过原草稿和发布入口保存的明确业务配置，不覆盖现存租户或修改品类。取消费用与资格、确认付款门槛、库存及服务状态均由原服务核定。跨租户对象拒绝、切身份/已验证地点后的在途隔离也须使用这些原对象，不用空页或离线替身替代。

## 实际验证范围

已核后继合同与固定 Rental 工厂类型兼容，四个实际 Vite 入口可在内存构建；原生产物无 React/DOM 和未解析包引用。[CI 46119791223](https://github.com/JinPen-G/Zelo/actions/runs/46119791223) 在客户端 `1a80146971f4f525c6d471abdcd4e599036e3d5e` 分别取得四端从原锁独立安装、类型与构建证据；每份产物只选择一个入口，源码/依赖/构建目录清理成功。同次组合前检为 `unavailable`，宿主 job 跳过，不能用整个工作流的 success 宣称真实宿主通过。

必要离线流程使用固定 Rental 源码与显式运输替身，覆盖原登录、只读页不借动作权、停用直达拒绝、一次派发失应答保留原键、停用时原收据、退出及清除详情后返回首页；它不包含真实 Auth/HTTP/数据库，没有新测试脚本或测试框架。

当前固定组合已通过正式工厂兼容前检及四端分别安装/类型/构建。首轮 [宿主 CI 46123198202](https://github.com/JinPen-G/Zelo/actions/runs/46123198202) 成功制备完整 v2 包、执行原 18 份迁移、平台/Rental 初始化和 SaaS 登录，随后 CI 首次准入请求漏传修订得到 400；现按原合同先核空库 `unknown`，再以修订 `0` 显式登记。A03 仍需明确门店映射、合法订单样本及实际宿主结果，不能将已通过的准备阶段当客户/员工页面、动作、身份/范围切换隔离、撤权/Core 停用、跨租户拒绝或 unknown 原收据证据。

Web 桌面、平板触屏、手机窄屏均未取得实页证据；此前 `file:` 离线预览被浏览器策略拒绝，没有换入口绕过。微信还需客户/员工各自已授权 AppID、开发者工具权限、合法域名与测试宿主，分别记录开发者工具及真机证据。`wx` 替身、Web 浏览器和 Vite 构建不能互相代替这些验收。本片没有真实环境调用、迁移、部署、原生 App、收银硬件或离线业务写入。
