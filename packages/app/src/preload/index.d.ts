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
  JudgementRun,
  JudgementReport,
  JudgementActivityEntry,
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
    move: (fromGroupId: string, toGroupId: string, secId: string) => Promise<void>
    isWatched: (secId: string) => Promise<boolean>
  }
  persona: {
    list: () => Promise<Persona[]>
  }
  codex: {
    state: () => Promise<CodexState>
    restart: () => Promise<void>
    setModel: (model: string | null) => Promise<void>
  }
  judgement: {
    list: () => Promise<JudgementRun[]>
    get: (id: string) => Promise<JudgementRun | null>
    create: (params: {
      secId: string
      personaId: string
    }) => Promise<JudgementRun>
    start: (id: string) => Promise<void>
    activity: (id: string) => Promise<JudgementActivityEntry[]>
    report: (id: string) => Promise<JudgementReport | null>
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
