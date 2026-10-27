<script setup>
import 'mathlive';

import { computed, ref } from 'vue';

import SafeMarkdownText from '@shsat/components/SafeMarkdownText.vue';
import { MIXED_CONTENT_PART_TYPES, parseStemMixedContent } from '@shsat/utils/mixedContent';
import { unescapeDollar } from '@shsat/utils/formulaContent';

const props = defineProps({
  content: {
    type: [String, Number],
    default: '',
  },
  items: {
    type: Array,
    default: null,
  },
  textMode: {
    type: String,
    default: 'plain',
    validator: (value) => ['plain', 'markdown'].includes(value),
  },
  imageAlt: {
    type: String,
    default: 'Stem image',
  },
});
const emit = defineEmits(['image-click']);
const unavailableImageSources = ref(new Set());

const displayItems = computed(() => {
  return Array.isArray(props.items) ? props.items : parseStemMixedContent(props.content);
});

function itemKey(item, index) {
  return item.key || `${item.type}-${index}-${item.sourceStart ?? 0}`;
}

function openImage(item) {
  emit('image-click', item);
}

// 图片资源失效时保留替代文本，避免题干中留下空白或破图图标。
function markImageUnavailable(src) {
  if (!src || unavailableImageSources.value.has(src)) {
    return;
  }
  unavailableImageSources.value = new Set([...unavailableImageSources.value, src]);
}

</script>

<template>
  <div class="mixed-content">
    <template v-for="(item, index) in displayItems" :key="itemKey(item, index)">
      <SafeMarkdownText
        v-if="item.type === MIXED_CONTENT_PART_TYPES.TEXT && textMode === 'markdown'"
        :content="item.content"
      />
      <span
        v-else-if="item.type === MIXED_CONTENT_PART_TYPES.TEXT"
        class="mixed-content__text"
      >{{ unescapeDollar(item.content) }}</span>
      <math-span
        v-else-if="item.type === MIXED_CONTENT_PART_TYPES.INLINE_MATH"
        class="mixed-content__inline-math"
        format="latex"
      >{{ item.content }}</math-span>
      <math-div
        v-else-if="item.type === MIXED_CONTENT_PART_TYPES.BLOCK_MATH"
        class="mixed-content__block-math"
        format="latex"
      >{{ item.content }}</math-div>
      <button
        v-if="item.type === MIXED_CONTENT_PART_TYPES.IMAGE && !unavailableImageSources.has(item.src)"
        class="mixed-content__image-block"
        type="button"
        title="Click to enlarge image"
        @click.stop="openImage(item)"
      >
        <img
          class="mixed-content__image"
          :src="item.src"
          :alt="item.alt || imageAlt"
          @error="markImageUnavailable(item.src)"
        />
      </button>
      <p
        v-else-if="item.type === MIXED_CONTENT_PART_TYPES.IMAGE"
        class="mixed-content__image-unavailable"
        role="status"
      >Image unavailable: {{ item.alt || imageAlt }}</p>
    </template>
  </div>
</template>

<style scoped>
.mixed-content {
  min-width: 0;
  white-space: pre-wrap;
}

.mixed-content__text {
  white-space: inherit;
}


.mixed-content__inline-math {
  display: inline-block;
  vertical-align: -0.16em;
}

.mixed-content__block-math {
  display: block;
  margin: 12px auto;
  overflow-x: auto;
  text-align: center;
}

.mixed-content__image-block {
  display: block;
  width: 100%;
  border: 0;
  margin: 12px auto;
  padding: 0;
  max-width: 100%;
  color: inherit;
  font: inherit;
  text-align: center;
  background: transparent;
  cursor: zoom-in;
}

.mixed-content__image {
  display: block;
  width: auto;
  min-width: 50%;
  height: auto;
  max-width: 66.666%;
  margin: 0 auto;
  border: 1px solid rgba(31, 75, 135, 0.16);
  border-radius: 10px;
  background: #ffffff;
  object-fit: contain;
  box-shadow: 0 8px 22px rgba(31, 75, 135, 0.06);
}

.mixed-content__image-unavailable {
  margin: 12px auto;
  border: 1px dashed #cbd8e8;
  border-radius: 8px;
  padding: 14px;
  color: #65758f;
  background: #f6f9fd;
  text-align: center;
}
</style>
