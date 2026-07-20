import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AppHealth, CodexState, ApprovalRequest, StreamEvent, Persona } from '@shared/types'

type StreamListener = (e: StreamEvent) => void

export const useAppStore = defineStore('app', () => {
  const health = ref<AppHealth | null>(null)
  const codexState = ref<CodexState | null>(null)
  const personas = ref<Persona[]>([])
  const approvals = ref<ApprovalRequest[]>([])
  const listeners = new Set<StreamListener>()
  let unsubscribe: (() => void) | null = null

  function onStream(cb: StreamListener): () => void {
    listeners.add(cb)
    return () => listeners.delete(cb)
  }

  function init(): void {
    if (unsubscribe) return
    unsubscribe = window.hanai.onStream((e) => {
      if (e.type === 'codex-state') codexState.value = e.state
      if (e.type === 'approval-request') approvals.value.push(e.request)
      for (const l of listeners) l(e)
    })
    void refreshHealth()
    void refreshPersonas()
    void window.hanai.codex.state().then((s) => (codexState.value = s))
  }

  async function refreshHealth(): Promise<void> {
    health.value = await window.hanai.app.health()
  }

  async function refreshPersonas(): Promise<void> {
    personas.value = await window.hanai.persona.list()
  }

  async function resolveApproval(requestId: number, decision: 'accept' | 'decline'): Promise<void> {
    await window.hanai.codex.approve(requestId, decision)
    approvals.value = approvals.value.filter((a) => a.requestId !== requestId)
  }

  return {
    health,
    codexState,
    personas,
    approvals,
    init,
    onStream,
    refreshHealth,
    refreshPersonas,
    resolveApproval
  }
})
