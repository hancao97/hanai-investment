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
    isWatched: (secId: string) => invoke('watch:isWatched', secId)
  },
  persona: {
    list: () => invoke('persona:list'),
    setEnabled: (id: string, enabled: boolean) => invoke('persona:setEnabled', id, enabled)
  },
  codex: {
    state: () => invoke('codex:state'),
    restart: () => invoke('codex:restart'),
    setModel: (model: string | null) => invoke('codex:setModel', model),
    approve: (requestId: number, decision: 'accept' | 'decline') => invoke('codex:approve', requestId, decision)
  },
  chat: {
    list: (personaId?: string) => invoke('chat:list', personaId),
    get: (id: string) => invoke('chat:get', id),
    create: (personaId: string, secId?: string | null) => invoke('chat:create', personaId, secId),
    send: (id: string, text: string) => invoke('chat:send', id, text),
    stop: (id: string) => invoke('chat:stop', id),
    rename: (id: string, title: string) => invoke('chat:rename', id, title),
    delete: (id: string) => invoke('chat:delete', id)
  },
  committee: {
    list: () => invoke('committee:list'),
    get: (hash: string) => invoke('committee:get', hash),
    create: (params: unknown) => invoke('committee:create', params),
    start: (hash: string) => invoke('committee:start', hash),
    stop: (hash: string) => invoke('committee:stop', hash),
    artifacts: (hash: string) => invoke('committee:artifacts', hash),
    activity: (hash: string) => invoke('committee:activity', hash),
    delete: (hash: string) => invoke('committee:delete', hash)
  },
  evidence: {
    create: (secId: string) => invoke('evidence:create', secId)
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
