---
name: Tenant Rental Website
description: 围绕使用计划的黑白租赁官网；摄影首屏、紧凑推荐与清楚的业务和账户页面。
colors:
  brand: '#007aff'
  brand-contrast: '#ffffff'
  page: '#fff'
  ink: '#181818'
  muted: '#66686d'
  surface: '#f4f4f4'
  card: '#ffffff'
  line: '#dedee0'
  object-plate: '#f1f4f7'
  announcement: '#171717'
  footer-muted: '#b7b7bb'
  store-strip: '#e8edf1'
  error: '#b33838'
  dark-page: '#121212'
  dark-ink: '#f5f5f5'
  dark-muted: '#b5b5b8'
  dark-surface: '#202020'
  dark-line: '#414144'
  dark-finder: '#232323'
  dark-offer: '#292929'
  dark-store-strip: '#272c30'
  card-muted: '#f1f3f5'
  field: '#fff'
  soft: '#f5f6f7'
  soft-hover: '#e9ecef'
  dark-card: '#202020'
  dark-card-muted: '#292929'
  dark-field: '#202020'
  dark-soft: '#242424'
  dark-soft-hover: '#303030'
  dark-error: '#ffb2ad'
typography:
  display:
    fontFamily: '''Host Grotesk'', ''PingFang SC'', ''Microsoft YaHei'', sans-serif'
    fontSize: clamp(44px, 4.8vw, 72px)
    fontWeight: 500
    lineHeight: 1.12
    letterSpacing: -.035em
  headline:
    fontFamily: '''Host Grotesk'', ''PingFang SC'', ''Microsoft YaHei'', sans-serif'
    fontSize: clamp(28px, 2.7vw, 38px)
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: -.03em
  product-title:
    fontFamily: '''Host Grotesk'', ''PingFang SC'', ''Microsoft YaHei'', sans-serif'
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.5
  campaign-body:
    fontFamily: '''Host Grotesk'', ''PingFang SC'', ''Microsoft YaHei'', sans-serif'
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.85
  finder-label:
    fontFamily: '''Host Grotesk'', ''PingFang SC'', ''Microsoft YaHei'', sans-serif'
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.6
  finder-control:
    fontFamily: '''Host Grotesk'', ''PingFang SC'', ''Microsoft YaHei'', sans-serif'
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.6
  page:
    fontFamily: '''Host Grotesk'', ''PingFang SC'', ''Microsoft YaHei'', sans-serif'
    fontSize: clamp(28px, 3vw, 40px)
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: -.025em
  detail:
    fontFamily: '''Host Grotesk'', ''PingFang SC'', ''Microsoft YaHei'', sans-serif'
    fontSize: clamp(28px, 2.6vw, 36px)
    fontWeight: 500
    lineHeight: 1.25
  catalog-product:
    fontFamily: '''Host Grotesk'', ''PingFang SC'', ''Microsoft YaHei'', sans-serif'
    fontSize: 15px
    fontWeight: 500
    lineHeight: 1.5
  body:
    fontFamily: '''Host Grotesk'', ''PingFang SC'', ''Microsoft YaHei'', sans-serif'
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.85
  field-label:
    fontFamily: '''Host Grotesk'', ''PingFang SC'', ''Microsoft YaHei'', sans-serif'
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.6
  display-mobile:
    fontFamily: '''Host Grotesk'', ''PingFang SC'', ''Microsoft YaHei'', sans-serif'
    fontSize: clamp(32px, 9vw, 42px)
    fontWeight: 500
    lineHeight: 1.18
rounded:
  field: 8px
  button: 10px
  panel: 12px
  header-glass: 16px
  circle: 50%
spacing:
  s8: 8px
  s12: 12px
  s16: 16px
  s24: 24px
  s32: 32px
  s48: 48px
  s64: 64px
  s96: 96px
  s20: 20px
  s28: 28px
  s40: 40px
  s72: 72px
components:
  finder-submit:
    backgroundColor: '{colors.brand}'
    textColor: '{colors.brand-contrast}'
    rounded: '{rounded.field}'
    padding: 0 24px
    height: 52px
  button-primary:
    backgroundColor: '{colors.brand}'
    textColor: '{colors.brand-contrast}'
    rounded: '{rounded.button}'
    padding: 0 24px
    height: 46px
  button-text:
    backgroundColor: transparent
    textColor: '{colors.ink}'
    rounded: '0'
    padding: '0'
    height: 36px
  finder-field:
    backgroundColor: transparent
    textColor: '{colors.ink}'
    rounded: '0'
    height: 32px
  navigation:
    textColor: '{colors.ink}'
    height: 88px
  finder-category:
    backgroundColor: transparent
    textColor: '{colors.muted}'
    rounded: '0'
    padding: 21px 0 17px
  home-product:
    backgroundColor: transparent
    textColor: '{colors.ink}'
    rounded: '0'
  home-offer:
    backgroundColor: transparent
    textColor: '{colors.ink}'
    rounded: '0'
  finder-panel:
    backgroundColor: '{colors.card}'
    textColor: '{colors.ink}'
    rounded: '{rounded.panel}'
    padding: 0 28px 24px
  business-field:
    backgroundColor: '{colors.field}'
    textColor: '{colors.ink}'
    rounded: '{rounded.field}'
    padding: 10px 12px
    height: 44px
  catalog-conditions:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.button}'
    padding: 16px 20px
  booking-summary:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.panel}'
    padding: 24px
  catalog-product:
    backgroundColor: transparent
    textColor: '{colors.ink}'
  button-outline:
    backgroundColor: transparent
    textColor: '{colors.ink}'
    rounded: '{rounded.button}'
    padding: 0 24px
    height: 46px
  member-navigation:
    textColor: '{colors.muted}'
    rounded: '{rounded.field}'
    padding: 12px
    height: 46px
  auth-field:
    backgroundColor: '{colors.field}'
    textColor: '{colors.ink}'
    rounded: '{rounded.field}'
    height: 48px
---

# Design System: Tenant Rental Website

## Overview

**Creative North Star: "为下一次计划 / For your next plan"**

宽幅生活方式摄影、黑白品牌标志与清爽中性色建立国际租赁公司的形象。租户品牌色用于明确操作和选中状态；正立的轻中等字重与充足留白，让商品和实际使用场景成为主角。用户已否定旧画册式视觉方向，并接受当前品牌首页方向。

当前实现把同一视觉语言延伸至目录、商品详情、预约、登录、账户、订单、关于、指南、常见问题与政策阅读页。首页保留已接受的摄影与查询组合器构图；首屏之后用小型品类入口、六件紧凑推荐和纯文字活动行提高浏览密度。内部页面通过紧凑标题、开放列表、完整商品图像、统一线性图标和中性表面保持连续性。

提取依据为 `src/main.tsx` 的实际级联顺序：`styles.css` → `editorial.css` → `brand-home.css` → `storefront.css`，以及当前页面组件、共享布局、`SiteIcon`、`PageHeader`、`CatalogConditions` 和 `theme.ts`。品牌方向沿用 [PRODUCT.md](PRODUCT.md) 与 [首页修正 brief](.impeccable/homepage-corrected-brief.md)。本文件和组件预览来自当前源码。前一阶段已通过 24 项真实 Playwright 演示交互检查，覆盖查询、目录、详情、本地预约与订单、账户禁用保存、帮助搜索、登录注册与密码显示、键盘操作、移动菜单、语言、主题、favicon 和滚动导航；该阶段浏览器矩阵为 74 次路由渲染与 50 张全页截图，没有横向溢出、破损图片或运行时异常，320px 英文指南另行复查。此次交互打磨另通过 17 项针对性浏览器检查与 8 张新截图，覆盖条件编辑、链接、横向导航、预约、公开阅读入口及 320/390/768/1440px 视口；复审后两处修正又通过 5 项检查，验证平板后段品类导航和保留租期门店的空结果恢复。该次交互打磨截图使用 `.impeccable/review` 的 `refinement` 前缀及更新后的桌面、手机图；所测演示流程无 API 请求或运行时异常，新截图无横向溢出、破损图片或运行时异常。前一阶段完整矩阵没有在此次打磨中重跑。最后两处修正之后，最终构建、216 次离线页面渲染与 9 项 favicon 检查再次通过。独立复审已确认本次打磨中评分要求的两处修正完成。以上均不证明真实后端、库存锁定、支付或生产验收。参考筛选和获取限制记录在 [.impeccable/reference-notes.md](.impeccable/reference-notes.md)，没有确认参考站点的实际动画时序。

本次图标动态是既有视觉系统的局部延伸，黑白品牌、页面构图、字体、图标显示尺寸和业务路径沿用现状。当前图标范围通过 27 项真实 Chromium 针对性检查，覆盖中断与归位、Escape 焦点恢复、减少动态效果、标签和按钮稳定性、320/390/768/1440px、英文与深色；9 张新路由截图和 4 张支持/中间帧保存在 `.impeccable/review/icons-*.png`。所测演示流程无 API 请求、运行时异常、横向溢出或破损图片。独立复审仅检查源码与全部 13 张图，结论为可交付、无实质修正；浏览器结论来自另行执行的 Chromium 检查。本轮构建通过，仍有约 523kB 初始 JavaScript chunk 警告，未据此证明性能失败；216 次静态渲染和 9 项 favicon 检查再次通过，属于离线证据。上述旧 74/50 矩阵及 17/8/5 交互打磨记录没有在本轮重跑。本轮也不代表实体触屏设备、真实服务、库存锁定、支付或生产验收。

**Key Characteristics:**

- 黑白 SVG 标志，租户主色保留配置能力。
- 宽幅摄影建立首屏；后续品类入口、推荐与活动保持紧凑，商品图像完整显示。
- 首页查询组合器与目录条件摘要连续衔接，推荐内容与查询结果分开。
- 紧凑内页标题、开放列表和中性浅深色表面贯穿租赁流程。
- 标准 Lucide 场景图标、键盘焦点和减少动态效果规则贯穿页面。
- 文字说清计划、设备和取还安排，不用泛化的生活口号。

## Colors

基础是干净黑白和中性灰，摄影提供丰富色彩，租户主色负责操作与选中状态。前置 token 是源码当前值；`brand` 记录平台回退值，运行时由租户配置覆盖。

### Primary

- **租户操作色**（`brand` / `brand-contrast`）：查询、主要按钮、选中导航和键盘焦点。源码在运行时写入配对色，不能用固定黑白文字替代配对变量。

### Neutral

- **清白页面与石墨文字**（`page` / `ink` / `muted`）：全站正文、背景与辅助信息。
- **浅灰分区与细线**（`surface` / `line`）：活动区、条件摘要、报价汇总、费用汇总与内容分隔。
- **白色容器与字段**（`card` / `field`）、**柔灰状态表面**（`card-muted` / `soft` / `soft-hover`）：承载表单及次要状态。**柔冷商品底板**（`object-plate`）承载完整商品图像。
- **墨黑品牌带**（`announcement`）用于公告和页脚；页脚辅助文字使用 `footer-muted`。**淡冷门店带**（`store-strip`）承载门店入口。
- **错误红**（`error` / `dark-error`）表示日期等表单错误，并按主题切换。
- **深色中性表面组**（`dark-page`、`dark-ink`、`dark-muted`、`dark-surface`、`dark-line`、`dark-card`、`dark-card-muted`、`dark-field`、`dark-soft`、`dark-soft-hover`）覆盖原先偏绿的共享表面；首页查询与门店带分别使用 `dark-finder`、`dark-store-strip`；既有 `dark-offer` token 保留，当前文字活动行在浅深色均为透明底。商品图板仍沿用柔冷底板，不能假定所有图板会随主题变黑。

**The Tenant Identity Rule.** 黑白演示标志不替代真实租户身份；操作色始终使用租户主色及其配对对比色。

## Typography

**Display Font:** Host Grotesk，中文回退 PingFang SC、Microsoft YaHei、sans-serif。
**Body Font:** 同一字体栈。Host Grotesk 使用本地 Latin WOFF2，可变字重范围为 300–800，`font-display: swap`。

**Character:** 正立、清晰、轻中等字重。中文依赖系统字形；标题紧凑，解释性文案保持舒展行高。没有衬线字体或独立等宽标签体系。

### Hierarchy

- **Display**（`display`）：首页摄影主标题；手机使用 `display-mobile` / 1.18，保持场景内左对齐。
- **Headline**（`headline`）：共享区块标题基础；首页推荐覆盖为桌面 30px、手机 25px，活动及步骤为桌面 28px、手机 24px。
- **Page / Detail**（`page` / `detail`）：目录及阅读页、商品详情的两档内页标题；手机均为 28px，页面标题行高为 1.3，详情为 1.25。
- **Product titles**（`product-title` / `catalog-product`）：紧凑推荐在桌面与手机均为 14px / 1.5；目录桌面 15px、手机 14px，保持独立密度。
- **Body**（`body`）：详情与阅读正文；页面引言使用 1.8 行高、最多 65ch，详情正文最多 72ch。
- **Campaign body**（`campaign-body`）：摄影说明最多 440px；手机最多 245px，并降为 12px / 1.8。
- **Labels**（`finder-label` / `finder-control` / `field-label`）：持续可见的短标签与输入；首页手机标签、控件分别为 10px、12px。
- **Daily price**：紧凑推荐金额桌面 23px、手机 22px，目录桌面 24px、手机 22px，详情桌面 38px、手机 34px。金额使用表格数字，起价说明与单位保持较小层级且持续可见。

**The Quiet Hierarchy Rule.** 先用字号、行高和留白建立层级；中文使用系统回退字形，不将其称为 Host Grotesk 中文字体。

## Layout

共享容器在常规桌面最多 1504px，左右内边距 32px，得到最多 1440px 的内容。1600px 起改为最多 1440px、去除内边距；1199px 及以下安全边距为 24px；767px 及以下为 16px。不要简写为所有视口都有固定内容宽度。

首页摄影桌面高 530px、1199px 以下 500px、手机 410px；查询组合器分别上移 66px、60px、46px。首屏之后按内容密度收紧：品类入口内部上下 24px，手机上方 28px、内部上 12px 下 24px；推荐与活动区前距桌面 48px、手机 32px。活动区内部上下 40px、手机 28px。服务步骤无额外前距，上下 48px、手机 32px；门店带无额外前距，上下 32px、手机 24px。门店带内部容器不叠加上下内边距。紧凑商品行内部上下 18px、手机 14px，价格与动作位于同一组。

查询字段桌面五列；1199px 以下提交独占下一行；手机两列字段与全宽提交。品类入口桌面为小图标文字网格，手机横向滚动；单品类租户使用桌面 36px、手机 32px 子品类缩略图。首页最多六件推荐，桌面三列、1199px 以下两列、手机单列，每件为图文横排；详情相关推荐共用此组件，桌面两列、手机单列。活动使用分隔线文字行，820px 以下区块引言和内容上下排列；不再重复铺设大幅活动商品图。

目录桌面采用 176px 侧栏、32px 间距与四列结果；1199px 以下为 152px 侧栏、24px 间距及三列；820px 及以下整个品类导航移至结果网格上方并横向滚动，不保留窄左栏；手机结果两列、列距 14px、行距 24px。条件摘要和展开字段共用连续灰色表面，桌面门店与起还日期三列，手机逐行呈现。

详情桌面为 .9:1 双列、间距 48px，图板最多 560px；预约为主表单与 340px 汇总栏、间距 48px；1199px 以下汇总栏为 300px、间距 24px。820px 及以下详情和预约单列、汇总取消粘性。文档为 200px 导航、最多 840px 正文及 64px 间距；指南桌面为 240px 左侧本页目录与详细步骤、64px 间距，1199px 以下为 190px / 32px，820px 以下单列，手机本页目录横向滚动。指南的网格与文字子项允许收缩至零最小宽度并换行，避免窄屏英文溢出。内页底部留白桌面 64px、手机 40px；引言上下 32px、手机 24px。

共享顶栏桌面高 88px、手机 72px，保持粘性。移动菜单保留订单、账户、语言与主题入口；手机语言、主题和菜单工具按钮至少为 44px 点击目标。页脚按响应式网格收拢，上内边距桌面 40px、手机 32px，主内容底内边距桌面 32px、手机 24px；本轮没有把首页构图复制到内页。

## Elevation & Depth

内容通过留白、摄影、实色分区及细分隔线建立层级。查询组合器有结构性投影；商品图板、报价汇总、登录表单与业务内容不普遍抬升。共享导航继承滚动后的局部毛玻璃伪元素（圆角 16px、模糊 4px），而顶栏背景为页面实色，不应描述为整个顶栏都透明。

### Shadow Vocabulary

- **查询组合器**：`0 12px 36px rgba(22,27,33,.12)`，区分摄影与可操作表单。
- **移动菜单**：`0 12px 24px rgba(18,30,22,.1)`；基础深色规则仍带黑色投影。
- **语言浮层**：`0 12px 28px rgba(34,53,72,.13)`；深色取消。

**The Purposeful Depth Rule.** 查询组合器与临时浮层可以使用结构性阴影；商品和业务内容保持开放，不能把每块内容变成悬浮卡片。

## Shapes

查询组合器和报价汇总使用 `panel` 柔角；紧凑推荐图板使用 `button` 柔角，推荐行和活动行自身无圆角；业务按钮与条件摘要使用 `button`；字段与筛选使用 `field`；登录表单保持开放透明。宽幅摄影保持方正全宽。会员导航、优惠券、通知、指南与关于页信息采用开放分组和水平分隔。订单列表保留带淡灰编号栏的有框单据；地址条目保留浅灰柔角表面，不把所有页面描述成同一种开放行。

图标统一使用现有依赖 Lucide React 的标准字形，24×24 坐标网格、1.75 描边、圆头和圆连接，继承文字色；通用显示尺寸 20px，按钮 18px、顶栏 19px、辅助元信息 14–18px。它们提供必要的动作或类型提示，不替代文字。品类按配置映射相机、帐篷、汽车、电脑、工具、家居、婴童和骑行，未知键回退 Shapes；不是为每个链接添箭头。面包屑使用有序列表与当前位置标记。

## Components

### Icon Motion

图标在原有线性字形内响应操作，保留 Shapes 中的坐标网格、描边和显示尺寸。24 个本地 Animate UI registry 图标保留原有绘制与动画；另外 16 个对象沿用当前安装版本 Lucide 的准确路径，通过 Animate UI icon core 提供与对象相关的动作。运行时不请求 registry；来源与许可记录在 `src/components/animate-ui/README.md` 及随附许可文件。现有 `@animate-ui/react`（2.3.0）和 `motion`（14.6.0）已在应用与 lockfile 声明，本轮没有安装依赖。

- **触发与归位**：图标跟随最近的既有按钮、链接、标签或原生 disclosure；细指针 hover、键盘 focus 和触屏 pointer press 触发，标签包含其原生字段。禁用控件不播放，不增加焦点停靠点，也不截获业务事件。非交互说明图标保持静止，没有闲置循环或页面加载编排；core 处理减少动态效果、中断和归位。各对象使用自身文件中的动作幅度与时间，正常播放速度为 1。
- **菜单状态**：三条线的端点随真实 open 状态变为关闭图形，使用弹簧（stiffness 200 / damping 20）；中线透明度过渡为 120ms。减少动态效果时直接绘制对应的静态端点和透明度，仍准确表示当前展开状态。
- **展开状态**：条件编辑依 `aria-expanded`、FAQ 依原生 `details[open]` 旋转箭头至 180°，仅改变图标，不移动标签。两者共用 180ms `cubic-bezier(.16,1,.3,1)` ease-out 过渡。减少动态效果时取消过渡，保留正确方向。
- **静态与状态角色**：面包屑分隔、评分、时钟与说明角色保持原有语义；加载图标仍只表达加载，沿用 1s 线性旋转，并在减少动态效果时停止。图标自身为装饰性内容，名称和展开状态继续由原有控件提供。

### Buttons

主要操作清楚，低频装饰。

- **首页查询**：租户操作色及配对文字，`field` 柔角，水平内边距 24px，最小高 52px；1199px 以下为 46px。悬停主色与黑色混合至 86%。
- **共享主按钮**：`button` 柔角，最小高 46px，水平内边距 24px；悬停混黑至 82%，无抬升和阴影。详情预约按钮为 48px。
- **描边次按钮**：透明底、细线边框和正文色，用于新增地址、验证码、详情、重试与返回；悬停使用分区底色和辅助色边框。旧组件仍有白按钮样式，但不作为当前页面主模式。
- **商品文字操作**：无边框、透明背景，仅保留动作文字，最小高 36px、手机 40px；悬停为租户主色，禁用为辅助色。
- **Focus / Disabled**：全局可见键盘焦点使用租户主色 2px 描边、偏移 5px；字段保留自身焦点实现。禁用按钮透明度 0.5，业务状态决定可用性。

### Chips

首页查询器品类是文字页签：默认辅助色，选中正文色、500 字重与 2px 品牌底边线，使用 `aria-pressed`。目录筛选是 `field` 柔角的有框短按钮，最小高 36px、内边距 8px 14px；选中使用品牌浅底、品牌文字和边框，浅深色保持同一规则。

### Cards / Containers

首页与详情相关推荐使用共享紧凑商品行：桌面 104px 方形图板与右侧文字，1199px 以下图板 80px、手机 88px，图像内边距 6px，完整 `contain` 展示；行本体透明、底部分隔线，无阴影。目录继续采用图板与下方文字，图板比例桌面 4:3、手机 1.15，图像内边距桌面 12px、手机 6px。目录标题最多两行，卡片正文采用可伸展纵向布局，将元信息及金额与文字动作组对齐到下方；手机先金额再动作，动作最小高 44px。紧凑行不显示目录库存及评分行。支持悬停的设备上商品图以 220ms 缩放至 1.02；减少动态效果时取消位移和过渡。没有右下角圆形箭头。

活动使用透明底、无圆角的纯文字行，以水平分隔线区分；标题、说明在前，演示活动标识与真实探索动作位于下方同一行，没有固定最小高度或重复大图。预约分组使用顶部分隔线，顶部步骤自身无边框，浅深色一致；报价汇总使用浅灰实面、24px 内边距，手机 20px。登录实际采用开放表单与独立摄影双列，保持表单边界和内容节奏。账户按地址、优惠券和通知呈现内容；订单采用有框单据列表与独立费用汇总。信息、金额和动作在手机重新排布。

### Inputs / Fields

首页组合器字段为无外框透明的原生选择与日期输入，桌面高 32px、手机 38px；标签持续可见，字段间细线分隔，手机增加底边线。错误提示使用主题对应错误色。

目录条件及业务字段采用有边框的 `field` 表面、`field` 柔角、最小高 44px；详情输入内边距 10px 12px。详情表单焦点改变品牌边框并移除阴影；键盘 focus-visible 仍使用 2px 品牌外框、偏移 2px。登录、地址和会员搜索输入保留同样键盘焦点；目录及帮助搜索组使用品牌 2px 外框、偏移 2px。保留真实的原生控件、标签、禁用和错误状态。手机商品详情和预约的日期、联系人字段单列全宽；条件编辑、详情、预约、登录及地址表单的可编辑字段字号为 16px，不能因原生日期控件或英文文案撑宽页面。

### Navigation

共享导航为文字链接，桌面 14px，选中使用品牌色及下划线。顶栏保留语言、主题、订单和账户，隐藏旧全局搜索和重复租赁 CTA。黑白 SVG 按浅深标志配置切换，真实租户标志仍使用其资源。favicon 使用提供 SVG 中的独立图形 mark：浅色黑、深色白，首屏内联脚本先同步主题，运行时保持主题切换；真实租户的自定义 `logoCompact` 优先。内页标题和面包屑共用语义组件；文档导航使用当前页标记，手机可横向滚动。账户、品类、查询器品类与详情页签在选中项改变、语言切换和视口变化后，只在各自横向容器内展示当前项，不让键盘焦点触发页面纵向跳动。页脚为墨黑底、白色标志与分组标题、灰色辅助文字。页脚语言为可键盘操作的原生 select，使用地球与展开提示。

### Rental Finder and Catalog Conditions

首页查询组合器上方为品类文字页签，下方为地点与时间。城市变化清空门店；没有城市元数据时允许直接选门店，不从地址猜城市。提交导航到品类列表，由列表处理可用性和价格；推荐商品独立存在。

目录条件摘要使用门店、日期与展开箭头。展开编辑保留 URL 查询参数，摘要与字段连成一个灰色表面；应用后关闭，取消恢复当前 URL 中的门店与日期草稿；同店取还随门店变化更新，已有异店归还协议在未改变取货门店时保留。日期错误使用可感知提示；库存和价格仍由原有数据层决定。清除搜索只删除搜索词，保留日期、门店和其他条件；空结果仅在确有品类或二级分类限制时显示对应恢复动作，已在全部商品时不重复显示同一入口。详情面包屑、相关推荐和预约返回商品链接携带用户当前编辑的日期、数量与取还方式，切换关联商品时按目标商品重新初始化有效数量与选项。租户链接保持单一身份参数并保留 hash；这些条件仅表达导航意图，库存、报价和订单权限仍归既有服务。侧车组件预览复现外观和 CSS 状态，不模拟这些业务行为。

摄影入场为 900ms 缩放归位，曲线 `cubic-bezier(.16,1,.3,1)`；首页与目录商品图悬停过渡为 220ms，限支持悬停的设备。保留既有页面进出运动；加载图标为 1s 线性旋转。`prefers-reduced-motion` 移除动画、过渡和平滑滚动。

### Member, Authentication, and Orders

会员桌面布局是 220px 导航与内容双列、48px 间距；1199px 以下为 190px / 32px，820px 以下导航横向滚动。导航用 ReceiptText、MapPinned、TicketPercent、Bell 分别指向订单、地址、优惠券和通知，持续显示文字与当前页标记；当前项采用中性分区底色和正文色。地址工具栏与表单可以预览；演示保存禁用，优惠券和通知如实为空，不编造账户数据。

登录和注册桌面为最多 1100px 容器、440px 表单与摄影、80px 间距；1199px 以下等分双列、48px 间距；820px 以下仅保留最多 440px 表单。输入与主操作为 48px 高。登录支持短信或密码，注册是独立视图 `/login?view=register`，密码显示按钮有可访问名称；演示不发送短信或执行登录。登录底部提供面向访客的协议与隐私阅读链接；不使用平台租户技术说明代替阅读入口。真实账户沿用既有认证服务与状态。

订单列表的单据顶部为编号和状态；正文展示商品、时间、门店与金额，底部保留明确详情动作。详情采用正文与 340px 费用栏、48px 间距；1199px 以下为 300px / 28px；820px 以下单列。原始 Core 事实、缺失值、费用、支付状态及原有幂等策略保持业务层权威，不根据本地预览推定支付成功。

### Help and Page States

关于页以简短引言、摄影与定义列表说明租赁原则；门店目录只呈现配置中支持自取的门店、地址及已有营业时间，并通过门店查询参数链接到目录，不从地址推断城市或补造服务承诺。演示门店保留标识。指南左侧本页目录对应右侧四个详细步骤；手机改为局部横向索引。

帮助页使用有可见标签的搜索字段、结果计数和原生 FAQ disclosure；未匹配可清空搜索。协议和政策只显示已有租户内容、真实外链或诚实缺失状态；404 与页面错误采用相同中性状态组件和明确返回/重试动作，覆盖中文与英文。账户与公共空态采用紧凑图标和内容，最小高桌面 200px、手机 180px，避免空状态占据整屏。

首页步骤分别用 CalendarDays、SearchCheck、Store 表示时间、挑选和取还；取货与配送用 Store / Truck 区分；验机使用 ClipboardCheck；订单入口使用 ReceiptText。箭头只服务面包屑、展开或真实方向控制，首页各区链接与商品不重复加箭头。

**The Plain Copy Rule.** 用短句说清计划、商品、费用与取还；已被否定的“好物”式口号不回填。演示 hero 与英文版本由租户配置提供，真实租户文案保持配置所有权。

## Do's and Don'ts

### Do:

- **Do** 用当前品牌首页的黑白标志、清爽中性色和租户操作色延续内页。
- **Do** 让首屏生活方式摄影铺满画面，让紧凑推荐与目录商品图像完整显示。
- **Do** 沿用共享内容边缘和紧凑内页字号，在手机端保留双列查询字段与横向品类滚动。
- **Do** 保持服务步骤和门店带的零前距，避免把区块间距与内部留白重复相加。
- **Do** 按动作和对象选择标准 Lucide 图标，保留动作文字、金额单位、辅助说明和真实查询条件。
- **Do** 区分推荐起价与按日期、门店查询的结果，并在活动正文下方、动作旁保留演示标识。
- **Do** 保留键盘焦点、减少动态效果和真实租户配置。

### Don't:

- **Don't** 恢复已被否定的画册式首页、银绿色整体视觉或商品结果优先首屏。
- **Don't** 使用旧蓝色 PNG 标志，或把平台默认蓝固化为真实租户品牌。
- **Don't** 恢复“好物相伴”“好物随行”等已否定口号，或在每个链接重复放箭头和勾。
- **Don't** 用一张泛化大卡片代替会员各分区和完整登录注册表单。
- **Don't** 把首页摄影构图或卡片布局强行应用到所有业务页面。
- **Don't** 将旧偏绿深色表面或旧大号内页标题当作现行规范。
- **Don't** 把演示图片、活动、参考起价或本地预约描述为真实商业承诺。
- **Don't** 把源码提取、演示浏览器交互或截图检查称为真实库存、支付或生产验收。
- **Don't** 在首页下半部分反复使用大幅商品图；采用当前紧凑推荐和文字活动行。
