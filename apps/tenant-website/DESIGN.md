---
name: 一程租赁 · Yicheng Rentals
description: 白色、深海蓝与暖黄组成的消费者租赁网站设计系统。
colors:
  page: '#ffffff'
  surface: '#f4f6f7'
  surface-raised: '#ffffff'
  ink: '#17334a'
  muted: '#60717e'
  line: '#dfe6ea'
  brand: '#17334a'
  brand-contrast: '#ffffff'
  accent: '#f4ce64'
  brand-soft: color-mix(in srgb, var(--brand) 8%, var(--page))
  danger: '#a93235'
  success: '#276341'
  focus: '#b2780c'
  dark-page: '#111d26'
  dark-surface: '#192934'
  dark-surface-raised: '#20323e'
  dark-ink: '#e8eff3'
  dark-muted: '#b2c0cb'
  dark-line: '#364752'
  dark-brand-soft: color-mix(in srgb, var(--brand) 16%, var(--surface))
  dark-danger: '#ffb5b5'
  dark-success: '#9ad6b4'
  dark-action-hover: '#ffdd80'
typography:
  display:
    fontFamily: '"Manrope", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: clamp(42px, 4.1vw, 60px)
    fontWeight: 650
    lineHeight: 1.24
    letterSpacing: -0.03em
  headline:
    fontFamily: '"Manrope", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: clamp(30px, 3.4vw, 46px)
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: -0.03em
  section-title:
    fontFamily: '"Manrope", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: clamp(24px, 2.4vw, 32px)
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: -0.025em
  product-title:
    fontFamily: '"Manrope", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: 15px
    fontWeight: 650
    lineHeight: 1.6
  body:
    fontFamily: '"Manrope", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: 14px
    lineHeight: 1.9
  label:
    fontFamily: '"Manrope", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: 12px
    lineHeight: 1.5
  button:
    fontFamily: '"Manrope", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: 14px
    fontWeight: 650
    lineHeight: 1.5
  price:
    fontFamily: '"Manrope", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: 18px
    fontWeight: 700
rounded:
  tag: 5px
  finder-field: 7px
  field: 8px
  control: 9px
  card: 12px
  feature: 14px
  chip: 22px
  circle: 50%
spacing:
  '8': 8px
  '12': 12px
  '16': 16px
  '18': 18px
  '20': 20px
  '22': 22px
  '24': 24px
  '28': 28px
  '32': 32px
  '48': 48px
  '64': 64px
  '80': 80px
components:
  button-primary:
    backgroundColor: '{colors.brand}'
    textColor: '{colors.brand-contrast}'
    typography: '{typography.button}'
    rounded: '{rounded.control}'
    padding: 12px 22px
  button-primary-hover:
    backgroundColor: 'color-mix(in srgb, var(--brand) 88%, #000)'
  button-primary-dark:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.ink}'
  button-primary-dark-hover:
    backgroundColor: '{colors.dark-action-hover}'
  button-outline:
    backgroundColor: transparent
    textColor: '{colors.ink}'
    typography: '{typography.button}'
    rounded: '{rounded.control}'
    padding: 12px 22px
  button-outline-hover:
    backgroundColor: '{colors.surface}'
  text-link:
    textColor: '{colors.ink}'
    typography: '{typography.button}'
  input:
    backgroundColor: '{colors.page}'
    textColor: '{colors.ink}'
    rounded: '{rounded.field}'
    padding: 11px 12px
  finder-input:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.finder-field}'
    padding: 0 11px
    height: 46px
  filter-chip:
    backgroundColor: transparent
    textColor: '{colors.ink}'
    rounded: '{rounded.chip}'
    padding: 9px 15px
  filter-chip-selected:
    backgroundColor: '{colors.brand}'
    textColor: '{colors.brand-contrast}'
  quiet-tag:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.tag}'
    padding: 6px 10px
  product-image:
    backgroundColor: '{colors.surface}'
    rounded: '{rounded.card}'
  booking-card:
    textColor: '{colors.ink}'
    rounded: '{rounded.card}'
    padding: 28px
  member-navigation-active:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.field}'
    padding: 12px
  rental-finder:
    backgroundColor: '{colors.surface-raised}'
    rounded: '{rounded.feature}'
    padding: 22px 28px 24px
---

# Design System: 一程租赁 · Yicheng Rentals

## Overview

**Creative North Star** 「海边的租赁计划」

一程租赁的演示视觉以白色页面、深海蓝文字和少量暖黄建立识别。几何门形标志、海边生活照片与直接的商品摄影共同呈现租赁内容。Manrope 配合系统中文字体，标题、条件与金额通过字号和间距形成层次。

商品区域保留清楚的图片与名称，预约和账户区域使用细分隔线、浅底信息块及原生表单。演示品牌由当前实现提供，真实租户的名称、标志、图片与主色由租户配置读取。

**Key Characteristics**

- 深海蓝文字、白色主背景、暖黄局部强调。
- 摄影与商品信息直接相邻，常规内容使用开放布局。
- 圆角控件、细线分隔和局部柔和投影。
- 中英文共用字体栈，金额采用等宽数字。

系统值来自 [styles.css](src/styles.css) 与 [theme.ts](src/theme.ts)。页面模式、路由构成与首屏策略保留在 [surface brief](.impeccable/surfaces/src-pages-homepage-tsx.md)。

## Colors

### Primary

深海蓝用于正文、标题、图标与默认品牌主色。`brand` 可由租户覆盖，`brand-contrast` 由实际背景亮度计算。浅色模式主按钮和选中筛选项读取这两个变量。

**The Tenant Color Rule.** 品牌主色读取当前租户配置，浅色主按钮的文字由亮度计算选择黑色或白色。

### Secondary

暖黄用于演示标志、账户头像与预约步骤。深色模式的主按钮和选中筛选项使用暖黄，文字使用深海蓝。

### Neutral

白色为页面与浮起表面，浅灰蓝用于查询字段、说明区域与页脚，灰蓝用于次要文字，细线色用于表单边框和分隔。`brand-soft` 保留源码的动态混色表达。

深色模式覆盖页面、表面、文字、分隔线及语义色。前置信息中的 `dark-*` 对应这些实际覆盖值，组件继续消费同名 CSS 变量。

错误使用 `danger`，成功提示使用 `success`。浅色键盘焦点使用琥珀色，深色键盘焦点使用暖黄，轮廓宽度（3px）与偏移（4px）来自全局样式。

## Typography

全站使用本地可变 Manrope（200–800），依次回退 PingFang SC、Microsoft YaHei 和 sans-serif。中文由系统字体呈现，标题常用字重（650），品牌字重（750），金额常用字重（700）。

### Hierarchy

- **Display** 用于首页标题，桌面使用前置信息中的流体字号。820px 以下为（42px），600px 以下改为 `clamp(34px, 8.7vw, 46px)`，行高（1.3），字距（-0.025em）。
- **Headline** 用于常规页面标题。600px 以下字号（31px），账户页标题按自身区域使用（32px），手机为（28px）。
- **Section title** 用于首页分区，手机字号（23px），行高（1.5）。商品名使用 `product-title`，手机字号（13px）。
- **Body** 对应文档正文，行宽上限（70ch），行高（1.9）。普通段落默认行高（1.8），业务说明常用（12–14px）。
- **Label / Button** 分别用于表单标签和主要按钮。手机端文本输入与日期输入按现有选择器提升至（16px）。
- **Price** 对应商品卡价格，详情价格为（34px），手机为（31px）。预约合计为（25px），订单合计为（24px）。

**The Numeric Alignment Rule.** 价格、数量和费用明细使用 tabular-nums，金额与计费单位保持可分别辨认。

## Layout

主容器最大宽度（1240px），桌面两侧各留（48px）。1100px 以下两侧各留（32px），600px 以下两侧各留（16px），页面最小宽度（320px）。间距前置信息提取了复用的实际步长，局部构图仍保留源码自身的数值。

目录采用侧栏加内容网格，商品默认三列。首页推荐采用自适应列，820px 以下为两列。手机商品保持两列，详情、预约、订单详情和门店列表按各自媒体规则堆叠。

目录、账户和文档导航在820px 以下改为横向滚动。正文与指南阅读区域上限（780px），文档正文另限制为（70ch）。完整断点及影响范围见 sidecar 的 `extensions.breakpoints`。

## Elevation & Depth

背景切换、单像素边框与留白承担日常层次。桌面查询面板、浮动提示和跳转链接复用一组柔和投影，深色模式提高阴影浓度。手机查询改为浅底平面。精确阴影与过渡值保存在 sidecar。

**The Local Elevation Rule.** 柔和投影用于桌面查询面板、浮动提示及跳转链接的聚焦状态，常规商品与业务内容使用底色和分隔线组织。

按钮和分类入口使用短暂颜色过渡。商品图片悬停轻微放大（1.025），FAQ 箭头随展开旋转（180deg）。系统减少动态效果时，动画和过渡缩短至（0.01ms），页面内容默认可见。

## Shapes

控件使用小圆角，表单、导航和数量字段使用 `field`，按钮及图标入口使用 `control`。分类、预约面板与商品图使用 `card`，横幅和桌面查询面板使用 `feature`。手机商品图改用 `control`。

筛选项采用圆头轮廓，步骤编号、头像和商品图片上的进入箭头为圆形。商品图片容器负责裁切，常规商品文字直接排在图片下方。图标使用线形 SVG，常规尺寸（20px），线宽（1.6），局部按信息密度缩小。

## Components

### Buttons

主按钮沿用租户主色与对比文字，最小高度（48px），水平间距（12px），内边距与字型见前置信息。悬停将品牌主色与黑色混合，按下下移（1px）。描边按钮使用分隔线色，悬停切换表面底色。文字入口通过下划线反馈悬停，图标入口为（44px）方形。

禁用按钮和表单控件使用透明度（0.58）及不可操作指针。可聚焦元素沿用全局焦点轮廓，样例同时包含 hover 与 focus-visible 状态。

### Chips

筛选项最小高度（44px），默认透明底与细边框，选中时改为品牌主色和对比文字，深色模式改为暖黄与深海蓝。当前筛选项使用相同边框作为悬停基线。商品属性标签使用浅底、小圆角及小字号（11px）。

### Cards / Containers

商品卡由图片、名称、简述和价格组成。图片比例（1.08），名称与价格分别链接或展示，图片上的圆形箭头说明可进入详情。缺失价格显示询价入口，不可租显示文字状态。预约面板采用细边框和 `card` 圆角，常规内边距（28px），手机为（22px 19px）。

### Inputs / Fields

普通字段使用页面底色、单像素边框、`field` 圆角与最小高度（46px）。首页查询字段为浅底、无边框，手机改为页面底色与高度（48px）。日期、时间、下拉和文本字段保留原生输入行为，错误说明显示在相关操作附近。

### Navigation

页头固定在滚动顶部，桌面高度基线（76px），820px 以下为（72px），600px 以下为（68px）。桌面当前入口用文字加深与底部线标识，账户和文档当前入口用浅底标识。手机菜单位于页头下方，支持 Escape 关闭和焦点回到触发按钮。横向导航将当前项滚动到可视区域。

### Rental Finder / Page State

查询面板集中品类、门店和取还时间，桌面照片边缘叠放，手机平铺。校验说明使用错误语义色，提交后延续所选条件。页面状态采用居中标题、短说明与恢复动作，错误可由 alert 读出，加载使用 status。代表性 HTML/CSS 样例收录于 [.impeccable/design.json](.impeccable/design.json)。

## Do's and Don'ts

### Do

- Do 延续当前租户的名称、标志、图片和动态主色。
- Do 沿用 Manrope 与系统中文回退，并保留金额的等宽数字。
- Do 为交互元素保留键盘焦点、可读文字和已实现的禁用反馈。
- Do 使用清楚的商品照片，并明确展示演示、参考价格和缺失内容的状态。

### Don't

- Don't 将演示品牌主色硬编码到真实租户配置入口。
- Don't 以当前配置信息补造缺失的商品型号、金额或库存状态。
- Don't 用视觉隐藏替代明确的加载、错误、空内容或不可用说明。
