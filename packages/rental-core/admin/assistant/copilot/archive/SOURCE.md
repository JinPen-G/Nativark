# 来源与复用边界

- 本地来源：`D:/工作文件/uiarc-pro-archive/preview/src/components/ai-side-panel` 及对应 shared 文件，2026-10-29 导入。
- 对应文档随附 [ai-side-panel.md](ai-side-panel.md)；原目录、README、样式、示例和状态实现完整保留。
- 本地归档为公开预览的本地重建，不能称为官方 Pro React 源码。服务商图形来源见 [shared/README.md](shared/README.md)，依赖许可随附 `licenses/`。
- [source-manifest.json](source-manifest.json) 记录导入文件 SHA-256。原 `side-panel.css` SHA-256 为 `f59fd25a4150e886a760257d1c7d18ee9fe49575b764c9742560587b5e9c1143`。
- 按用户“只要按钮和右边侧栏效果”的范围，运行时直接导入原 CSS 的停靠几何和动画；文档演示内容由业务 `CopilotLayout` 装配，主题和圆角覆盖在独立 `copilot.css` 中。未把原文档编辑、应用、撤销功能声称为业务能力。
- 右键菜单使用项目已安装的 `@animate-ui/react` Base UI ContextMenu 原语及平台已有动态偏好适配。参考：https://animate-ui.com/docs/primitives/base-ui/context-menu 。菜单项接入整条记录上下文，不增加业务写入。
- 未修改 vendor 或安装依赖；原 React、Lucide、react-markdown 依赖沿用当前项目版本。
