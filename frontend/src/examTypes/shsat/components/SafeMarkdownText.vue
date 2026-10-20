<script setup>
import { computed } from 'vue';

import FormulaText from '@shsat/components/FormulaText.vue';
import { parseSafeTextMaterialMarkdown } from '@shsat/utils/textMaterial';

const props = defineProps({
  content: {
    type: [String, Number],
    default: '',
  },
});

const segments = computed(() => parseSafeTextMaterialMarkdown(props.content));

function segmentKey(segment, index) {
  return [
    index,
    segment.text.length,
    segment.bold ? 'b' : '',
    segment.italic ? 'i' : '',
    segment.underline ? 'u' : '',
  ].join('-');
}
</script>

<template>
  <span class="safe-markdown-text">
    <span
      v-for="(segment, index) in segments"
      :key="segmentKey(segment, index)"
      class="safe-markdown-text__segment"
      :class="{
        'safe-markdown-text__segment--bold': segment.bold,
        'safe-markdown-text__segment--italic': segment.italic,
        'safe-markdown-text__segment--underline': segment.underline,
      }"
    >
      <FormulaText :content="segment.text" />
    </span>
  </span>
</template>

<style scoped>
.safe-markdown-text {
  white-space: pre-wrap;
}

.safe-markdown-text__segment {
  white-space: inherit;
}

.safe-markdown-text__segment--bold {
  font-weight: 700;
}

.safe-markdown-text__segment--italic {
  font-style: italic;
}

.safe-markdown-text__segment--underline {
  text-decoration: underline;
}
</style>
