# 小鱼项目工作规则

## 升级感知

- 任何代码、界面、配置或行为改动完成后，都必须在 `release-notes.json` 的 `changes` 数组末尾追加一条记录，然后才算完成。
- 每条记录格式：`{"id":"YYYY-MM-DD-N","title":"简短标题","notes":["可核验的改动一","改动二"],"at":"ISO 时间"}`。`id` 必须全局唯一，`N` 从 1 递增；`title` 不超过 80 字；`notes` 为 1–12 条、每条不超过 500 字。
- 同一批关联改动可合并为一条；只改文档或注释也至少写一条。不得用“优化体验”这类无法核验的空话。
- 修改后至少运行：

```bash
node --test --test-isolation=none test/release-notes.test.js test/self-model.test.js
```

- 未写入 `changes` 的改动视为未完成，不得向用户报告完成。
