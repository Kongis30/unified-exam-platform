<script setup>
import { computed, ref, watch } from 'vue';

import {
  imageUrlForQuestion,
  normalizeHotSpotAnswerData,
  normalizeHotSpotConfig,
} from './helpers';

const props = defineProps({
  question: {
    type: Object,
    required: true,
  },
  modelValue: {
    type: [Object, String, Array],
    default: () => ({ selectedRegionIds: [] }),
  },
  readonly: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['update:modelValue']);

const MIN_IMAGE_WIDTH = 380;
const MIN_IMAGE_HEIGHT = 260;
const MAX_IMAGE_WIDTH = 820;
const MAX_IMAGE_HEIGHT = 560;

const questionConfig = computed(() => normalizeHotSpotConfig(props.question.questionConfig));
const selectedIds = computed(() => normalizeHotSpotAnswerData(props.modelValue, questionConfig.value));
const imageUrl = computed(() => imageUrlForQuestion(props.question, questionConfig.value));
const imageLoading = ref(false);
const imageFailed = ref(false);
const naturalImageSize = ref({ width: 0, height: 0 });
const imageReady = computed(() => Boolean(imageUrl.value) && !imageLoading.value && !imageFailed.value);
const displayedImageSize = computed(() => {
  const width = naturalImageSize.value.width;
  const height = naturalImageSize.value.height;
  if (!width || !height) {
    return { width: MAX_IMAGE_WIDTH, height: MIN_IMAGE_HEIGHT };
  }

  const ratio = width / height;
  let displayWidth = Math.min(width, MAX_IMAGE_WIDTH);
  displayWidth = Math.max(displayWidth, Math.min(MIN_IMAGE_WIDTH, MAX_IMAGE_WIDTH));

  let displayHeight = displayWidth / ratio;
  if (displayHeight > MAX_IMAGE_HEIGHT) {
    displayHeight = MAX_IMAGE_HEIGHT;
    displayWidth = displayHeight * ratio;
  }
  if (displayHeight < MIN_IMAGE_HEIGHT) {
    displayHeight = MIN_IMAGE_HEIGHT;
    displayWidth = Math.min(MAX_IMAGE_WIDTH, displayHeight * ratio);
  }

  return {
    width: Math.round(displayWidth),
    height: Math.round(displayHeight),
  };
});
const imageStageStyle = computed(() => ({
  width: `${displayedImageSize.value.width}px`,
  aspectRatio: `${displayedImageSize.value.width} / ${displayedImageSize.value.height}`,
}));
const selectionCountText = computed(() => {
  const count = selectedIds.value.length;
  if (count === 0) {
    return 'No area selected';
  }
  return `${count} ${count === 1 ? 'area' : 'areas'} selected`;
});
const instructionText = computed(() => {
  return questionConfig.value.selectionMode === 'single'
    ? 'Click the correct area in the image.'
    : 'Click the correct area or areas in the image.';
});

watch(
  imageUrl,
  (nextUrl) => {
    imageFailed.value = false;
    imageLoading.value = Boolean(nextUrl);
  },
  { immediate: true }
);

function toggleRegion(regionId) {
  if (props.readonly || !imageReady.value) {
    return;
  }

  const nextIds = questionConfig.value.selectionMode === 'single'
    ? (selectedIds.value.includes(regionId) ? [] : [regionId])
    : (
      selectedIds.value.includes(regionId)
        ? selectedIds.value.filter((id) => id !== regionId)
        : [...selectedIds.value, regionId]
    );
  emit('update:modelValue', { selectedRegionIds: nextIds });
}

function clearSelection() {
  if (props.readonly) {
    return;
  }
  emit('update:modelValue', { selectedRegionIds: [] });
}

function handleImageLoaded(event) {
  naturalImageSize.value = {
    width: event.target.naturalWidth || 0,
    height: event.target.naturalHeight || 0,
  };
  imageLoading.value = false;
  imageFailed.value = false;
}

function handleImageFailed() {
  naturalImageSize.value = { width: 0, height: 0 };
  imageLoading.value = false;
  imageFailed.value = true;
}
</script>

<template>
  <div class="hot-spot-answer">
    <div class="hot-spot-answer__header">
      <p>{{ instructionText }}</p>
      <div class="hot-spot-answer__status">
        <span>{{ selectionCountText }}</span>
        <button v-if="selectedIds.length && !readonly" type="button" @click="clearSelection">Clear</button>
      </div>
    </div>

    <div class="hot-spot-answer__canvas" :class="{ 'is-unavailable': !imageReady }">
      <div v-if="imageUrl && !imageFailed" class="hot-spot-answer__stage" :style="imageStageStyle">
        <img
          :src="imageUrl"
          alt="Question image"
          @load="handleImageLoaded"
          @error="handleImageFailed"
        />

        <button
          v-if="imageReady"
          v-for="region in questionConfig.regions"
          :key="region.id"
          class="hot-spot-answer__region"
          :class="{ 'is-selected': selectedIds.includes(region.id) }"
          type="button"
          :style="{
            left: `${region.x * 100}%`,
            top: `${region.y * 100}%`,
            width: `${region.width * 100}%`,
            height: `${region.height * 100}%`,
          }"
          :disabled="readonly"
          :aria-label="region.label"
          :aria-pressed="selectedIds.includes(region.id)"
          @click="toggleRegion(region.id)"
        >
          <span v-if="selectedIds.includes(region.id)" class="hot-spot-answer__check" aria-hidden="true">✓</span>
        </button>
      </div>

      <div v-if="!imageUrl" class="hot-spot-answer__message" role="status">
        <strong>Image unavailable</strong>
        <p>This question image has not been added yet. Please notify the test administrator.</p>
      </div>

      <div v-else-if="imageLoading" class="hot-spot-answer__message" role="status">
        <span class="hot-spot-answer__spinner" aria-hidden="true"></span>
        <strong>Loading image</strong>
        <p>The question image is loading. You can answer once it appears.</p>
      </div>

      <div v-else-if="imageFailed" class="hot-spot-answer__message hot-spot-answer__message--error" role="alert">
        <strong>Image could not be displayed</strong>
        <p>Please notify the test administrator. Your current answers remain saved.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hot-spot-answer {
  display: grid;
  gap: 12px;
}

.hot-spot-answer__header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  color: var(--color-text);
  font-size: 14px;
}

.hot-spot-answer__header p {
  margin: 0;
}

.hot-spot-answer__status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  color: var(--color-muted);
  font-size: 13px;
}

.hot-spot-answer__status button {
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 4px 10px;
  color: var(--color-primary);
  background: #ffffff;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
}

.hot-spot-answer__canvas {
  position: relative;
  overflow: hidden;
  width: min(100%, 820px);
  min-height: 280px;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  background: #f8fafc;
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
}

.hot-spot-answer__canvas.is-unavailable {
  display: grid;
  place-items: center;
}

.hot-spot-answer__stage {
  position: relative;
  max-width: 100%;
  margin: 0 auto;
}

.hot-spot-answer__stage img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
}

.hot-spot-answer__message {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 8px;
  padding: 24px;
  text-align: center;
  color: #475569;
  background: linear-gradient(180deg, rgba(248, 250, 252, 0.94), rgba(241, 245, 249, 0.96));
}

.hot-spot-answer__message strong {
  color: #1f2937;
  font-size: 15px;
}

.hot-spot-answer__message p {
  max-width: 360px;
  margin: 0;
  line-height: 1.5;
}

.hot-spot-answer__message--error strong {
  color: #9f1239;
}

.hot-spot-answer__spinner {
  width: 24px;
  height: 24px;
  border: 3px solid rgba(47, 111, 237, 0.16);
  border-top-color: var(--color-primary);
  border-radius: 999px;
  animation: hot-spot-spin 0.9s linear infinite;
}

.hot-spot-answer__region {
  position: absolute;
  border: 2px solid rgba(47, 111, 237, 0.24);
  border-radius: 12px;
  background: rgba(47, 111, 237, 0.04);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}

.hot-spot-answer__region:hover:not(:disabled) {
  border-color: rgba(47, 111, 237, 0.52);
  background: rgba(47, 111, 237, 0.1);
}

.hot-spot-answer__region.is-selected {
  border-color: var(--color-primary);
  background: rgba(47, 111, 237, 0.16);
  box-shadow: 0 0 0 3px rgba(47, 111, 237, 0.16);
}

.hot-spot-answer__check {
  position: absolute;
  top: 6px;
  right: 6px;
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  color: #ffffff;
  background: var(--color-primary);
  font-size: 13px;
  font-weight: 800;
}

.hot-spot-answer__region:disabled {
  cursor: default;
}

@keyframes hot-spot-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 720px) {
  .hot-spot-answer__header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
