# Split bar Pro 的后台接入

来源：[UIArc Split bar](https://uiarc.dev/components/split-bar)。本组件取自用户提供的 `D:/工作文件/uiarc-pro-archive/preview/src/components/split-bar/` 的完整可维护 React 实现。原库记录其来源为 2026-11-08 捕获的公开编译预览，**不是官方受保护的付费 TSX**，不重新声明许可。逐文件来源与取用哈希见 [source-manifest.json](source-manifest.json)。

保留分段展开、图例隐藏/恢复、至少保留一类、键盘导航、外置标签与引线、数字滚动以及原始 CSS。后台适配模块路径、界面语言、主题作用域与共享减少动态偏好；实页发现悬停小分类会令标签槽收起、图例跳走而漏接鼠标点击，因此标签槽按当前数据所有悬停状态的最大需要预留高度，仍使用原布局函数和动画参数。原示例数据、全库运行时和独立字体未带入。后台使用真实订单/库存分类，隐藏图例只影响当前图内占比，完整数量与正式业务动作由原页面负责。

选型还对照了 [Metrics dashboard Pro](https://uiarc.dev/components/blocks/metrics-dashboard) 与 [Treemap](https://uiarc.dev/components/treemap)。当前报表接口提供汇总分类及库存快照，未提供逐日序列，因此本片用完整分类图和下钻图接入原数据，不带入示例趋势或同期变化。
