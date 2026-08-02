<script setup lang="ts">
import { ref, watch } from 'vue'
import type { WatchGroup } from '@shared/types'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  'update:open': [boolean]
  changed: [WatchGroup[]]
}>()

const groups = ref<WatchGroup[]>([])
const newName = ref('')
const editingId = ref('')
const editingName = ref('')
const confirmingDeleteId = ref('')
const busy = ref(false)
const error = ref('')

async function loadGroups(notify = false): Promise<void> {
  groups.value = await window.hanai.watch.groups()
  if (notify) emit('changed', groups.value)
}

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    newName.value = ''
    editingId.value = ''
    confirmingDeleteId.value = ''
    error.value = ''
    await loadGroups()
  }
)

function close(): void {
  if (!busy.value) emit('update:open', false)
}

async function createGroup(): Promise<void> {
  const name = newName.value.trim()
  if (!name || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await window.hanai.watch.addGroup(name)
    newName.value = ''
    await loadGroups(true)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    busy.value = false
  }
}

function beginRename(group: WatchGroup): void {
  editingId.value = group.id
  editingName.value = group.name
  confirmingDeleteId.value = ''
}

async function saveRename(): Promise<void> {
  const name = editingName.value.trim()
  if (!editingId.value || !name || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await window.hanai.watch.renameGroup(editingId.value, name)
    editingId.value = ''
    await loadGroups(true)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    busy.value = false
  }
}

async function deleteGroup(group: WatchGroup): Promise<void> {
  if (group.isDefault || busy.value) return
  if (confirmingDeleteId.value !== group.id) {
    confirmingDeleteId.value = group.id
    editingId.value = ''
    return
  }
  busy.value = true
  error.value = ''
  try {
    await window.hanai.watch.removeGroup(group.id)
    confirmingDeleteId.value = ''
    await loadGroups(true)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="manager-overlay" @click.self="close" @keydown.esc="close">
      <section class="manager-dialog card" role="dialog" aria-modal="true" aria-label="管理自选分组">
        <header class="manager-head">
          <div>
            <h2>管理自选分组</h2>
            <p>新建、重命名或删除分组；默认分组始终保留</p>
          </div>
          <button class="icon-close" aria-label="关闭" @click="close">×</button>
        </header>

        <form class="new-group" @submit.prevent="createGroup">
          <input v-model="newName" class="field" maxlength="20" placeholder="新分组名称" />
          <button class="btn primary" :disabled="!newName.trim() || busy" type="submit">新建分组</button>
        </form>

        <div class="manager-list">
          <div v-for="group in groups" :key="group.id" class="manager-row">
            <template v-if="editingId === group.id">
              <input
                v-model="editingName"
                class="field rename-field"
                maxlength="20"
                autofocus
                @keydown.enter.prevent="saveRename"
                @keydown.esc="editingId = ''"
              />
              <button class="btn small primary" :disabled="!editingName.trim() || busy" @click="saveRename">保存</button>
              <button class="btn small ghost" @click="editingId = ''">取消</button>
            </template>
            <template v-else>
              <span class="manager-copy">
                <b>{{ group.name }}</b>
                <span>{{ group.secIds.length }} 只股票</span>
              </span>
              <span v-if="group.isDefault" class="tag gold">默认 · 不可删除</span>
              <button class="btn small ghost" @click="beginRename(group)">重命名</button>
              <button
                v-if="!group.isDefault"
                class="btn small ghost delete-button"
                :class="{ confirming: confirmingDeleteId === group.id }"
                :disabled="busy"
                @click="deleteGroup(group)"
              >
                {{
                  confirmingDeleteId === group.id
                    ? group.secIds.length
                      ? '确认删除并移至默认分组'
                      : '确认删除'
                    : '删除'
                }}
              </button>
            </template>
          </div>
        </div>

        <p v-if="error" class="manager-error">{{ error }}</p>
        <footer class="manager-foot">
          <span>删除非默认分组时，其中的自选会自动转入默认分组</span>
          <button class="btn primary" @click="close">完成</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.manager-overlay {
  position: fixed;
  inset: 0;
  z-index: 140;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(2, 4, 8, .72);
  backdrop-filter: blur(4px);
}
.manager-dialog {
  width: min(620px, calc(100vw - 32px));
  overflow: hidden;
  padding: 0;
  box-shadow: 0 24px 70px rgba(0, 0, 0, .55);
}
.manager-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px;
  border-bottom: 1px solid var(--border-subtle);
}
.manager-head h2 { margin: 0; font-size: 17px; }
.manager-head p { margin: 5px 0 0; color: var(--text-muted); font-size: 11px; }
.icon-close { border: 0; background: transparent; color: var(--text-muted); cursor: pointer; font-size: 22px; line-height: 1; }
.icon-close:hover { color: var(--text-primary); }
.new-group {
  display: flex;
  gap: 8px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-subtle);
}
.new-group .field { flex: 1; }
.manager-list {
  display: flex;
  max-height: min(430px, 54vh);
  flex-direction: column;
  overflow-y: auto;
  padding: 8px 12px;
}
.manager-row {
  display: flex;
  min-height: 56px;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid var(--border-subtle);
}
.manager-row:last-child { border-bottom: 0; }
.manager-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 4px;
}
.manager-copy b { overflow: hidden; font-size: 12.5px; text-overflow: ellipsis; white-space: nowrap; }
.manager-copy span { color: var(--text-muted); font-size: 10.5px; }
.rename-field { min-width: 0; flex: 1; }
.delete-button { color: var(--down); }
.delete-button.confirming { border-color: rgba(232, 71, 88, .45); background: rgba(232, 71, 88, .08); }
.manager-error { margin: 8px 20px 0; color: var(--down); font-size: 11px; }
.manager-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 20px;
  border-top: 1px solid var(--border-subtle);
}
.manager-foot span { color: var(--text-muted); font-size: 10.5px; }
@media (max-width: 620px) {
  .manager-row { align-items: flex-start; flex-wrap: wrap; }
  .manager-copy { flex-basis: 60%; }
  .manager-foot { align-items: flex-end; flex-direction: column; }
}
</style>
