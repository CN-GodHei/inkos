# InkOS · 个人 fork

本仓库是 [Narcooo/inkos](https://github.com/Narcooo/inkos) 原仓库的**个人 fork**，仅根据个人使用需要做了一些针对性调整，并非官方版本。

所有原始功能介绍、使用文档与截图，请直接查看原仓库：

👉 **https://github.com/Narcooo/inkos**

## 本 fork 的主要调整

### 导入与编码

- 支持 GBK / GB18030 编码的网文 `.txt` 导入（txt80、笔趣阁等下载的老书库）
- 导入母本时显示实时进度，支持重复导入去重（内容指纹）与中断断点续传
- 在缺少 FTS5 扩展的 Node 构建下，本地检索自动回退到 LIKE 搜索

### 创作流水线

- 书籍详情页支持一次批量续写连续 N 章
- 章节写入中断后可从磁盘检查点续写（草稿、控制输入、长度规格断点续跑）
- LLM 失败时降级处理 planner memo 与上下文压缩，而不是中断整章
- 章节标题长度约束为 5-10 字；REPAIR 判定不再把章节锁入 state-degraded
- 允许 auditor / exporter 子代理在无额外指令时直接调用
- 减少终端日志噪音，并为流水线各阶段增加耗时计时
- 整项目归档导出 / 导入（zip）；导出失败会在界面明确报错，而非下载错误 JSON

### Studio 界面

- 适配移动端：UI 外壳与各页面在手机上可用
- 新增阅读模式
- 章节复制操作与阅读器导航修正
- 章节列表默认最新在前，可切换排序
- 书架聊天框选择的模型持久化，并作为流水线操作（写章节 / 仿写 / 番外 / 导入母本等）的默认模型

### 跨端状态同步

- 确认式生产任务（建书 / 写章 / 短篇等）作为后台任务运行：任务期间仍可并行聊天，任务卡实时展示阶段与日志
- PC 与移动端实时同步运行状态：另一台设备 / 另一个标签页能实时看到运行中的任务卡与聊天轮，刷新后自动恢复
- 页面加载时自动对账遗留的"被中断"请求，不再把旧指令误判为正在执行

### 工程与兼容

- `dev` 脚本跨平台（Windows 下可直接 `pnpm dev` 启动）
- 持久化路径跨平台规范化；兼容 pnpm 9 构建

## 使用

请以原仓库的 [README](https://github.com/Narcooo/inkos#readme) 为准。

## English

Read the [English fork note](README.en.md) or the [upstream repository](https://github.com/Narcooo/inkos).