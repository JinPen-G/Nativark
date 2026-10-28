# Selection toolbar 接入

来源：D:\工作文件\uiarc-pro-archive\preview 的已完成组件。先读 upstream.md；这是本地还原实现，不声称取得官方 Pro TSX。

archive/ 复制完整组件目录；original.css、integration.css 字节保持不变，原始哈希见 source.json。没有额外 shared 依赖，也没有新增 npm 依赖。

SelectionToolbar.tsx 仅补充可选的中文文案、忙碌/禁用、退出 inert 与有效减少动态参数；保留原按钮、计数滚动、分隔线、CSS进出和窄屏换行。adapter.css 绑定管理后台主题色、状态色及容器/按钮圆角。ListCapabilities 负责定位、选择归属、底部空间、焦点恢复与原有业务回调，默认演示未挂载，实际操作由宿主提供。
