// ---------- 通用元数据 ----------
export interface ProviderMeta {
  providerId: string
  sourceName: string
  sourceTimestamp: string | null
  fetchedAt: string
  cacheState: 'fresh' | 'cached' | 'stale' | 'unavailable'
}

// ---------- 行情 ----------
export interface IndexQuote {
  code: string
  name: string
  price: number | null
  change: number | null
  changePct: number | null
  amount: number | null
  upCount: number | null
  downCount: number | null
  flatCount: number | null
}

export interface MarketOverview {
  indices: IndexQuote[]
  breadth: {
    up: number | null
    down: number | null
    flat: number | null
    limitUp: number | null
    limitDown: number | null
    totalAmount: number | null
  }
  marketStatus: 'pre' | 'trading' | 'break' | 'closed' | 'unknown'
  meta: ProviderMeta
}

export interface SectorItem {
  code: string
  name: string
  changePct: number | null
  amount: number | null
  upCount: number | null
  downCount: number | null
  leaderName: string | null
  leaderCode: string | null
  leaderChangePct: number | null
}

export interface SectorBoard {
  type: 'industry' | 'concept'
  sectors: SectorItem[]
  meta: ProviderMeta
}

export interface StockQuote {
  secId: string // 如 1.600519
  code: string
  name: string
  price: number | null
  change: number | null
  changePct: number | null
  amount: number | null
  volume: number | null
  turnoverRate: number | null
  marketCap: number | null
  floatCap: number | null
  pe: number | null
  pb: number | null
  high: number | null
  low: number | null
  open: number | null
  prevClose: number | null
  meta?: ProviderMeta
}

export interface RankEntry {
  secId: string
  code: string
  name: string
  price: number | null
  changePct: number | null
  amount: number | null
  turnoverRate: number | null
}

export interface KLineBar {
  date: string
  open: number
  close: number
  high: number
  low: number
  volume: number
  amount: number
}

export interface StockMetrics {
  secId: string
  code: string
  name: string
  price: number | null
  change: number | null
  changePct: number | null
  open: number | null
  high: number | null
  low: number | null
  prevClose: number | null
  volume: number | null
  amount: number | null
  turnoverRate: number | null
  volumeRatio: number | null
  marketCap: number | null
  floatCap: number | null
  peTtm: number | null
  peStatic: number | null
  pb: number | null
  roe: number | null
  totalRevenue: number | null
  revenueYoy: number | null
  netProfit: number | null
  netProfitYoy: number | null
  grossMargin: number | null
  netMargin: number | null
  debtRatio: number | null
  dividendYield: number | null
  eps: number | null
  bvps: number | null
  listingDate: string | null
  industry: string | null
  meta: ProviderMeta
}

export interface TrendPoint {
  time: string
  price: number
  avgPrice: number | null
  volume: number
}

// ---------- 证券主数据与搜索 ----------
export interface SecurityMaster {
  secId: string
  code: string
  name: string
  exchange: 'SH' | 'SZ' | 'BJ'
  pinyinFull: string
  pinyinInitial: string
}

export interface SearchResult extends SecurityMaster {
  price: number | null
  changePct: number | null
}

// ---------- 自选 ----------
export interface WatchItem {
  secId: string
  addedAt: string | null
  basePrice: number | null // 加入时价格，用于计算加入以来涨跌
}

export interface WatchGroup {
  id: string
  name: string
  secIds: string[]
  items: WatchItem[]
}

// ---------- 估值 ----------
export interface ValuationSummary {
  stockId: string
  ivDcf: number | null // 内在价值
  medps: number | null // 大师价值(当前)
  gfScore: number | null
  valuationRank: number | null // 0-7 估值标签
  dimensions: {
    financialStrength: number | null
    profitability: number | null
    growth: number | null
    gfValue: number | null
    momentum: number | null
  }
  series: {
    price: [string, number][]
    medps: [string, number][]
  }
  meta: ProviderMeta
}

// ---------- 角色 ----------
export interface Persona {
  id: string
  name: string
  shortName: string
  description: string
  avatar: string | null
  color: string
  skillPath: string
  hasFidelity: boolean
  verified: boolean
  roleTag: string | null // 角色类型标签：如「价值投资」「游资大佬」
  enabled: boolean
  defaultPrompt: string | null
  tags: string[]
  builtin: boolean
}

// ---------- Codex ----------
export type CodexStatus =
  | 'not-installed'
  | 'incompatible'
  | 'not-logged-in'
  | 'connecting'
  | 'ready'
  | 'error'

export interface CodexState {
  status: CodexStatus
  version: string | null
  path: string | null
  account: { type: string; email: string | null; plan: string | null } | null
  models: { id: string; displayName: string }[]
  selectedModel: string | null
  lastError: string | null
}

export interface ApprovalRequest {
  requestId: number
  threadId: string
  kind: 'command' | 'file' | 'permission'
  summary: string
  detail: string
}

// ---------- 聊天 ----------
export interface EvidenceSnapshot {
  id: string
  secId: string
  code: string
  name: string
  createdAt: string
  hash: string
  facts: Record<string, unknown>
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  status: 'pending' | 'streaming' | 'done' | 'interrupted' | 'error'
  createdAt: string
  activity?: AgentActivityItem[] // agent 分析过程（命令 / 推理 / 工具调用）
}

export interface Conversation {
  id: string
  personaId: string
  title: string
  secId: string | null
  evidenceId: string | null
  codexThreadId: string | null
  messages: ChatMessage[]
  createdAt: string
  updatedAt: string
}

// ---------- Agent 实时活动 ----------
export interface AgentActivityItem {
  id: string
  type: string // commandExecution / reasoning / agentMessage / webSearch / fileChange / mcpToolCall ...
  status: 'started' | 'completed' | 'failed'
  summary: string
  detail: string | null
  at: string
}

// ---------- 分析讨论（单角色与委员会共用同一流程） ----------
export type AnalysisMode = 'solo' | 'committee'

export type AnalysisStage =
  | 'created'
  | 'evidence_locked'
  | 'round1_running'
  | 'round1_locked'
  | 'round2_running'
  | 'round2_locked'
  | 'moderating'
  | 'completed'
  | 'cancelled'
  | 'failed'

export interface AnalysisSeat {
  seatId: string
  seatRole: 'moderator' | 'participant'
  personaId: string
  personaName: string
  directory: string
  codexThreadId: string | null
  turnStatus: Record<string, 'pending' | 'running' | 'completed' | 'failed'>
}

export interface AnalysisRun {
  analysisHash: string
  mode: AnalysisMode
  secId: string
  code: string
  stockName: string
  topic: string | null
  stage: AnalysisStage
  directory: string
  evidenceHash: string | null
  seats: AnalysisSeat[]
  createdAt: string
  updatedAt: string
  error: string | null
}

export interface AnalysisArtifact {
  seatId: string
  personaName: string
  type: 'turn01' | 'turn02' | 'final'
  path: string
  content: string
  sha256: string
}

export interface AnalysisActivityEntry {
  seatId: string
  round: string
  item: AgentActivityItem
}

// ---------- 设置/诊断 ----------
export interface AppHealth {
  market: { ok: boolean; lastSuccess: string | null; message: string }
  valuation: { ok: boolean; lastSuccess: string | null; message: string }
  codex: CodexState
  dataDir: string
  workDir: string
  masterCount: number
  masterUpdatedAt: string | null
}

// ---------- 流式事件（主进程 -> 渲染进程） ----------
export type StreamEvent =
  | { type: 'chat-delta'; conversationId: string; messageId: string; delta: string }
  | { type: 'chat-done'; conversationId: string; messageId: string }
  | { type: 'chat-error'; conversationId: string; messageId: string; error: string }
  | { type: 'chat-activity'; conversationId: string; messageId: string; item: AgentActivityItem }
  | { type: 'analysis-update'; analysis: AnalysisRun }
  | { type: 'analysis-log'; analysisHash: string; line: string }
  | { type: 'analysis-activity'; analysisHash: string; seatId: string; round: string; item: AgentActivityItem }
  | { type: 'codex-state'; state: CodexState }
  | { type: 'approval-request'; request: ApprovalRequest }
