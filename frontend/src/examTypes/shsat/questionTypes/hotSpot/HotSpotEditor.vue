<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';

import { adminApi } from '@shsat/admin/services/adminApi';

import {
  getHotSpotValidationIssues,
  imageUrlForQuestion,
  nextRegionId,
  normalizeHotSpotAnswerData,
  normalizeHotSpotConfig,
} from './helpers';

const props = defineProps({
  question: {
    type: Object,
    required: true,
  },
  readonly: {
    type: Boolean,
    default: false,
  },
  paperId: {
    type: [Number, String],
    default: '',
  },
});

const emit = defineEmits(['patch', 'dirty']);

const activeRegionId = ref('');
const uploadingImage = ref(false);
const uploadError = ref('');
const uploadedFileName = ref('');
const dragState = ref(null);
const draftRegionPosition = ref(null);
let dragFrame = null;
let pendingDragPosition = null;

const questionConfig = computed(() => normalizeHotSpotConfig(props.question.questionConfig));
const regions = computed(() => questionConfig.value.regions);
const displayRegions = computed(() => {
  if (!draftRegionPosition.value) {
    return regions.value;
  }

  return regions.value.map((region) => {
    return region.id === draftRegionPosition.value.id
      ? { ...region, x: draftRegionPosition.value.x, y: draftRegionPosition.value.y }
      : region;
  });
});
const correctIds = computed(() => normalizeHotSpotAnswerData(props.question.correctAnswerData, questionConfig.value));
const validationIssues = computed(() => getHotSpotValidationIssues(props.question));
const imageUrl = computed(() => imageUrlForQuestion(props.question, questionConfig.value));

function patchEditor(nextConfig, nextCorrectIds = correctIds.value) {
  if (props.readonly) {
    return;
  }

  emit('patch', {
    options: [],
    questionConfig: {
      ...questionConfig.value,
      ...nextConfig,
      selectionMode: 'multi',
    },
    correctAnswerData: {
      selectedRegionIds: nextCorrectIds,
    },
  });
  emit('dirty');
}

function addRegion() {
  const id = nextRegionId(regions.value);
  activeRegionId.value = id;
  patchEditor({
    regions: [
      ...regions.value,
      { id, label: `Region ${regions.value.length + 1}`, shape: 'rect', x: 0.2, y: 0.2, width: 0.22, height: 0.16 },
    ],
  });
}

function updateRegion(regionId, patch) {
  patchEditor({
    regions: regions.value.map((region) => region.id === regionId ? { ...region, ...patch } : region),
  });
}

function removeRegion(regionId) {
  patchEditor(
    { regions: regions.value.filter((region) => region.id !== regionId) },
    correctIds.value.filter((id) => id !== regionId)
  );
}

function toggleCorrect(regionId) {
  patchEditor(
    {},
    correctIds.value.includes(regionId)
      ? correctIds.value.filter((id) => id !== regionId)
      : [...correctIds.value, regionId]
  );
}

function unwrapResponse(response) {
  if (response?.success === false) {
    throw new Error(response.message || 'Request failed');
  }

  return response?.data ?? response;
}

async function uploadHotSpotImage(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  uploadError.value = '';

  if (!file) {
    return;
  }

  if (!props.paperId) {
    uploadError.value = 'Save or reload the paper before uploading a hot spot image.';
    return;
  }

  uploadingImage.value = true;

  try {
    const saved = unwrapResponse(await adminApi.uploadQuestionImage(props.paperId, file));
    uploadedFileName.value = saved.originalFileName || file.name;
    patchEditor({ imageUrl: saved.assetUrl });
  } catch (error) {
    uploadError.value = error.message || 'Failed to upload hot spot image.';
  } finally {
    uploadingImage.value = false;
  }
}

function clearHotSpotImage() {
  uploadedFileName.value = '';
  uploadError.value = '';
  patchEditor({ imageUrl: '' });
}

function moveActiveRegion(event) {
  if (props.readonly || !activeRegionId.value || dragState.value) {
    return;
  }

  const rect = event.currentTarget.getBoundingClientRect();
  const region = regions.value.find((candidate) => candidate.id === activeRegionId.value);
  if (!region) {
    return;
  }

  const x = ((event.clientX - rect.left) / rect.width) - region.width / 2;
  const y = ((event.clientY - rect.top) / rect.height) - region.height / 2;
  updateRegion(region.id, {
    x: clampRatio(x),
    y: clampRatio(y),
  });
}

function startRegionDrag(event, region) {
  if (props.readonly) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  activeRegionId.value = region.id;

  const plane = event.currentTarget.closest('.hot-spot-editor__image-plane');
  if (!plane) {
    return;
  }

  const rect = plane.getBoundingClientRect();
  dragState.value = {
    id: region.id,
    pointerId: event.pointerId,
    rect,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: Number(region.x || 0),
    startY: Number(region.y || 0),
    width: Number(region.width || 0),
    height: Number(region.height || 0),
    moved: false,
  };
  draftRegionPosition.value = {
    id: region.id,
    x: Number(region.x || 0),
    y: Number(region.y || 0),
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function dragRegion(event) {
  const state = dragState.value;
  if (!state || event.pointerId !== state.pointerId) {
    return;
  }

  event.preventDefault();

  const deltaX = event.clientX - state.startClientX;
  const deltaY = event.clientY - state.startClientY;
  if (!state.moved && Math.hypot(deltaX, deltaY) < 3) {
    return;
  }

  state.moved = true;
  const nextX = state.startX + (event.clientX - state.startClientX) / state.rect.width;
  const nextY = state.startY + (event.clientY - state.startClientY) / state.rect.height;
  pendingDragPosition = {
    id: state.id,
    x: clampRegionRatio(nextX, state.width),
    y: clampRegionRatio(nextY, state.height),
  };

  if (dragFrame) {
    return;
  }

  dragFrame = window.requestAnimationFrame(() => {
    draftRegionPosition.value = pendingDragPosition;
    pendingDragPosition = null;
    dragFrame = null;
  });
}

function endRegionDrag(event) {
  const state = dragState.value;
  if (!state || event.pointerId !== state.pointerId) {
    return;
  }

  event.currentTarget.releasePointerCapture?.(event.pointerId);
  if (dragFrame) {
    window.cancelAnimationFrame(dragFrame);
    dragFrame = null;
  }

  const finalPosition = pendingDragPosition || draftRegionPosition.value;
  pendingDragPosition = null;
  dragState.value = null;
  draftRegionPosition.value = null;

  if (state.moved && finalPosition && finalPosition.id === state.id) {
    updateRegion(state.id, {
      x: finalPosition.x,
      y: finalPosition.y,
    });
  }
}

function cancelRegionDrag() {
  if (dragFrame) {
    window.cancelAnimationFrame(dragFrame);
    dragFrame = null;
  }

  pendingDragPosition = null;
  dragState.value = null;
  draftRegionPosition.value = null;
}

function clampRatio(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

function clampRegionRatio(value, size) {
  return Math.min(Math.max(1 - Number(size || 0), 0), Math.max(0, Number(value) || 0));
}

onBeforeUnmount(cancelRegionDrag);
</script>

<template>
  <div class="type-editor-panel hot-spot-editor">
    <div class="hot-spot-editor__intro">
      <strong>Build a hot spot question</strong>
      <p>Add an image, place clickable regions on it, then mark the correct regions.</p>
    </div>
    <ul v-if="validationIssues.length" class="hot-spot-editor__warning-list">
      <li v-for="issue in validationIssues" :key="issue">{{ issue }}</li>
    </ul>

    <section class="hot-spot-editor__section hot-spot-editor__source-section">
      <div class="subsection-title">
        <div>
          <strong>Hot Spot Image</strong>
          <p class="section-note">Upload JPG, PNG, WebP, or GIF. The server stores the file and the image path is saved with the question.</p>
        </div>
      </div>
      <div class="hot-spot-editor__upload-panel">
        <label class="hot-spot-editor__upload-button" :class="{ 'is-disabled': readonly || uploadingImage }">
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" :disabled="readonly || uploadingImage" @change="uploadHotSpotImage" />
          <span aria-hidden="true">↑</span>
          {{ uploadingImage ? 'Uploading...' : 'Upload Image' }}
        </label>
        <div class="hot-spot-editor__upload-meta">
          <strong>{{ uploadedFileName || (imageUrl ? 'Uploaded image is ready' : 'No image uploaded yet') }}</strong>
          <p v-if="imageUrl">{{ imageUrl }}</p>
          <p v-else>Select an image so the exam page can load it from the server.</p>
        </div>
        <button v-if="imageUrl" class="hot-spot-editor__clear-image-button" type="button" :disabled="readonly || uploadingImage" @click="clearHotSpotImage">
          Clear Image
        </button>
      </div>
      <p v-if="uploadError" class="hot-spot-editor__upload-error">{{ uploadError }}</p>
    </section>

    <section class="hot-spot-editor__section">
      <div class="subsection-title">
        <div>
          <strong>Clickable Regions</strong>
          <p class="section-note">Drag a region directly on the image, or edit exact percentage coordinates in the settings.</p>
        </div>
        <button class="hot-spot-editor__add-button" type="button" :disabled="readonly" @click="addRegion">
          <span aria-hidden="true">+</span>
          Add Region
        </button>
      </div>

      <div class="hot-spot-editor__layout">
        <div class="hot-spot-editor__stage-wrap">
          <div class="hot-spot-editor__stage-header">
            <strong>Image Stage</strong>
            <span>{{ regions.length }} {{ regions.length === 1 ? 'region' : 'regions' }}</span>
          </div>
          <div class="hot-spot-editor__canvas">
            <div v-if="imageUrl" class="hot-spot-editor__image-plane" @click="moveActiveRegion">
              <img :src="imageUrl" alt="Hot spot editor visual" />
              <button
                v-for="region in displayRegions"
                :key="region.id"
                class="hot-spot-editor__region"
                :class="{ 'is-active': activeRegionId === region.id, 'is-correct': correctIds.includes(region.id), 'is-dragging': dragState?.id === region.id }"
                type="button"
                :style="{
                  left: `${region.x * 100}%`,
                  top: `${region.y * 100}%`,
                  width: `${region.width * 100}%`,
                  height: `${region.height * 100}%`,
                }"
                @pointerdown="startRegionDrag($event, region)"
                @pointermove="dragRegion"
                @pointerup="endRegionDrag"
                @pointercancel="cancelRegionDrag"
                @click.stop="activeRegionId = region.id"
              >
                {{ region.label }}
              </button>
            </div>
            <div v-else class="hot-spot-editor__empty-canvas">
              <strong>No image configured</strong>
              <p>Upload an image above to preview and place clickable regions.</p>
            </div>
          </div>
          <p class="hot-spot-editor__stage-note">The stage is size-limited so large or tall images do not take over the editor.</p>
        </div>

        <div class="hot-spot-editor__region-list">
          <div class="hot-spot-editor__region-list-header">
            <strong>Region Settings</strong>
            <span>Target label, position, size, and correctness.</span>
          </div>
          <div v-if="regions.length" class="hot-spot-editor__region-cards">
            <div
              v-for="(region, index) in regions"
              :key="region.id"
              class="hot-spot-editor__region-row"
              :class="{ 'is-active': activeRegionId === region.id, 'is-correct': correctIds.includes(region.id) }"
              @click="activeRegionId = region.id"
            >
              <div class="hot-spot-editor__region-row-header">
                <span class="hot-spot-editor__region-index">{{ index + 1 }}</span>
                <input class="form-input" :value="region.label" :disabled="readonly" placeholder="Region label" @input="updateRegion(region.id, { label: $event.target.value })" />
                <button class="hot-spot-editor__remove-button" type="button" :disabled="readonly" aria-label="Remove region" @click.stop="removeRegion(region.id)">&times;</button>
              </div>
              <div class="hot-spot-editor__coords">
                <label>
                  <span>X</span>
                  <input class="form-input" type="number" min="0" max="100" step="1" :value="Math.round(region.x * 100)" :disabled="readonly" @input="updateRegion(region.id, { x: clampRatio($event.target.value / 100) })" />
                </label>
                <label>
                  <span>Y</span>
                  <input class="form-input" type="number" min="0" max="100" step="1" :value="Math.round(region.y * 100)" :disabled="readonly" @input="updateRegion(region.id, { y: clampRatio($event.target.value / 100) })" />
                </label>
                <label>
                  <span>W</span>
                  <input class="form-input" type="number" min="1" max="100" step="1" :value="Math.round(region.width * 100)" :disabled="readonly" @input="updateRegion(region.id, { width: clampRatio($event.target.value / 100) })" />
                </label>
                <label>
                  <span>H</span>
                  <input class="form-input" type="number" min="1" max="100" step="1" :value="Math.round(region.height * 100)" :disabled="readonly" @input="updateRegion(region.id, { height: clampRatio($event.target.value / 100) })" />
                </label>
              </div>
              <label class="hot-spot-editor__correct-control">
                <input type="checkbox" :checked="correctIds.includes(region.id)" :disabled="readonly" @change="toggleCorrect(region.id)" />
                <span>{{ correctIds.includes(region.id) ? 'Correct region' : 'Mark as correct' }}</span>
              </label>
            </div>
          </div>
          <div v-else class="hot-spot-editor__empty-list">
            <strong>No regions yet</strong>
            <p>Add a region, then click the image stage to place it.</p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.hot-spot-editor {
  display: grid;
  gap: 12px;
}

.hot-spot-editor__section {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 12px;
  background: #fbfcfe;
}

.hot-spot-editor__intro {
  padding: 12px 14px;
  border: 1px solid rgba(47, 111, 237, 0.16);
  border-radius: 12px;
  background: rgba(47, 111, 237, 0.06);
}

.hot-spot-editor__intro strong {
  display: block;
  color: #24314a;
  font-size: 14px;
}

.hot-spot-editor__intro p {
  margin: 4px 0 0;
  color: var(--color-text-muted);
  font-size: 13px;
}

.hot-spot-editor__source-section {
  background: #ffffff;
}

.hot-spot-editor__upload-panel {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  border: 1px dashed rgba(47, 111, 237, 0.24);
  border-radius: 12px;
  padding: 10px;
  background: #fbfdff;
}

.hot-spot-editor__upload-button {
  display: inline-flex;
  gap: 7px;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  border: 1px solid rgba(47, 111, 237, 0.32);
  border-radius: 999px;
  padding: 0 14px;
  color: #ffffff;
  background: var(--color-primary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
  box-shadow: 0 8px 18px rgba(47, 111, 237, 0.14);
}

.hot-spot-editor__upload-button input {
  display: none;
}

.hot-spot-editor__upload-button span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  color: var(--color-primary);
  background: #ffffff;
  font-size: 12px;
  line-height: 1;
}

.hot-spot-editor__upload-button:hover:not(.is-disabled) {
  background: var(--color-primary-strong);
}

.hot-spot-editor__upload-button.is-disabled {
  cursor: not-allowed;
  opacity: 0.55;
  box-shadow: none;
}

.hot-spot-editor__upload-meta {
  min-width: 0;
}

.hot-spot-editor__upload-meta strong {
  display: block;
  color: var(--color-text);
  font-size: 13px;
}

.hot-spot-editor__upload-meta p {
  overflow: hidden;
  margin: 3px 0 0;
  color: var(--color-text-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hot-spot-editor__clear-image-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  border: 1px solid rgba(199, 55, 71, 0.24);
  border-radius: 999px;
  padding: 0 12px;
  color: var(--color-danger);
  background: #ffffff;
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
}

.hot-spot-editor__clear-image-button:hover:not(:disabled) {
  background: #fff4f5;
}

.hot-spot-editor__clear-image-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.hot-spot-editor__upload-error {
  margin: 0;
  color: var(--color-danger);
  font-size: 12px;
  font-weight: 700;
}

.hot-spot-editor__warning-list {
  margin: 0;
  padding: 10px 14px 10px 30px;
  border: 1px solid rgba(213, 126, 0, 0.28);
  border-radius: 10px;
  color: #8a5600;
  background: #fff8e6;
}

.hot-spot-editor__layout {
  display: grid;
  grid-template-columns: minmax(320px, 1.25fr) minmax(280px, 0.75fr);
  gap: 12px;
  align-items: start;
}

.hot-spot-editor__add-button {
  display: inline-flex;
  gap: 7px;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  border: 1px solid rgba(47, 111, 237, 0.32);
  border-radius: 999px;
  padding: 0 14px;
  color: #ffffff;
  background: var(--color-primary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
  box-shadow: 0 8px 18px rgba(47, 111, 237, 0.14);
}

.hot-spot-editor__add-button span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  color: var(--color-primary);
  background: #ffffff;
  font-size: 13px;
  line-height: 1;
}

.hot-spot-editor__add-button:hover:not(:disabled) {
  background: var(--color-primary-strong);
}

.hot-spot-editor__add-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  box-shadow: none;
}

.hot-spot-editor__stage-wrap {
  display: grid;
  gap: 8px;
}

.hot-spot-editor__stage-header,
.hot-spot-editor__region-list-header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
  color: var(--color-text);
  font-size: 13px;
}

.hot-spot-editor__stage-header span,
.hot-spot-editor__region-list-header span {
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 700;
}

.hot-spot-editor__canvas {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  height: clamp(260px, 42vw, 430px);
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 14px;
  background:
    linear-gradient(45deg, rgba(148, 163, 184, 0.08) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(148, 163, 184, 0.08) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(148, 163, 184, 0.08) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(148, 163, 184, 0.08) 75%);
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-size: 16px 16px;
  background-color: #ffffff;
}

.hot-spot-editor__canvas img {
  display: block;
  width: auto;
  max-width: 100%;
  height: auto;
  max-height: 100%;
}

.hot-spot-editor__image-plane {
  position: relative;
  display: inline-block;
  max-width: 100%;
  max-height: 100%;
  line-height: 0;
  touch-action: none;
  user-select: none;
}

.hot-spot-editor__empty-canvas {
  display: grid;
  gap: 4px;
  max-width: 320px;
  padding: 18px;
  text-align: center;
}

.hot-spot-editor__empty-canvas strong {
  color: var(--color-text);
  font-size: 14px;
}

.hot-spot-editor__empty-canvas p,
.hot-spot-editor__stage-note {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 12px;
}

.hot-spot-editor__region {
  position: absolute;
  overflow: hidden;
  border: 2px solid rgba(47, 111, 237, 0.36);
  border-radius: 10px;
  background: rgba(47, 111, 237, 0.12);
  color: #1f4fa8;
  font-size: 11px;
  font-weight: 800;
  cursor: grab;
  touch-action: none;
  user-select: none;
  will-change: left, top;
}

.hot-spot-editor__region.is-active {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(47, 111, 237, 0.2);
}

.hot-spot-editor__region.is-correct {
  background: rgba(47, 111, 237, 0.22);
}

.hot-spot-editor__region.is-dragging {
  cursor: grabbing;
  box-shadow: 0 10px 24px rgba(47, 111, 237, 0.2);
}

.hot-spot-editor__region-list {
  display: grid;
  gap: 10px;
  max-height: 430px;
  overflow: auto;
  padding-right: 2px;
}

.hot-spot-editor__region-list-header {
  position: sticky;
  top: 0;
  z-index: 1;
  padding-bottom: 2px;
  background: #fbfcfe;
}

.hot-spot-editor__region-cards {
  display: grid;
  gap: 8px;
}

.hot-spot-editor__region-row {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 12px;
  background: #ffffff;
  cursor: pointer;
}

.hot-spot-editor__region-row.is-active {
  border-color: rgba(47, 111, 237, 0.45);
  box-shadow: 0 8px 18px rgba(47, 111, 237, 0.08);
}

.hot-spot-editor__region-row.is-correct {
  background: #f8fbff;
}

.hot-spot-editor__region-row-header {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 28px;
  gap: 8px;
  align-items: center;
}

.hot-spot-editor__region-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  color: var(--color-primary);
  background: rgba(47, 111, 237, 0.1);
  font-size: 12px;
  font-weight: 800;
}

.hot-spot-editor__coords {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.hot-spot-editor__coords label {
  display: grid;
  gap: 3px;
}

.hot-spot-editor__coords span {
  color: var(--color-text-muted);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.hot-spot-editor__correct-control {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  justify-self: start;
  border: 1px solid rgba(47, 111, 237, 0.22);
  border-radius: 999px;
  padding: 6px 10px;
  color: var(--color-primary);
  background: #ffffff;
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
}

.hot-spot-editor__correct-control input {
  margin: 0;
}

.hot-spot-editor__remove-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid rgba(199, 55, 71, 0.22);
  border-radius: 999px;
  color: var(--color-danger);
  background: #ffffff;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}

.hot-spot-editor__remove-button:hover:not(:disabled) {
  background: #fff4f5;
}

.hot-spot-editor__remove-button:disabled,
.hot-spot-editor__correct-control:has(input:disabled) {
  cursor: not-allowed;
  opacity: 0.55;
}

.hot-spot-editor__empty-list {
  display: grid;
  gap: 4px;
  border: 1px dashed rgba(148, 163, 184, 0.3);
  border-radius: 12px;
  padding: 14px;
  color: var(--color-text-muted);
  background: #ffffff;
}

.hot-spot-editor__empty-list strong {
  color: var(--color-text);
  font-size: 13px;
}

.hot-spot-editor__empty-list p {
  margin: 0;
  font-size: 12px;
}

@media (max-width: 900px) {
  .hot-spot-editor__upload-panel {
    grid-template-columns: 1fr;
  }

  .hot-spot-editor__clear-image-button,
  .hot-spot-editor__upload-button {
    justify-self: start;
  }

  .hot-spot-editor__layout {
    grid-template-columns: 1fr;
  }

  .hot-spot-editor__region-list {
    max-height: none;
  }
}
</style>
