# AIN-10-LB43：正式身份与动作政策适配器

## 实现

- 新增 `FormalKnowledgeAuthorizationAdapter` 与 `FormalMemoryAuthorizationAdapter`，复用真实 `AuthService.resolveAccessContext` 和当前 credentials，逐次校验 actor、audience、scope、权限、资源版本、ACL/revision、policy revision 和过期时间。
- 未注入服务器自有、版本化的动作政策时返回拒绝；不把成员身份、owner、caller scope 或测试 grant 解释为授权。
- Knowledge 与 Memory 动作集合和资源绑定分别校验，客户/automation 不借用人类 Memory 授权。

## 验证

离线定向测试：正式策略缺失拒绝、显式策略且当前 permission 满足时通过、Memory 缺策略拒绝。结果：1 pass，0 fail，0 skip，0 todo，退出码 0。

Knowledge 目录隔离类型检查通过，退出码 0；使用本树 `h.typecheck()`、隔离 shared/Prisma 路径，未写共享生成物。

## 精确公共依赖

主线仍需提供 `FormalKnowledgePolicySource`/`FormalMemoryPolicySource` 的真实生产者：动作、scope、actor、audience、资源 document/memory revision、ACL revision、requiredPermissions、policy revision、expiresAt、不可伪造 grantKey。当前仓库没有可确认的正式 AIN Knowledge/Memory action-policy producer，因此本适配器默认 fail closed。
