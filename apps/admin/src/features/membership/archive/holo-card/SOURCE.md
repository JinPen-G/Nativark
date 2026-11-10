# Holo card 来源

本轮由用户指定复用 `D:/工作文件/uiarc-pro-archive/preview/src/components/required-pro/` 的成品还原组件。归档来源为 https://uiarc.dev/components/holo-card，捕获日期 2026-11-08；属于公开编译预览还原，不声称是付费原始 TSX。

- `original.js` 中从 `let u=` 到 `function b` 结尾逐字提取自 `reference-runtime.js` 的 24925 模块，SHA-256 为 `47243660ad3eb7c805d8c29f7e3e0bbdd2989f4e2dd0273200a8feaa5168906a`。原默认值、事件、弹簧、正反面、光泽、阴影与陀螺仪函数均保留；只将打包器依赖名称接回宿主 React / Motion，减少动态依赖接现有平台偏好。
- `original.css` 是 `reference.css` 内 HoloCard 整行的原样拷贝，SHA-256（去尾部换行）为 `081b216ebe632ac87d7629df2623ba6ee0265dc08670ce44007be07a5fba6611`。保留 5:7 比例、原层叠和 demo 内容样式。
- `../../HoloCard.tsx` 只传原 `intensity=.7`、`gyroscope=false` 与内容，隔开翻面/详情点击；`../../membershipPlanCards.tsx` 通过 front/back 插槽放会员事实，卡内背景在独立 CSS 中适配。
- 卡面选项是当前浏览器的展示偏好，按账号、租户、方案隔离；不改变会员方案版本、权益、发布状态或服务器配置。
- 后台会员卡专用外壳去掉普通 Card 外框，原 Card 的查看详情/退出后操作保留；库存等其他卡片不采用此例外。

原归档的使用许可范围继续适用，不将此目录重新声明为 MIT 或官方开源组件。
