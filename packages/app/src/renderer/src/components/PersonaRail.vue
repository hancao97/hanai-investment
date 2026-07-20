<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '../stores/app'

const app = useAppStore()
const router = useRouter()

const railPersonas = computed(() => app.personas.filter((p) => p.enabled && !p.builtin))

async function openChat(personaId: string): Promise<void> {
  const list = await window.hanai.chat.list(personaId)
  if (list.length) {
    void router.push(`/chat/${list[0].id}`)
  } else {
    const conv = await window.hanai.chat.create(personaId)
    void router.push(`/chat/${conv.id}`)
  }
}
</script>

<template>
  <aside class="rail">
    <div class="rail-title">大师</div>
    <button
      v-for="p in railPersonas"
      :key="p.id"
      class="avatar-btn"
      :title="`${p.name} · 点击开始对话`"
      @click="openChat(p.id)"
    >
      <span class="avatar" :style="{ borderColor: p.color, color: p.color }">{{ p.shortName }}</span>
      <span v-if="!p.verified" class="unverified" title="未验证角色">!</span>
    </button>
    <div class="rail-spacer" />
    <button class="avatar-btn add" title="角色中心" @click="router.push('/personas')">
      <span class="avatar dashed">＋</span>
    </button>
  </aside>
</template>

<style scoped>
.rail {
  width: 60px;
  flex-shrink: 0;
  border-left: 1px solid var(--border-subtle);
  background: rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 14px 0;
  gap: 10px;
}
.rail-title {
  font-size: 10px;
  color: var(--text-muted);
  letter-spacing: 0.2em;
  writing-mode: horizontal-tb;
  margin-bottom: 4px;
}
.avatar-btn {
  position: relative;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}
.avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 1.5px solid var(--border-strong);
  background: var(--bg-raised-2);
  color: var(--text-secondary);
  font-size: 15px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.avatar-btn:hover .avatar {
  transform: scale(1.08);
  box-shadow: 0 0 12px rgba(224, 179, 76, 0.25);
}
.avatar.dashed {
  border-style: dashed;
  font-weight: 400;
}
.unverified {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--warn);
  color: #14110a;
  font-size: 10px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
}
.rail-spacer {
  flex: 1;
}
</style>
