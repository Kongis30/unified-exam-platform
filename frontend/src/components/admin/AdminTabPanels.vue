<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  activeKey: { type: String, required: true },
})

const content = ref(null)
const retainedHeight = ref(0)
let resizeObserver

function retainCurrentHeight() {
  if (!content.value) return
  // 保留已访问面板中的最高高度，避免切换到短面板时页面滚动范围骤减。
  retainedHeight.value = Math.max(retainedHeight.value, Math.ceil(content.value.getBoundingClientRect().height))
}

watch(() => props.activeKey, async () => {
  await nextTick()
  retainCurrentHeight()
}, { flush: 'post' })

onMounted(() => {
  retainCurrentHeight()
  resizeObserver = new ResizeObserver(retainCurrentHeight)
  if (content.value) resizeObserver.observe(content.value)
})

onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<template>
  <div class="admin-tab-panels" :style="{ minHeight: retainedHeight ? `${retainedHeight}px` : undefined }">
    <div ref="content" class="admin-tab-panels__content"><slot /></div>
  </div>
</template>

<style scoped>
.admin-tab-panels { width: 100%; min-width: 0; }
.admin-tab-panels__content { width: 100%; min-width: 0; }
</style>
