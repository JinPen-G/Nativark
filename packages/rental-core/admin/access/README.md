# Rental 账号与租户管理呈现

[公共管理适配](index.tsx) 由所选 Rental 宿主显式注入公共应用，复用固定 main 原列表、侧窗、字段和提示。这里不创建会话、Core 授权或另一套平台管理接口。

[运营账号](OperationsAccountPage.tsx) 在原账号侧窗中提供经营空间、角色、数据范围与履约地点。读取来自原空间目录，保存只请求一次原 `/platform/users/access` 或 `/platform/users/:id/access`，关闭既有授权仍明确发送 `isActive: false`。所选组合进入前核当前 Core 目录；旧未选组合使用 `OriginalRentalOperationsAccountPage`，继续原身份与服务端 Guard。[邀请范围](OperatorInvitations.tsx) 复用公共邀请表单及原批次结果恢复。

[租户管理](TenantManagementPage.tsx) 向公共原列表供给真实空间/订单汇总、经营空间侧窗及品类/版本/币种/可选首履约地点。租户创建使用 `/platform/tenant-bootstrap` 同一原事务，不能在前端拆成公共创建租户再创建空间。临时密码只进入本次原结果弹窗。品类选项沿原服务端资格目录，缺失或读取失败禁止创建。

写入均关闭认证刷新后的重发；按钮和回车共享在途 Promise。会话、权限或 Core 变化后旧回调失效，不把取消当作业务回滚。原目录重读失败与已确认写入分别反馈。

[原账号入口断言及定向行为](../../../../tests/tenant-access-admin.test.cjs) 核对单次原接口、关闭授权、地点范围、品类版本/币种、空白地点和过期回调；[原权限矩阵测试](../../../../tests/admin-permission-matrix.test.cjs) 核对隐藏权限、单角色草稿、失效基线与键盘行为。离线结果不代表真实浏览器、数据库及发行验收。
