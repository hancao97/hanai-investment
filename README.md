# Hanai Investment

本地优先的 A 股行情、估值与单专家投资研判桌面工作台。

- 今日市场：核心指数、五档市场宽度、行业/概念热力、榜单与板块下钻
- 自选与发现：本地证券主数据检索、自选分组和近实时行情
- 股票详情：分时、日周月 K 线、行情快照、基本面和估值曲线
- 专家中心：段永平、芒格、巴菲特、混江龙四套独立投资框架
- 大师研判：一次只选择一位专家；为每项任务创建独立工作区，同步专家 Skill，由 Codex Agent 主动获取公开信息并生成 `REPORT.md`
- 研判归档：实时展示 Agent 的搜索、命令、推理摘要与文件变更；完成后只读，不支持继续对话，可按股票或分析人筛选

## 研判工作区

每项任务保存在：

```text
~/.hanai-investment/runtime/workdir/judgements/<task-id>/
├── AGENTS.md
├── RUN.json
├── activity.jsonl
├── REPORT.md
└── agents/
    └── skills/
        └── <persona-id>/
            ├── SKILL.md
            └── references/...
```

任务只接收股票名、代码和所选专家。Agent 自行检索最新公开资料；不生成冻结证据包，不创建主持人或委员会席位。报告完成后，对应 Codex 线程归档，应用只展示执行轨迹和最终报告。

## 目录结构

```text
packages/
├── app/     # Electron + Vue 3 桌面客户端
└── agents/  # 专家 Skill（SKILL.md + 文本研究资料）
prd/         # 产品需求文档
```

## 开发

要求：Node ≥ 22、pnpm ≥ 8、本机安装并登录 [Codex CLI](https://developers.openai.com/codex)。

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm build
```

若设置页缺少新模型，先升级 Codex CLI：

```bash
npm install -g @openai/codex@latest
```

应用通过 Codex app-server 的 `model/list` 获取当前账号可用模型，不维护硬编码模型清单。

## 数据与边界

- 全部应用数据保存在 `~/.hanai-investment`
- 遥测默认关闭，无云同步
- 行情与估值接口为个人研究原型适配，可能延迟、不完整或有误
- 本产品不接券商交易，不承诺收益，不提供确定性买卖指令
