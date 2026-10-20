<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppButton from '../AppButton.vue'
import AdminActionMenu from './AdminActionMenu.vue'

const props = defineProps({
  actions: { type: Array, default: () => [] },
  label: { type: String, default: 'More actions' },
  align: { type: String, default: 'center', validator: (value) => ['center', 'end'].includes(value) },
})

const root = ref(null)
const measurement = ref(null)
const showInline = ref(false)
const menuOpen = ref(false)
let resizeObserver

// 操作按钮总宽度和单元格宽度变化时重新选择展示方式，避免按钮换行挤压表格。
async function updateLayout() {
  await nextTick()
  const availableWidth = root.value?.getBoundingClientRect().width ?? 0
  const requiredWidth = measurement.value?.getBoundingClientRect().width ?? Infinity
  showInline.value = availableWidth > 0 && requiredWidth <= availableWidth
  if (showInline.value) menuOpen.value = false
}

watch(() => props.actions, updateLayout, { deep: true, flush: 'post' })

onMounted(() => {
  resizeObserver = new ResizeObserver(updateLayout)
  if (root.value) resizeObserver.observe(root.value)
  if (measurement.value) resizeObserver.observe(measurement.value)
  updateLayout()
})

onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<template>
  <div ref="root" class="responsive-action-group" :class="`responsive-action-group--${align}`">
    <div ref="measurement" class="responsive-action-group__measure" aria-hidden="true">
      <AppButton v-for="action in actions" :key="action.key || action.label" variant="secondary" tabindex="-1">
        {{ action.label }}
      </AppButton>
    </div>

    <div v-if="showInline" class="responsive-action-group__buttons">
      <AppButton
        v-for="action in actions"
        :key="action.key || action.label"
        variant="secondary"
        :disabled="action.disabled"
        :title="action.title"
        :class="{ 'responsive-action-group__danger': action.danger }"
        @click="action.onSelect?.()"
      >
        {{ action.label }}
      </AppButton>
    </div>
    <AdminActionMenu v-else :open="menuOpen" :label="label" @update:open="menuOpen = $event">
      <button
        v-for="action in actions"
        :key="action.key || action.label"
        type="button"
        role="menuitem"
        :disabled="action.disabled"
        :title="action.title"
        :class="{ 'admin-action-menu__danger': action.danger }"
        @click="action.onSelect?.()"
      >
        {{ action.label }}
      </button>
    </AdminActionMenu>
  </div>
</template>

<style scoped>
.responsive-action-group { position: relative; display: flex; justify-content: flex-end; width: 100%; min-width: 0; }
.responsive-action-group--center { justify-content: center; }
.responsive-action-group__buttons { display: flex; justify-content: center; gap: 6px; white-space: nowrap; }
.responsive-action-group--center :deep(.admin-action-menu) { width: 100%; justify-content: center; }
.responsive-action-group--center :deep(.admin-action-menu__trigger) { margin-inline: auto; }
.responsive-action-group__buttons :deep(.app-button) { min-height: 36px; padding: 0 12px; font-size: 13px; }
.responsive-action-group__danger { color: var(--color-danger) !important; }
.responsive-action-group__measure {
  position: absolute; top: 0; left: 0; display: flex; width: max-content; gap: 6px;
  visibility: hidden; pointer-events: none; white-space: nowrap;
}
.responsive-action-group__measure :deep(.app-button) { min-height: 36px; padding: 0 12px; font-size: 13px; }
</style>
