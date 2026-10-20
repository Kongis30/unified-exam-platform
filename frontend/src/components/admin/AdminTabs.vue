<script setup>
import { nextTick } from 'vue'

defineProps({
  tabs: { type: Array, required: true },
  modelValue: { type: String, required: true },
  ariaLabel: { type: String, default: 'Admin features' },
})

const emit = defineEmits(['update:modelValue'])

async function selectTab(tabKey) {
  const scrollX = window.scrollX
  const scrollY = window.scrollY

  emit('update:modelValue', tabKey)
  await nextTick()
  window.scrollTo(scrollX, scrollY)
}
</script>

<template>
  <nav class="admin-workspace-tabs" role="tablist" :aria-label="ariaLabel">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      class="admin-workspace-tabs__button"
      :class="{ 'admin-workspace-tabs__button--active': modelValue === tab.key }"
      type="button"
      role="tab"
      :aria-selected="modelValue === tab.key"
      @click="selectTab(tab.key)"
    >
      {{ tab.label }}
    </button>
  </nav>
</template>

<style scoped>
.admin-workspace-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  margin-bottom: -24px;
  padding: 8px;
  border: 1px solid var(--color-border);
  border-bottom: 0;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  background: rgba(255, 255, 255, 0.86);
}

.admin-workspace-tabs__button {
  border: 0;
  border-radius: 999px;
  padding: 10px 16px;
  color: var(--color-muted);
  background: transparent;
  font-weight: 700;
  cursor: pointer;
}

.admin-workspace-tabs__button--active {
  color: var(--color-primary-strong);
  background: var(--color-primary-soft);
}
</style>
