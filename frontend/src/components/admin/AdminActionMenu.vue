<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  label: { type: String, default: 'More actions' },
})

const emit = defineEmits(['update:open'])
const trigger = ref(null)
const panel = ref(null)
const panelPosition = ref({ top: 0, left: 0 })

function toggle() {
  emit('update:open', !props.open)
}

function close() {
  emit('update:open', false)
}

function handleOutsideClick(event) {
  if (!event.target.closest('[data-admin-action-menu], [data-admin-action-menu-panel]')) close()
}

function handleKeydown(event) {
  if (event.key === 'Escape') {
    close()
    trigger.value?.focus()
  }
}

function updatePanelPosition() {
  const anchor = trigger.value?.getBoundingClientRect()
  const menu = panel.value?.getBoundingClientRect()
  if (!anchor || !menu) return

  const edge = 8
  const gap = 6
  const table = trigger.value.closest('.exam-release-table-wrap, .sat-exam-release-table-wrap')
  const tableBottom = table?.getBoundingClientRect().bottom ?? window.innerHeight
  const availableBelow = Math.min(window.innerHeight - anchor.bottom, tableBottom - anchor.bottom)
  const opensUp = availableBelow < menu.height + gap
    && anchor.top > menu.height + gap
  const top = opensUp
    ? anchor.top - menu.height - gap
    : Math.min(window.innerHeight - menu.height - edge, anchor.bottom + gap)
  const left = Math.max(edge, Math.min(anchor.right - menu.width, window.innerWidth - menu.width - edge))
  panelPosition.value = { top, left }
}

function removeOpenListeners() {
  document.removeEventListener('click', handleOutsideClick)
  document.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('resize', updatePanelPosition)
  window.removeEventListener('scroll', updatePanelPosition, true)
}

watch(() => props.open, async (isOpen) => {
  if (isOpen) {
    document.addEventListener('click', handleOutsideClick)
    document.addEventListener('keydown', handleKeydown)
    window.addEventListener('resize', updatePanelPosition)
    window.addEventListener('scroll', updatePanelPosition, true)
    await nextTick()
    updatePanelPosition()
  } else {
    removeOpenListeners()
  }
}, { immediate: true })

onBeforeUnmount(removeOpenListeners)
</script>

<template>
  <div class="admin-action-menu" data-admin-action-menu>
    <button
      ref="trigger"
      class="admin-action-menu__trigger"
      type="button"
      :aria-label="label"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click.stop="toggle"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="5" cy="12" r="1.7" fill="currentColor" />
        <circle cx="12" cy="12" r="1.7" fill="currentColor" />
        <circle cx="19" cy="12" r="1.7" fill="currentColor" />
      </svg>
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        ref="panel"
        class="admin-action-menu__panel"
        data-admin-action-menu-panel
        role="menu"
        :style="{ top: `${panelPosition.top}px`, left: `${panelPosition.left}px` }"
        @click="close"
      >
        <slot />
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.admin-action-menu { position: relative; display: inline-flex; justify-content: flex-end; }
.admin-action-menu__trigger {
  display: grid; width: 36px; height: 36px; place-items: center;
  border: 1px solid var(--color-border); border-radius: 50%;
  color: var(--color-muted); background: #fff; cursor: pointer;
}
.admin-action-menu__trigger:hover, .admin-action-menu__trigger[aria-expanded="true"] {
  border-color: #cfe0ff; color: var(--color-primary-strong); background: var(--color-primary-soft);
}
.admin-action-menu__trigger svg { width: 18px; height: 18px; }
.admin-action-menu__panel {
  position: fixed; z-index: 100;
  display: grid; min-width: 156px; gap: 2px;
  border: 1px solid var(--color-border); border-radius: 12px; padding: 5px;
  background: #fff; box-shadow: 0 14px 32px rgba(31, 75, 135, .16);
}
.admin-action-menu__panel :slotted(button) {
  min-height: 36px; border: 0; border-radius: 8px; padding: 0 10px;
  color: var(--color-text); text-align: left; background: transparent; cursor: pointer;
  font: inherit; font-size: 14px; white-space: nowrap;
}
.admin-action-menu__panel :slotted(button:hover:not(:disabled)) { background: var(--color-surface-soft); }
.admin-action-menu__panel :slotted(button:disabled) { cursor: wait; opacity: .55; }
.admin-action-menu__panel :slotted(.admin-action-menu__danger) { color: var(--color-danger); }
</style>
