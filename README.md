# Hanai Investment

本地优先的 A 股价值研究与多角色投资委员会桌面客户端。

- 今日市场 Dashboard：核心指数、市场宽度（涨跌/涨停家数）、行业与概念板块热力树图（可下钻成分股）、涨跌幅/成交额/换手率榜单
- 自选与发现：本地证券主数据毫秒级检索（代码 / 名称 / 拼音全拼 / 首字母，⌘K 全局搜索）、自选分组与近实时行情刷新
- 股票详情：分时 / 日周月 K 线、实时行情快照、财报期基本面、价值大师估值（大师价值、GF 评分、五维评分雷达、价格 vs 价值线历史曲线），数据来源与时效分层展示
- 大师单聊：巴菲特、芒格、段永平、混江龙四个 AI 模拟视角常驻侧栏，可绑定股票证据快照对话，流式回复、可中止
- 投资委员会：选择主持人与 1–4 名参与角色，两轮独立并发书面讨论 + 交叉互评 + 主持终审，全部报告哈希封存在本地归档目录
- Agent 能力依赖本机 Codex（app-server），不需要额外配置 API Key；所有命令与文件修改请求都会弹出审批

## 目录结构

```
packages/
├── app/     # Electron + Vue 3 桌面客户端
└── agents/  # Nuwa 风格角色包（SKILL.md + 调研资料）
    ├── duan-yongping-perspective/
    ├── hunjianglong-perspective/
    ├── munger-perspective/
    └── warren-buffett-perspective/
prd/         # 产品需求文档
```

## 开发

要求：Node ≥ 22、pnpm ≥ 8、本机安装并登录 [Codex CLI](https://developers.openai.com/codex)（Agent 功能可选，缺失时行情/自选/详情仍可用）。

```bash
pnpm install
pnpm dev        # 启动客户端
pnpm typecheck  # 类型检查
pnpm build      # 构建
```

## 数据与隐私

- 全部用户数据保存在 `~/.hanai-investment`（SQLite + 文件归档），Agent 默认工作目录为 `~/.hanai-investment/runtime/workdir`
- 角色包首次启动时从 `packages/agents` 导入到 `~/.hanai-investment/personas/<id>/v1/`，可手动放入其他 Nuwa 风格角色包
- 讨论归档按 `runtime/workdir/<analysis-hash>/` 组织：`evidence.json`（不可变证据快照）、各席位 `turn01.md / turn02.md`、主持人 `final.md`、`manifests/`（SHA-256 封存清单）、`events.jsonl`
- 遥测默认关闭，无云同步

## 声明

本产品是研究辅助工具，不是券商、投顾或资产管理服务：不执行交易、不承诺收益、不提供确定性买卖建议。所有名人角色均为基于公开资料构建的 AI 模拟视角，不代表本人观点，未获本人或其机构背书。行情（东方财富）与估值（价值大师网）接口为个人研究原型适配，未获再分发授权，不得用于公开发行。
