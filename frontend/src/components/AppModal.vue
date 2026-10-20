<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'

const props = defineProps({
  title: { type: String, required: true },
  eyebrow: { type: String, default: '' },
  description: { type: String, default: '' },
  width: { type: String, default: '500px' },
  panelClass: { type: String, default: '' },
  busy: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])
const dialog = ref(null)
const titleId = `app-modal-title-${useId()}`
const descriptionId = `app-modal-description-${useId()}`
const dialogStyle = computed(() => ({ '--app-modal-width': props.width }))
let previousFocus = null
let previousBodyOverflow = ''
let backdropPointerId = null
let backdropClickArmed = false

function onBackdropPointerDown(event) {
  backdropPointerId = event.target === event.currentTarget && event.isPrimary ? event.pointerId : null
  backdropClickArmed = false
}

function onBackdropPointerUp(event) {
  backdropClickArmed = backdropPointerId === event.pointerId && event.target === event.currentTarget
  backdropPointerId = null
}

function onBackdropPointerCancel() {
  backdropPointerId = null
  backdropClickArmed = false
}

function onBackdropClick(event) {
  if (event.target !== event.currentTarget || !backdropClickArmed) return
  backdropClickArmed = false
  requestClose()
}

function requestClose() {
  if (!props.busy) emit('close')
}

onMounted(() => {
  previousFocus = document.activeElement
  previousBodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  const autofocus = dialog.value?.querySelector('[autofocus]')
  if (autofocus) autofocus.focus()
  else dialog.value?.focus()
})

onBeforeUnmount(() => {
  document.body.style.overflow = previousBodyOverflow
  if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
})
</script>

<template>
  <Teleport to="body">
    <div
      class="app-modal-backdrop"
      @pointerdown="onBackdropPointerDown"
      @pointerup="onBackdropPointerUp"
      @pointercancel="onBackdropPointerCancel"
      @click="onBackdropClick"
      @keydown.esc.stop="requestClose"
    >
      <section
        ref="dialog"
        :class="['app-modal', panelClass]"
        :style="dialogStyle"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="description ? descriptionId : undefined"
        tabindex="-1"
      >
        <header class="app-modal__heading">
          <div>
            <span v-if="eyebrow" class="eyebrow">{{ eyebrow }}</span>
            <h2 :id="titleId">{{ title }}</h2>
          </div>
          <button class="app-modal__close" type="button" aria-label="Close" :disabled="busy" @click="requestClose">×</button>
        </header>
        <p v-if="description" :id="descriptionId" class="app-modal__description">{{ description }}</p>
        <div class="app-modal__body"><slot /></div>
        <footer v-if="$slots.footer" class="app-modal__footer"><slot name="footer" /></footer>
      </section>
    </div>
  </Teleport>
</template>
