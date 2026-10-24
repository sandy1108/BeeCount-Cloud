# 导入交易的分类关联与历史修复

## 问题与修复范围

旧导入流程创建了分类和父子关系，却只向交易写入 `categoryName/categoryKind`，没有传入 `category_id`。读取投影的 `category_sync_id` 因而为空，按分类ID统计、筛选和分类预算可能无法关联这些交易。名称显示正常不能证明ID关联完整。

新导入在分类创建完成后，以名称、收支类型、父分类匹配实际分类syncId，写入交易的 `categoryId`。既适用于百事AA，也适用于原有CSV导入；有歧义则整批回滚，不选第一个候选。未分类交易、转账保留原行为。

本次不改变统计口径：分类管理是用户全局分类；卡片笔数为该分类直接关联交易数，一级分类不自动累加二级分类。顶部支出、收入、转账的徽标是分类数量。

## 历史记录修复

工具：`python -m scripts.repair_import_category_links`。它不是数据库迁移，不在服务启动时自动运行，也不重建全部投影。

先在隔离环境或备份副本验证，再由维护人员针对明确账本执行。默认只预览：

```sh
python -m scripts.repair_import_category_links \
  --user-email owner@example.com \
  --ledger-external-id ledger_example
```

连接配置使用该环境的 `DATABASE_URL` 等常规环境变量。命令应在对应镜像/虚拟环境中从项目根运行，禁止误继承其它环境的配置。输出包含候选数量、跳过原因、当前游标和 `plan_hash`，不输出金额、备注或原文件。

完成一致性备份、确认目标与计划、暂停目标账本写入后，使用本次预览得到的hash：

```sh
python -m scripts.repair_import_category_links \
  --user-email owner@example.com \
  --ledger-external-id ledger_example \
  --apply --expected-plan-hash '<preview-plan-hash>'
```

保护边界：

- 用户与账本必须同时指定，不支持全库批量修复；软删账本拒绝处理。
- 仅修复最新原始变更仍来自 `web-import`、缺少分类ID的普通收支；后续已由手机或其它入口编辑的记录跳过，留待人工核对。
- 历史记录缺少父分类字段，只在名称和收支类型唯一匹配时补链；同名歧义、分类已删除、来源不一致均跳过。
- 执行前重算计划hash，账本或分类变化则拒绝；SQLite在首次读取前使用 `BEGIN IMMEDIATE` 串行化写入。其它数据库仍须在维护窗口暂停相关账本和用户分类写入。
- 原始同步payload除 `categoryId` 外保持不变，经现有同步变更写入器更新投影；原有历史不覆盖，失败整体回滚，成功写入 `import_category_repair` 审计记录。
- 重复执行时已关联记录跳过，不重复生成同步变更。金额、时间、备注、附件、币种、来源映射不修改。
- CLI不发送WebSocket通知。Web刷新后读取新计数；手机下一次正常拉取时可收到新增变更，首次/全量同步也包含分类ID。不能据此宣称安卓实机已验证。

执行后验证修复数量、按分类筛选、分类计数、金额与交易总数不变、同步增量与全量响应、重复预览为零。应用层验证不能替代真实手机验收。

代码回退不会撤销已写入关联；数据恢复必须针对本次备份制定方案，并考虑新游标和其它设备已拉取变更，不能直接盲目恢复旧库。
