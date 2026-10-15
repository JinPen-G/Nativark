# LB19 当前身份驱动的结构化记忆入口

在LB18真实确认生产之上补read/propose/change；宿主不传scope/actor，change只允许modify/delete，确认只走confirm生产链。复用原StructuredMemoryService/Prisma仓储/结构化值schema，不另造状态机或权限码。

原记忆服务每个动作授权阶段现在经当前AuthService身份复验包装，再调用必需的正式MemoryAuthorizationPort；等待仓储读取期间撤销会话，下一次复验拒绝。此包装不能替代文档/偏好动作政策，未配置依赖仍不可用。修改后的旧确认字段清除，状态proposed，不可当已确认偏好消费；删除仍是原持久tombstone而非本地隐藏。

红测1pass/1fail（propose未提供），实现后同一文件2pass/0fail/cancel/skip/todo，exit0；transpileOnly:false检查本树真实类型。命令node --test tests/ai-native-memory-lane-b-consent.test.cjs；固定offline DATABASE_URL及双preload，同LB18，audit为本树output/lb19-audit。实际服务链覆盖提议→确认→查看→修改失效→读取等待撤权→删除，拒绝任意confirmationId快捷操作。仅一次定向冒烟，不扩大矩阵。diff --check退出0。

服务器组合可直接new PersistentMemoryConsentService({db,auth,credentials,authorization,clock})；auth为现有AuthService，credentials为现有请求会话来源，authorization必须由主线交付正式记忆动作政策。未自动注册HTTP/AppModule或作为模型工具。客户端、automation和platform/tenant scope尚不支持；没有宣称其兼容。真实MySQL/HTTP/模型/部署未验；确认/偏好两个持久边界间中断回归仍需集中后补。原正式ACL、有界文件读取阻塞仍见LB15。无完成率更新或整项结项声明。
