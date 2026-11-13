---
version: 1
slug: "src-pages-homepage-tsx"
primary_target: "src/pages/HomePage.tsx"
related_targets: ["src/pages/ProductsPage.tsx","src/pages/ProductDetailPage.tsx","src/pages/BookingPage.tsx","src/pages/OrderPages.tsx","src/pages/AccountPage.tsx","src/pages/LoginPage.tsx","src/pages/DocumentPage.tsx","src/pages/InfoPages.tsx"]
---

# 租户官网

首页采用 Persuade 模式，商品、预约与账户采用 Operate 模式，帮助、协议与指南采用 Read 模式。客户需要找到商品、选择租期与取还安排，并管理本人预约。真实品牌和业务事实通过现有租户接口提供，演示内容明确标识。

## Direction contract

### THESIS

以一次具体的使用计划组织租赁体验。页面先回答能租什么、何时使用、在哪里取还，再引导核对费用与预约。

### OWN-WORLD

白色页面与纯黑文字，深色主题使用纯白文字。Manrope 配合系统中文字体，单色几何标志、自然场景与商品摄影形成演示品牌。辅助文字也保持明确的黑白对比，层级通过字号、字重与排列建立。表单以清楚的边界和持续可见的标签组织。

### STORY

客户从首页查询进入目录，在详情核对商品与条件，在预约中补齐联系人和履约信息，最后从本人订单读取结果。金额、库存、付款与授权沿原业务消费者处理。

### FIRST VIEWPORT

桌面以左侧标题、说明和右侧照片并排开场，下方独立排列租赁查询。查询区域与页面边缘对齐，1280×720 可见完整动作。手机优先呈现标题和查询，照片随后展示，390×844 内可见完整查询动作。

### FORM

负责人委托自主选择方向，采用代码实现。2026-11-13依据负责人对现版的否定重新查看 Saaspo 的 Black & White 集合及 Notch、Medusa、Marathon，参考其清楚的标题、开放排版和黑白操作层级。原基础方向记录的seed:4e7e63273831fa09保留溯源，本轮文字与版式服从负责人的新要求。

### FINISH

Unreviewed and undocumented is unfinished. This build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Interaction and motion

查询条件在目录、详情与预约之间延续。编辑支持取消和确认，失效日期与数量在动作前提示。手机导航支持 Escape、焦点回到触发按钮和选中入口定位。动态反馈集中在菜单展开、输入与按钮状态。页面内容默认可见，系统减少动态效果时缩短过渡。

## Verification boundary

只通过内置浏览器验证本地离线页面。模拟商户配置与异常响应用浏览器请求拦截隔离。真实短信、库存、订单、付款与生产发布仍按原业务验收条件核对。
