<script setup>
import { computed, ref } from 'vue';

import SafeMarkdownText from '@shsat/components/SafeMarkdownText.vue';
import { buildMaterialDisplayLines, TEXT_MATERIAL_FORMAT_MARKER } from '@shsat/utils/textMaterial';

const props = defineProps({ content: { type: String, default: '' } });
const unavailableImages = ref(new Set());

// 旧材料使用标题、作者、正文三行格式；新格式必须先解码，异常内容不能把内部 JSON 当正文展示。
const display = computed(() => {
  const source = props.content.replace(/\r\n?/g, '\n');
  if (source.startsWith('[[TEXT_MATERIAL_FORMAT:')) {
    const [marker, ...payload] = source.split('\n');
    try {
      const fields = JSON.parse(payload.join('\n'));
      if (marker !== TEXT_MATERIAL_FORMAT_MARKER || !fields || Array.isArray(fields) || fields.version !== 2) return null;
    } catch {
      return null;
    }
  }
  return buildMaterialDisplayLines(source);
});

function markImageUnavailable(src) {
  unavailableImages.value = new Set([...unavailableImages.value, src]);
}
</script>

<template>
  <div v-if="display" class="shsat-text-material">
    <div v-if="display.hasIntroduction" class="shsat-text-material__introduction">
      <SafeMarkdownText :content="display.introduction" />
    </div>
    <header v-if="display.hasHeader" class="shsat-text-material__header">
      <div v-for="line in display.headerLines" :key="line.key" :class="`shsat-text-material__${line.role}`">
        <SafeMarkdownText :content="line.text" />
      </div>
    </header>
    <div v-if="display.hasBody" class="shsat-text-material__body" aria-label="Reading passage">
      <template v-for="item in display.bodyItems" :key="item.key">
        <template v-if="item.type === 'image'">
          <img v-if="!unavailableImages.has(item.src)" :src="item.src" :alt="item.alt" @error="markImageUnavailable(item.src)" />
          <p v-else role="status">Material image is unavailable.</p>
        </template>
        <div v-else :class="{ 'shsat-text-material__empty-line': item.isEmpty }">
          <SafeMarkdownText :content="item.text" />
        </div>
      </template>
    </div>
  </div>
  <p v-else role="status">This material cannot be displayed. Please contact your teacher.</p>
</template>

<style scoped>
.shsat-text-material__introduction { margin-bottom: 1em; }
.shsat-text-material__header { margin-bottom: 1em; text-align: center; }
.shsat-text-material__title { font-weight: 700; }
.shsat-text-material__author { font-style: italic; }
.shsat-text-material__empty-line { min-height: 1em; }
</style>
