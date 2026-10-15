# AIN-10-LB40：人工元数据查找入口

## 实现

- 为当前人类知识门面增加 `lookup`：无 documentId 时复用原有有界授权列表；有 documentId 时进行精确元数据读取、当前动作授权和二次读一致性核对。
- 入口不做全文扫描、不返回正文/附件内容、不把历史列表项当授权，也不暴露未授权对象的存在或错误细节。
- 过滤仅使用现有 publication/parsing/indexing 字段，缺分页能力继续明确 `pagination: unavailable`。

## 验证

在既有 `tests/ai-native-knowledge-lane-b-management.test.cjs` 增加实际门面调用，命令退出码 0：2 pass，0 fail，0 skip，0 todo。

`git diff --check` 仅有既存换行提示，无空白错误。`npm run lint -- --pretty false` 仍受当前分支共享类型构建基线阻塞（大量 `@rental-os/shared` 导出缺失）；本片新增文件未形成独立于该基线的错误证据。

## 未验与阻塞

未接真实元数据端口、真实动作政策或多租户数据库；本入口不能替代服务端授权，也不宣称全局搜索可用。
