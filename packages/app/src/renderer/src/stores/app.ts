import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AppHealth, CodexState, StreamEvent, Persona } from '@shared/types'

type StreamListener = (e: StreamEvent) => void

export const useAppStore = defineStore('app', () => {
  const health = ref<AppHealth | null>(null)
  const codexState = ref<CodexState | null>(null)
  const personas = ref<Persona[]>([])
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

  return {
    health,
    codexState,
    personas,
    init,
    onStream,
    refreshHealth,
    refreshPersonas
  }
})
