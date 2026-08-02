import { contextBridge, ipcRenderer } from 'electron'
import type { StreamEvent } from '../shared/types'

const invoke = (channel: string, ...args: unknown[]): Promise<unknown> => ipcRenderer.invoke(channel, ...args)

const api = {
  market: {
    overview: () => invoke('market:overview'),
    sectors: (type: 'industry' | 'concept') => invoke('market:sectors', type),
    sectorStocks: (code: string) => invoke('market:sectorStocks', code),
    ranks: (kind: string) => invoke('market:ranks', kind),
    quotes: (secIds: string[]) => invoke('market:quotes', secIds),
    metrics: (secId: string) => invoke('market:metrics', secId),
    kline: (secId: string, klt: string) => invoke('market:kline', secId, klt),
    trend: (secId: string) => invoke('market:trend', secId)
  },
  valuation: {
    get: (secId: string) => invoke('valuation:get', secId)
  },
  master: {
    search: (q: string) => invoke('master:search', q),
    sync: (force: boolean) => invoke('master:sync', force),
    get: (secId: string) => invoke('master:get', secId)
  },
  watch: {
    groups: () => invoke('watch:groups'),
    addGroup: (name: string) => invoke('watch:addGroup', name),
    renameGroup: (id: string, name: string) => invoke('watch:renameGroup', id, name),
    removeGroup: (id: string) => invoke('watch:removeGroup', id),
    add: (groupId: string, secId: string) => invoke('watch:add', groupId, secId),
    remove: (groupId: string, secId: string) => invoke('watch:remove', groupId, secId),
    move: (fromGroupId: string, toGroupId: string, secId: string) =>
      invoke('watch:move', fromGroupId, toGroupId, secId),
    isWatched: (secId: string) => invoke('watch:isWatched', secId)
  },
  persona: {
    list: () => invoke('persona:list')
  },
  codex: {
    state: () => invoke('codex:state'),
    restart: () => invoke('codex:restart'),
    setModel: (model: string | null) => invoke('codex:setModel', model)
  },
  judgement: {
    list: () => invoke('judgement:list'),
    get: (id: string) => invoke('judgement:get', id),
    create: (params: unknown) => invoke('judgement:create', params),
    start: (id: string) => invoke('judgement:start', id),
    activity: (id: string) => invoke('judgement:activity', id),
    report: (id: string) => invoke('judgement:report', id)
  },
  app: {
    health: () => invoke('app:health'),
    openPath: (p: string) => invoke('app:openPath', p),
    storageStats: () => invoke('app:storageStats'),
    clearCache: (kind: 'market' | 'valuation') => invoke('app:clearCache', kind)
  },
  onStream: (cb: (e: StreamEvent) => void): (() => void) => {
    const listener = (_e: unknown, event: StreamEvent): void => cb(event)
    ipcRenderer.on('hanai:stream', listener)
    return () => ipcRenderer.removeListener('hanai:stream', listener)
  }
}

contextBridge.exposeInMainWorld('hanai', api)

export type HanaiApi = typeof api
