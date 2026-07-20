import { ipcMain, shell, dialog, BrowserWindow } from 'electron'
import { rmSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  getMarketOverview,
  getSectorBoard,
  getSectorStocks,
  getRankList,
  getQuotes,
  getStockMetrics,
  getKline,
  getTrend
} from './providers/eastmoney'
import { getValuation } from './providers/gurufocus'
import { searchWithQuotes, syncMasterIfNeeded, masterCount, masterUpdatedAt, getMaster } from './master'
import * as watchlist from './watchlist'
import { listPersonas, setPersonaEnabled } from './personas'
import { codex } from './codex'
import * as chat from './chat'
import * as committee from './committee'
import { createEvidenceSnapshot } from './evidence'
import { DATA_ROOT, WORKDIR, MARKET_CACHE_DIR, VALUATION_CACHE_DIR, LOGS_DIR } from './paths'
import type { AppHealth, ApprovalRequest } from '../shared/types'

let marketOk = true
let marketLastSuccess: string | null = null
let valuationOk = true
let valuationLastSuccess: string | null = null

function dirSize(dir: string): number {
  if (!existsSync(dir)) return 0
  let total = 0
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name)
    try {
      if (f.isDirectory()) total += dirSize(p)
      else total += statSync(p).size
    } catch {
      // 忽略读取失败的文件
    }
  }
  return total
}

// 审批：转发给渲染进程并等待用户决定
const pendingApprovals = new Map<number, (d: 'accept' | 'decline') => void>()

export function setupApprovalBridge(win: () => BrowserWindow | null): void {
  codex.setApprovalResolver(async (req: ApprovalRequest) => {
    const w = win()
    if (!w) return 'decline'
    w.webContents.send('hanai:stream', { type: 'approval-request', request: req })
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingApprovals.delete(req.requestId)
        resolve('decline')
      }, 5 * 60 * 1000)
      pendingApprovals.set(req.requestId, (d) => {
        clearTimeout(timer)
        pendingApprovals.delete(req.requestId)
        resolve(d)
      })
    })
  })
}

export function registerIpc(): void {
  // ---------- 行情 ----------
  ipcMain.handle('market:overview', async () => {
    try {
      const r = await getMarketOverview()
      marketOk = r.indices.length > 0
      if (marketOk) marketLastSuccess = new Date().toISOString()
      return r
    } catch (e) {
      marketOk = false
      throw e
    }
  })
  ipcMain.handle('market:sectors', (_e, type: 'industry' | 'concept') => getSectorBoard(type))
  ipcMain.handle('market:sectorStocks', (_e, code: string) => getSectorStocks(code))
  ipcMain.handle('market:ranks', (_e, kind: 'gainers' | 'losers' | 'amount' | 'turnover') => getRankList(kind))
  ipcMain.handle('market:quotes', (_e, secIds: string[]) => getQuotes(secIds))
  ipcMain.handle('market:metrics', (_e, secId: string) => getStockMetrics(secId))
  ipcMain.handle('market:kline', (_e, secId: string, klt: '101' | '102' | '103') => getKline(secId, klt))
  ipcMain.handle('market:trend', (_e, secId: string) => getTrend(secId))

  // ---------- 估值 ----------
  ipcMain.handle('valuation:get', async (_e, secId: string) => {
    const master = getMaster(secId)
    const exchange = master?.exchange ?? (secId.startsWith('1.') ? 'SH' : 'SZ')
    const code = master?.code ?? secId.split('.')[1]
    try {
      const r = await getValuation(exchange as 'SH' | 'SZ' | 'BJ', code)
      if (r) {
        valuationOk = true
        valuationLastSuccess = new Date().toISOString()
      }
      return r
    } catch (e) {
      valuationOk = false
      throw e
    }
  })

  // ---------- 搜索与主数据 ----------
  ipcMain.handle('master:search', (_e, q: string) => searchWithQuotes(q))
  ipcMain.handle('master:sync', (_e, force: boolean) => syncMasterIfNeeded(force))
  ipcMain.handle('master:get', (_e, secId: string) => getMaster(secId))

  // ---------- 自选 ----------
  ipcMain.handle('watch:groups', () => watchlist.listGroups())
  ipcMain.handle('watch:addGroup', (_e, name: string) => watchlist.addGroup(name))
  ipcMain.handle('watch:renameGroup', (_e, id: string, name: string) => watchlist.renameGroup(id, name))
  ipcMain.handle('watch:removeGroup', (_e, id: string) => watchlist.removeGroup(id))
  ipcMain.handle('watch:add', (_e, groupId: string, secId: string) => watchlist.addItem(groupId, secId))
  ipcMain.handle('watch:remove', (_e, groupId: string, secId: string) => watchlist.removeItem(groupId, secId))
  ipcMain.handle('watch:isWatched', (_e, secId: string) => watchlist.isWatched(secId))

  // ---------- 角色 ----------
  ipcMain.handle('persona:list', () => listPersonas())
  ipcMain.handle('persona:setEnabled', (_e, id: string, enabled: boolean) => setPersonaEnabled(id, enabled))

  // ---------- Codex ----------
  ipcMain.handle('codex:state', () => codex.getState())
  ipcMain.handle('codex:restart', () => codex.restart())
  ipcMain.handle('codex:setModel', (_e, model: string | null) => codex.setModel(model))
  ipcMain.handle('codex:approve', (_e, requestId: number, decision: 'accept' | 'decline') => {
    pendingApprovals.get(requestId)?.(decision)
  })

  // ---------- 单聊 ----------
  ipcMain.handle('chat:list', (_e, personaId?: string) => chat.listConversations(personaId))
  ipcMain.handle('chat:get', (_e, id: string) => chat.getConversation(id))
  ipcMain.handle('chat:create', (_e, personaId: string, secId?: string | null) =>
    chat.createConversation(personaId, secId)
  )
  ipcMain.handle('chat:send', (_e, id: string, text: string) => chat.sendMessage(id, text))
  ipcMain.handle('chat:stop', (_e, id: string) => chat.stopMessage(id))
  ipcMain.handle('chat:rename', (_e, id: string, title: string) => chat.renameConversation(id, title))
  ipcMain.handle('chat:delete', (_e, id: string) => chat.deleteConversation(id))

  // ---------- 投资委员会 ----------
  ipcMain.handle('committee:list', () => committee.listRuns())
  ipcMain.handle('committee:get', (_e, hash: string) => committee.getRun(hash))
  ipcMain.handle(
    'committee:create',
    (_e, params: { secId: string; moderatorPersonaId: string; participantPersonaIds: string[]; topic: string | null }) =>
      committee.createAnalysis(params)
  )
  ipcMain.handle('committee:start', (_e, hash: string) => {
    void committee.startAnalysis(hash)
  })
  ipcMain.handle('committee:stop', (_e, hash: string) => committee.stopAnalysis(hash))
  ipcMain.handle('committee:artifacts', (_e, hash: string) => committee.getArtifacts(hash))
  ipcMain.handle('committee:activity', (_e, hash: string) => committee.getActivity(hash))
  ipcMain.handle('committee:delete', (_e, hash: string) => committee.deleteRun(hash))

  // ---------- 证据 ----------
  ipcMain.handle('evidence:create', (_e, secId: string) => createEvidenceSnapshot(secId))

  // ---------- 应用与诊断 ----------
  ipcMain.handle('app:health', (): AppHealth => {
    return {
      market: {
        ok: marketOk,
        lastSuccess: marketLastSuccess,
        message: marketOk ? '行情源正常' : '行情源异常：请检查网络后刷新'
      },
      valuation: {
        ok: valuationOk,
        lastSuccess: valuationLastSuccess,
        message: valuationOk ? '估值源正常' : '估值源异常：将使用缓存数据'
      },
      codex: codex.getState(),
      dataDir: DATA_ROOT,
      workDir: WORKDIR,
      masterCount: masterCount(),
      masterUpdatedAt: masterUpdatedAt()
    }
  })
  ipcMain.handle('app:openPath', (_e, p: string) => {
    // 只允许打开数据目录内的路径
    if (!p.startsWith(DATA_ROOT)) throw new Error('只允许打开数据目录内的路径')
    return shell.openPath(p)
  })
  ipcMain.handle('app:storageStats', () => ({
    total: dirSize(DATA_ROOT),
    marketCache: dirSize(MARKET_CACHE_DIR),
    valuationCache: dirSize(VALUATION_CACHE_DIR),
    workdir: dirSize(WORKDIR),
    logs: dirSize(LOGS_DIR)
  }))
  ipcMain.handle('app:clearCache', async (_e, kind: 'market' | 'valuation') => {
    const dir = kind === 'market' ? MARKET_CACHE_DIR : VALUATION_CACHE_DIR
    const win = BrowserWindow.getFocusedWindow()
    if (win) {
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['取消', '清理'],
        defaultId: 0,
        message: `确认清理${kind === 'market' ? '行情' : '估值'}缓存？`,
        detail: `将删除 ${dir} 下的缓存文件。自选、角色与聊天记录不受影响。`
      })
      if (response !== 1) return false
    }
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) {
        rmSync(join(dir, f), { recursive: true, force: true })
      }
    }
    return true
  })
}
