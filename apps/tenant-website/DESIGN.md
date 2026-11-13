---
name: 一程租赁 · Yicheng Rentals
description: 纯黑白文字、开放排版与清楚控件边界组成的消费者租赁网站设计系统。
colors:
  page: '#ffffff'
  surface: '#f5f5f5'
  surface-raised: '#ffffff'
  ink: '#000000'
  line: '#dedede'
  control-line: '#767676'
  brand: '#000000'
  brand-contrast: '#ffffff'
  brand-soft: color-mix(in srgb, var(--brand) 8%, var(--page))
  accent: '#ffffff'
  danger: '#a93235'
  success: '#276341'
  dark-page: '#000000'
  dark-surface: '#171717'
  dark-surface-raised: '#222222'
  dark-ink: '#ffffff'
  dark-line: '#3d3d3d'
  dark-control-line: '#999999'
  dark-brand-soft: color-mix(in srgb, var(--brand) 16%, var(--surface))
  dark-danger: '#ffb5b5'
  dark-success: '#9ad6b4'
  dark-action-hover: '#e8e8e8'
typography:
  display:
    fontFamily: '"Manrope", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: clamp(42px, 4.3vw, 62px)
    fontWeight: 650
    lineHeight: 1.25
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
    fontSize: 16px
    fontWeight: 650
    lineHeight: 1.6
  body:
    fontFamily: '"Manrope", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: 14px
    lineHeight: 1.9
  label:
    fontFamily: '"Manrope", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: 13px
    lineHeight: 1.5
  button:
    fontFamily: '"Manrope", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: 14px
    fontWeight: 650
    lineHeight: 1.5
  price:
    fontFamily: '"Manrope", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: 20px
    fontWeight: 700
rounded:
  tag: 5px
  control: 6px
  catalog-select: 7px
  field: 8px
  icon: 9px
  toast: 10px
  card: 12px
  large-photo: 14px
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
  button-primary-dark:
    backgroundColor: '{colors.accent}'
    textColor: '#000000'
  button-primary-dark-hover:
    backgroundColor: '{colors.dark-action-hover}'
  button-disabled:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
  button-outline:
    backgroundColor: transparent
    textColor: '{colors.ink}'
    typography: '{typography.button}'
    rounded: '{rounded.control}'
    padding: 12px 22px
  button-outline-hover:
    backgroundColor: '{colors.surface}'
  icon-button:
    textColor: '{colors.ink}'
    rounded: '{rounded.icon}'
    size: 44px
  text-link:
    textColor: '{colors.ink}'
    typography: '{typography.button}'
  input:
    backgroundColor: '{colors.page}'
    textColor: '{colors.ink}'
    rounded: '{rounded.field}'
    padding: 11px 12px
  finder-input:
    backgroundColor: '{colors.page}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: 0 12px
    height: 50px
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
    rounded: '{rounded.field}'
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
    textColor: '{colors.ink}'
    padding: 28px 0
---

# Design System: 一程租赁 · Yicheng Rentals

## Overview

**Creative North Star** 「黑白与留白」

一程租赁的演示网站以白底黑字、单色标志和直接摄影呈现商品。深色主题采用黑底白字，说明、标签和导航与正文保持同样明确的文字对比。信息层级通过字号、字重、排列与留白表达。

内容区域使用开放排版、细分隔线和局部浅底。表单采用持续可见的标签及清楚的控件边界，图片保留自然色彩。真实租户的名称、标志、图片与有效品牌主色由配置读取。

**Key Characteristics**

- 纯黑／纯白文字，字号、字重和间距建立层级。
- 分隔线组织内容，较深边框标识可操作控件。
- 单色演示标志、自然场景与商品摄影。
- 中英文共用字体栈，金额采用等宽数字。

系统值来自 [styles.css](src/styles.css) 与 [theme.ts](src/theme.ts)。页面模式与构成保留在 [surface brief](.impeccable/surfaces/src-pages-homepage-tsx.md)。

## Colors

### Primary

默认品牌为纯黑，浅色主操作使用品牌底色及对比文字。租户自定义主色仅接受 `#RRGGBB`，无效值回退默认值。文字由背景亮度选择纯黑或纯白。深色主操作使用白底黑字，悬停改为浅灰底。

### Neutral

页面、正文、说明、标签和导航使用主题的纯黑／纯白。浅灰表面用于摘要、提示与选中导航，内容分隔采用 `line`，表单与描边按钮使用对比更清楚的 `control-line`。前置信息中的 `dark-*` 记录深色模式的实际变量覆盖。

`brand-soft` 保留源码的动态混色表达。错误与成功保留 `danger` 和 `success` 语义色。键盘焦点读取 `ink`，轮廓宽度（3px），偏移（4px）。文本选区反转页面与文字颜色。

## Typography

全站采用本地可变 Manrope（200–800），依次回退 PingFang SC、Microsoft YaHei 和 sans-serif。标题常用字重（650），品牌字重（750），金额常用字重（700）。

### Hierarchy

- **Display** 对应首页主标题，桌面使用前置信息的流体字号。820px 以下为（42px），600px 以下改为 `clamp(36px, 8.7vw, 46px)`，行高（1.3），字距（-0.025em）。
- **Headline** 对应常规页面标题，手机字号（31px）。账户页标题为（32px），手机为（28px）。
- **Section title / Product title** 对应分区标题与商品名称。手机分区标题为（23px），行高（1.5），商品名称为（15px）。
- **Body** 对应文档正文，行高（1.9），行宽上限（70ch）。普通段落默认行高（1.8），业务说明常用（12–14px）。
- **Label / Button** 对应表单标签与主操作。查询标签字重（600），手机主要文本和日期输入为（16px）。
- **Price** 对应桌面商品卡价格，手机为（18px）。详情价格为（34px），手机为（31px）。预约与订单合计分别为（25px）与（24px）。金额、数量和费用明细使用 `tabular-nums`。

## Layout

主容器最大宽度（1240px），桌面两侧各留（48px）。1100px 以下两侧各留（32px），600px 以下两侧各留（16px）。`body` 最小宽度为（0），内容通过网格收缩与换行适应窄屏。间距前置信息提取复用的实际步长。

目录为侧栏加内容网格，商品默认三列。首页推荐采用自适应列，820px 以下为两列，手机商品继续使用两列。目录、账户与文档导航在820px 以下改为横向滚动，当前项可滚动到可视区域。

查询字段在1100px 以下采用四列、整行提交按钮，820px 以下改为两列。600px 以下日期字段各占整行，预约面板内全部表单网格改为单列，详情与预约区域按各自媒体规则堆叠。阅读区域上限（780px），文档正文另限制（70ch）。断点保存在 sidecar。

## Elevation & Depth

内容主要依靠留白、背景变化与单像素边框建立层次。浮动提示和聚焦跳转链接使用柔和投影，查询区域通过上下分隔线与页面相接。精确阴影与动态值保存在 sidecar。

按钮按下移动（1px），悬停使用下划线或底色变化。商品图片悬停放大（1.025），FAQ 箭头随展开旋转（180deg）。系统减少动态效果时，动画和过渡缩短至（0.01ms），动画仅迭代一次。

## Shapes

主按钮、账户入口与查询字段采用 `control` 圆角，普通字段、导航和商品图采用 `field`，预约面板与横幅采用 `card`。图标按钮采用 `icon`，登录场景图与详情主图保留较大的圆角（14px）。

筛选项采用圆头轮廓，头像使用圆形。商品图容器负责裁切，名称、简述和价格直接排在图片下方。分类入口使用底部分隔线。常规 SVG 图标尺寸（20px），线宽（1.6），局部按信息密度调整。

## Components

### Buttons

主按钮最小高度（48px），内边距（12px 22px），圆角（6px）。浅色悬停加下划线，深色悬停改变白色底色。描边按钮使用 `control-line`，悬停切换 `surface`。文字入口悬停加下划线，图标入口为（44px）方形。

禁用控件保留完整文字对比与不可操作指针，禁用主／描边按钮增加虚线边框并改用 `surface` 背景。焦点沿用全局纯黑／纯白轮廓。

### Chips

筛选项最小高度（44px），默认透明底与 `line` 边框。选中项使用品牌底色与对比文字，深色主题使用白底黑字。属性标签采用浅底、小圆角和字号（12px）。

### Cards / Containers

商品卡采用摄影、名称、简述和价格的开放排列。图片比例（1.08），圆角（8px），悬停轻微放大。缺失价格显示询价文案，不可租显示文字状态。

预约面板使用 `line` 边框和圆角（12px），桌面内边距（28px），平板（22px），手机（22px 19px）。费用摘要使用 `surface`，保持金额、单位和说明可分别辨认。

### Inputs / Fields

普通字段使用页面底色、`control-line` 边框、圆角（8px）、最小高度（46px）。标签持续可见，placeholder 使用 `ink`。查询字段高度（50px），手机为（48px），日期与下拉保留原生输入行为。错误文字显示在相关操作附近。

### Navigation

页头滚动时固定在顶部，桌面最小高度（80px），820px 以下为（72px），600px 以下为（68px）。当前桌面入口使用底部线，账户和文档当前入口使用浅底及字重。手机菜单支持 Escape 关闭并将焦点归还触发按钮。

### Rental Finder / Page State

查询区保留品类、可用门店和取还时间标签，校验后将条件传递到商品页面。页面状态采用居中标题、短说明与恢复动作，错误支持 alert，加载使用 status。自包含 HTML/CSS 样例见 [.impeccable/design.json](.impeccable/design.json)。

## Do's and Don'ts

### Do

- Do 使用当前主题的纯黑或纯白正文、说明、标签和导航文字。
- Do 使用 control-line 标识表单边界，line 分隔内容。
- Do 保留真实租户配置、键盘焦点、禁用说明及缺失内容的明确状态。
- Do 沿用 Manrope 与系统中文回退，并为金额、数量和费用明细使用 tabular-nums。

### Don't

- Don't 用灰蓝或降低文字透明度建立说明和标签层级。
- Don't 把自然照片中的色彩扩展为固定的界面强调色。
- Don't 为商品缺失的型号、金额、库存或服务能力补造事实。
