import type {
  MarketOverview,
  SectorBoard,
  StockQuote,
  RankEntry,
  KLineBar,
  TrendPoint,
  StockMetrics,
  ValuationSummary,
  SearchResult,
  SecurityMaster,
  WatchGroup,
  Persona,
  CodexState,
  Conversation,
  ChatMessage,
  AnalysisRun,
  AnalysisArtifact,
  AnalysisActivityEntry,
  EvidenceSnapshot,
  AppHealth,
  StreamEvent,
  ProviderMeta
} from '../shared/types'

export interface HanaiApi {
  market: {
    overview: () => Promise<MarketOverview>
    sectors: (type: 'industry' | 'concept') => Promise<SectorBoard>
    sectorStocks: (code: string) => Promise<{ stocks: StockQuote[]; meta: ProviderMeta }>
    ranks: (
      kind: 'gainers' | 'losers' | 'amount' | 'turnover'
    ) => Promise<{ entries: RankEntry[]; meta: ProviderMeta }>
    quotes: (secIds: string[]) => Promise<{ quotes: StockQuote[]; meta: ProviderMeta }>
    metrics: (secId: string) => Promise<StockMetrics | null>
    kline: (secId: string, klt: '101' | '102' | '103') => Promise<{ bars: KLineBar[]; meta: ProviderMeta }>
    trend: (secId: string) => Promise<{ points: TrendPoint[]; prevClose: number | null; meta: ProviderMeta }>
  }
  valuation: {
    get: (secId: string) => Promise<ValuationSummary | null>
  }
  master: {
    search: (q: string) => Promise<SearchResult[]>
    sync: (force: boolean) => Promise<{ count: number; updatedAt: string | null }>
    get: (secId: string) => Promise<SecurityMaster | null>
  }
  watch: {
    groups: () => Promise<WatchGroup[]>
    addGroup: (name: string) => Promise<WatchGroup>
    renameGroup: (id: string, name: string) => Promise<void>
    removeGroup: (id: string) => Promise<void>
    add: (groupId: string, secId: string) => Promise<void>
    remove: (groupId: string, secId: string) => Promise<void>
    isWatched: (secId: string) => Promise<boolean>
  }
  persona: {
    list: () => Promise<Persona[]>
    setEnabled: (id: string, enabled: boolean) => Promise<void>
  }
  codex: {
    state: () => Promise<CodexState>
    restart: () => Promise<void>
    setModel: (model: string | null) => Promise<void>
    approve: (requestId: number, decision: 'accept' | 'decline') => Promise<void>
  }
  chat: {
    list: (personaId?: string) => Promise<Conversation[]>
    get: (id: string) => Promise<Conversation | null>
    create: (personaId: string, secId?: string | null) => Promise<Conversation>
    send: (id: string, text: string) => Promise<ChatMessage>
    stop: (id: string) => Promise<void>
    rename: (id: string, title: string) => Promise<void>
    delete: (id: string) => Promise<void>
  }
  committee: {
    list: () => Promise<AnalysisRun[]>
    get: (hash: string) => Promise<AnalysisRun | null>
    create: (params: {
      secId: string
      moderatorPersonaId: string
      participantPersonaIds: string[]
      topic: string | null
    }) => Promise<AnalysisRun>
    start: (hash: string) => Promise<void>
    stop: (hash: string) => Promise<void>
    artifacts: (hash: string) => Promise<AnalysisArtifact[]>
    activity: (hash: string) => Promise<AnalysisActivityEntry[]>
    delete: (hash: string) => Promise<void>
  }
  evidence: {
    create: (secId: string) => Promise<EvidenceSnapshot>
  }
  app: {
    health: () => Promise<AppHealth>
    openPath: (p: string) => Promise<string>
    storageStats: () => Promise<{
      total: number
      marketCache: number
      valuationCache: number
      workdir: number
      logs: number
    }>
    clearCache: (kind: 'market' | 'valuation') => Promise<boolean>
  }
  onStream: (cb: (e: StreamEvent) => void) => () => void
}

declare global {
  interface Window {
    hanai: HanaiApi
  }
}

export {}
