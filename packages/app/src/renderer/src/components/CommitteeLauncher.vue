<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'

const props = defineProps<{ open: boolean; secId: string; stockName: string }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const app = useAppStore()
const router = useRouter()

const moderatorId = ref('neutral-moderator')
const participantIds = ref<string[]>([])
const topic = ref('')
const submitting = ref(false)
const errorMsg = ref('')

const enabledPersonas = computed(() => app.personas.filter((p) => p.enabled))
const moderatorOptions = computed(() => enabledPersonas.value.filter((p) => !participantIds.value.includes(p.id)))
const participantOptions = computed(() => enabledPersonas.value.filter((p) => !p.builtin))

watch(
  () => props.open,
  (v) => {
    if (v) {
      errorMsg.value = ''
      submitting.value = false
    }
  }
)

function toggleParticipant(id: string): void {
  if (participantIds.value.includes(id)) {
    participantIds.value = participantIds.value.filter((x) => x !== id)
  } else if (participantIds.value.length < 4) {
    participantIds.value = [...participantIds.value, id]
    if (moderatorId.value === id) moderatorId.value = 'neutral-moderator'
  }
}

const launchLabel = computed(() =>
  participantIds.value.length <= 1 ? '锁定证据并开始分析' : '锁定证据并开始讨论'
)

const codexReady = computed(() => app.codexState?.status === 'ready')

async function launch(): Promise<void> {
  if (!participantIds.value.length) {
    errorMsg.value = '请至少选择一名参与角色'
    return
  }
  submitting.value = true
  errorMsg.value = ''
  try {
    const run = await window.hanai.committee.create({
      secId: props.secId,
      moderatorPersonaId: moderatorId.value,
      participantPersonaIds: [...participantIds.value],
      topic: topic.value.trim() || null
    })
    await window.hanai.committee.start(run.analysisHash)
    emit('update:open', false)
    void router.push(`/committee/${run.analysisHash}`)
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" @click.self="emit('update:open', false)">
      <div class="panel">
        <div class="p-title">发起大师分析</div>
        <div class="p-sub">
          标的：<b>{{ stockName }}</b> · 流程：{{
            participantIds.length <= 1
              ? '证据锁定 → 大师分析'
              : '证据锁定 → 第一轮 → 第二轮互评 → 主持终审'
          }}
        </div>

        <div class="section">
          <div class="s-label">选择大师（选 1 名为单人深度分析，选 2–4 名为委员会讨论）</div>
          <div class="chips">
            <button
              v-for="p in participantOptions"
              :key="p.id"
              class="chip"
              :class="{ active: participantIds.includes(p.id), disabled: moderatorId === p.id && participantIds.length > 1 }"
              @click="toggleParticipant(p.id)"
            >
              <span class="chip-avatar" :style="{ color: p.color, borderColor: p.color }">{{ p.shortName }}</span>
              {{ p.name }}
              <span v-if="p.roleTag" class="tag" style="font-size: 10px">{{ p.roleTag }}</span>
            </button>
          </div>
        </div>

        <div v-if="participantIds.length > 1" class="section">
          <div class="s-label">主持人（负责终审，不参与前两轮发言）</div>
          <div class="chips">
            <button
              v-for="p in moderatorOptions"
              :key="p.id"
              class="chip"
              :class="{ active: moderatorId === p.id }"
              @click="moderatorId = p.id"
            >
              <span class="chip-avatar" :style="{ color: p.color, borderColor: p.color }">{{ p.shortName }}</span>
              {{ p.name }}
            </button>
          </div>
        </div>

        <div class="section">
          <div class="s-label">议题（可选）</div>
          <input v-model="topic" class="field" style="width: 100%" placeholder="如：护城河是否在变窄？当前估值是否提供安全边际？" />
        </div>

        <div v-if="!codexReady" class="warn-box">Codex 当前不可用（{{ app.codexState?.status }}），无法发起讨论。请先到「设置与诊断」检查。</div>
        <div v-if="errorMsg" class="warn-box">{{ errorMsg }}</div>

        <div class="actions">
          <button class="btn ghost" @click="emit('update:open', false)">取消</button>
          <button class="btn primary" :disabled="submitting || !codexReady" @click="launch">
            {{ submitting ? '正在锁定证据…' : launchLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(3px);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
}
.panel {
  width: 560px;
  background: #141822;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-l);
  padding: 22px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
}
.p-title {
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 4px;
}
.p-sub {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 16px;
}
.section {
  margin-bottom: 14px;
}
.s-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 7px;
}
.chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 12px 6px 7px;
  background: var(--bg-raised);
  border: 1px solid var(--border-subtle);
  border-radius: 99px;
  color: var(--text-primary);
  font-size: 12.5px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.chip:hover {
  border-color: var(--border-strong);
}
.chip.active {
  background: var(--bg-active);
  border-color: rgba(224, 179, 76, 0.45);
  color: var(--accent-strong);
}
.chip.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.chip-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1.5px solid;
  background: var(--bg-raised-2);
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.warn-box {
  background: rgba(240, 74, 85, 0.08);
  border: 1px solid rgba(240, 74, 85, 0.3);
  border-radius: var(--radius-s);
  padding: 9px 12px;
  font-size: 12px;
  margin-bottom: 12px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
