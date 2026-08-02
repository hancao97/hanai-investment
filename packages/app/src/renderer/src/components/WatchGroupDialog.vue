<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { WatchGroup } from '@shared/types'

type DialogMode = 'add' | 'move' | 'manage'

const props = withDefaults(
  defineProps<{
    open: boolean
    secId: string
    stockName?: string
    mode?: DialogMode
    sourceGroupId?: string
  }>(),
  { stockName: '', mode: 'add', sourceGroupId: '' }
)
const emit = defineEmits<{
  'update:open': [boolean]
  changed: []
}>()

const groups = ref<WatchGroup[]>([])
const loading = ref(false)
const busyGroupId = ref('')
const error = ref('')

const title = computed(() => {
  if (props.mode === 'move') return '移动到其他分组'
  if (props.mode === 'manage') return '管理自选分组'
  return '加入自选'
})

const description = computed(() => {
  if (props.mode === 'move') return '选择目标分组，原加入日期和加入价格会保留'
  if (props.mode === 'manage') return '可以同时加入多个分组，点击分组即可加入或移出'
  return '选择要加入的自选分组'
})

function isMember(group: WatchGroup): boolean {
  return group.secIds.includes(props.secId)
}

async function loadGroups(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    groups.value = await window.hanai.watch.groups()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    loading.value = false
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) void loadGroups()
  },
  { immediate: true }
)

function close(): void {
  if (!busyGroupId.value) emit('update:open', false)
}

async function choose(group: WatchGroup): Promise<void> {
  if (busyGroupId.value) return
  if (props.mode === 'move' && group.id === props.sourceGroupId) return
  if (props.mode === 'add' && isMember(group)) return

  busyGroupId.value = group.id
  error.value = ''
  try {
    if (props.mode === 'move') {
      await window.hanai.watch.move(props.sourceGroupId, group.id, props.secId)
    } else if (props.mode === 'manage' && isMember(group)) {
      await window.hanai.watch.remove(group.id, props.secId)
    } else {
      await window.hanai.watch.add(group.id, props.secId)
    }
    emit('changed')
    if (props.mode === 'manage') await loadGroups()
    else emit('update:open', false)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    busyGroupId.value = ''
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="watch-overlay" @click.self="close" @keydown.esc="close">
      <section class="watch-dialog card" role="dialog" aria-modal="true" :aria-label="title">
        <header class="dialog-head">
          <div>
            <h2>{{ title }}</h2>
            <p>{{ description }}</p>
          </div>
          <button class="icon-close" aria-label="关闭" @click="close">×</button>
        </header>

        <div v-if="stockName || secId" class="stock-summary">
          <b>{{ stockName || secId }}</b>
          <span v-if="stockName" class="num">{{ secId.split('.')[1] || secId }}</span>
        </div>

        <div class="group-list" :class="{ loading }">
          <button
            v-for="group in groups"
            :key="group.id"
            class="group-choice"
            :class="{
              member: isMember(group),
              current: mode === 'move' && group.id === sourceGroupId
            }"
            :disabled="busyGroupId !== '' || (mode === 'move' && group.id === sourceGroupId) || (mode === 'add' && isMember(group))"
            @click="choose(group)"
          >
            <span class="group-mark">{{ isMember(group) ? '✓' : '' }}</span>
            <span class="group-copy">
              <b>{{ group.name }}</b>
              <span>{{ group.secIds.length }} 只股票</span>
            </span>
            <span v-if="group.isDefault" class="tag gold">默认</span>
            <span v-if="mode === 'move' && group.id === sourceGroupId" class="choice-state">当前分组</span>
            <span v-else-if="busyGroupId === group.id" class="choice-state">处理中…</span>
            <span v-else-if="mode === 'manage'" class="choice-state">{{ isMember(group) ? '移出' : '加入' }}</span>
            <span v-else-if="mode === 'add' && isMember(group)" class="choice-state">已加入</span>
            <span v-else class="choice-state">选择</span>
          </button>
          <div v-if="loading" class="dialog-empty">正在读取分组…</div>
          <div v-else-if="!groups.length" class="dialog-empty">暂无可用分组</div>
        </div>

        <p v-if="error" class="dialog-error">{{ error }}</p>
        <footer v-if="mode === 'manage'" class="dialog-foot">
          <button class="btn primary" @click="close">完成</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.watch-overlay {
  position: fixed;
  inset: 0;
  z-index: 140;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(2, 4, 8, .72);
  backdrop-filter: blur(4px);
}
.watch-dialog {
  width: min(440px, calc(100vw - 32px));
  overflow: hidden;
  padding: 0;
  box-shadow: 0 24px 70px rgba(0, 0, 0, .55);
}
.dialog-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 20px 16px;
  border-bottom: 1px solid var(--border-subtle);
}
.dialog-head h2 {
  margin: 0;
  font-size: 17px;
}
.dialog-head p {
  margin: 5px 0 0;
  color: var(--text-muted);
  font-size: 11px;
}
.icon-close {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 22px;
  line-height: 1;
}
.icon-close:hover { color: var(--text-primary); }
.stock-summary {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 14px 16px 8px;
  padding: 10px 12px;
  border-radius: var(--radius-m);
  background: var(--bg-raised-2);
}
.stock-summary b { font-size: 13px; }
.stock-summary span { color: var(--text-muted); font-size: 11px; }
.group-list {
  display: flex;
  max-height: min(400px, 55vh);
  flex-direction: column;
  gap: 5px;
  overflow-y: auto;
  padding: 8px 16px 16px;
}
.group-choice {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-m);
  background: var(--bg-raised);
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
}
.group-choice:hover:not(:disabled) {
  border-color: rgba(224, 179, 76, .45);
  background: var(--bg-hover);
}
.group-choice.member { border-color: rgba(224, 179, 76, .28); }
.group-choice.current { opacity: .62; }
.group-choice:disabled { cursor: default; }
.group-mark {
  display: grid;
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  color: var(--accent-strong);
  font-size: 11px;
}
.member .group-mark {
  border-color: rgba(224, 179, 76, .48);
  background: rgba(224, 179, 76, .12);
}
.group-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}
.group-copy b { overflow: hidden; font-size: 12.5px; text-overflow: ellipsis; white-space: nowrap; }
.group-copy span,
.choice-state { color: var(--text-muted); font-size: 10.5px; }
.choice-state { flex: 0 0 auto; }
.dialog-empty { padding: 28px; color: var(--text-muted); font-size: 12px; text-align: center; }
.dialog-error { margin: 0 16px 14px; color: var(--down); font-size: 11px; }
.dialog-foot {
  display: flex;
  justify-content: flex-end;
  padding: 14px 16px;
  border-top: 1px solid var(--border-subtle);
}
</style>
