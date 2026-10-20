<script setup>
import 'mathlive';

import { computed } from 'vue';

import { FORMULA_CONTENT_PART_TYPES, parseFormulaContent, unescapeDollar } from '../utils/formulaContent';

const props = defineProps({
  content: {
    type: [String, Number],
    default: '',
  },
});

const parts = computed(() => parseFormulaContent(props.content));

function partKey(part, index) {
  return `${part.type}-${index}-${part.content.length}`;
}
</script>

<template>
  <span class="formula-text">
    <template v-for="(part, index) in parts" :key="partKey(part, index)">
      <span
        v-if="part.type === FORMULA_CONTENT_PART_TYPES.TEXT"
        class="formula-text__plain"
      >{{ unescapeDollar(part.content) }}</span>
      <math-span
        v-else-if="part.type === FORMULA_CONTENT_PART_TYPES.INLINE_MATH"
        class="formula-text__inline-math"
        format="latex"
      >{{ part.content }}</math-span>
      <math-div
        v-else
        class="formula-text__block-math"
        format="latex"
      >{{ part.content }}</math-div>
    </template>
  </span>
</template>

<style scoped>
.formula-text {
  white-space: pre-wrap;
}

.formula-text__plain {
  white-space: inherit;
}

.formula-text__inline-math {
  display: inline-block;
  vertical-align: -0.16em;
}

.formula-text__block-math {
  display: block;
  margin: 12px auto;
  overflow-x: auto;
  text-align: center;
}
</style>
