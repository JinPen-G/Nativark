# AIN-08 真实有界业务读取

## 实现

- `MembershipService.listPersonalOptionsPage` 增加 tenant、当前 ALS 数据范围、精确客户 ID/名称筛选、游标、上限和稳定 `name/id` 排序；原 `listPersonalOptions` 保持兼容。
- AI 会员候选读取优先使用分页端口，旧适配器只作为兼容路径；分页截断在结果中明确 `truncated`，不输出总数、不自动选客户。
- `PaymentRuntimeService` 增加订单级支付意图/退款分页读取，完整绑定 tenant/workspace/order/intent，AI 资金事实标出 `truncated`，不据部分分页计算完整总额。

## 验证

- AIN-08 会员、Lane A 会员查询与支付冒烟：20/20 通过。
- API TypeScript `--noEmit`：退出码 0。
- `git diff --check`：通过。
- 使用离线 Prisma preload 和无效数据库地址；未连接真实数据库、支付渠道或 HTTP。

## 未验证与边界

- 本批没有改变支付、退款、定价、会员资格或 Core 写入行为。
- 真实 MySQL 索引/执行计划和大数据量性能未验证；需要主线在专用数据库验收。
- 兼容旧 Membership/Payment 调用的非 AI 路径仍可使用原方法；新 AI 组合已使用有界端口。
