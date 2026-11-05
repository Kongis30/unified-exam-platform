<script setup>
import { computed, ref } from 'vue';

import MixedContent from '@shsat/components/MixedContent.vue';
import SafeMarkdownText from '@shsat/components/SafeMarkdownText.vue';
import { getQuestionTypeDefinition, normalizeQuestionType, parseJsonObject, parseOptions } from '@shsat/questionTypes';
import { buildMaterialDisplayLines } from '@shsat/utils/textMaterial';

const props = defineProps({
  question: {
    type: Object,
    required: true,
  },
  questionNumber: {
    type: Number,
    required: true,
  },
});

const emit = defineEmits(['preview-image']);
const unavailableImageUrls = ref(new Set());

const normalizedQuestion = computed(() => normalizeQuestion(props.question));
const answerComponent = computed(() => getQuestionTypeDefinition(normalizedQuestion.value.questionType).components.answer);
const material = computed(() => normalizedQuestion.value.material || null);
const materialDisplay = computed(() => {
  if (!material.value || material.value.assetUrl) {
    return null;
  }
  return buildMaterialDisplayLines(material.value.materialContent || '', { category: material.value.materialCategory || material.value.category, title: material.value.materialTitle || material.value.title });
});
const correctAnswerValue = computed(() => buildCorrectAnswerValue(normalizedQuestion.value));
const correctAnswerDisplay = computed(() => formatCorrectAnswer(normalizedQuestion.value));

function normalizeQuestion(question) {
  const questionType = normalizeQuestionType(question.questionType, 'TEXT');
  const normalizedQuestion = {
    ...question,
    questionNumber: Number(question.questionNumber || props.questionNumber),
    questionType,
    stem: question.stem || 'Question stem is not available',
    options: parseOptions(question.options),
    questionConfig: parseJsonObject(question.questionConfig),
    validationRules: parseJsonObject(question.validationRules),
    scoringRules: parseJsonObject(question.scoringRules),
    material: question.material || null,
  };

  const definition = getQuestionTypeDefinition(questionType);
  return definition.migrated ? definition.normalizeQuestion(normalizedQuestion) : normalizedQuestion;
}

function previewMaterialImage(item) {
  emit('preview-image', item.src);
}

function previewQuestionImage(item) {
  emit('preview-image', item.src);
}

function markImageUnavailable(url) {
  unavailableImageUrls.value = new Set([...unavailableImageUrls.value, url]);
}

// 侧边详情使用标准答案作为只读预览值；公式编辑器需要 `{ value }`，不能直接接收 acceptedAnswers 对象。
function buildCorrectAnswerValue(question) {
  if (question.questionType === 'EQUATION_EDITOR') {
    const acceptedAnswer = question.correctAnswerData?.acceptedAnswers?.[0]?.value;
    return { value: question.correctAnswer || acceptedAnswer || '' };
  }

  return question.correctAnswerData || question.correctAnswer || '';
}

// 统一复用题型定义的答案格式化逻辑，避免把下拉框键值（如 B/C）直接展示给管理员。
function formatCorrectAnswer(question) {
  const definition = getQuestionTypeDefinition(question.questionType);
  const formattedAnswer = definition.formatReportAnswer?.({
    question,
    answerData: question.correctAnswerData,
    selectedAnswer: question.correctAnswer,
    emptyText: '',
  });

  return formattedAnswer || question.correctAnswer || '—';
}
</script>

<template>
  <div class="monitor-question-detail">
    <section v-if="material" class="monitor-question-section">
      <h3>Material</h3>
      <button
        v-if="material.assetUrl && !unavailableImageUrls.has(material.assetUrl)"
        type="button"
        class="monitor-question-image-button"
        title="Click to enlarge image"
        @click="previewMaterialImage({ src: material.assetUrl })"
      >
        <img :src="material.assetUrl" alt="Question material" @error="markImageUnavailable(material.assetUrl)" />
      </button>
      <p v-else-if="material.assetUrl" class="monitor-image-unavailable" role="status">Question image is unavailable.</p>

      <div v-else-if="materialDisplay" class="monitor-material-display">
        <p v-if="materialDisplay.hasIntroduction" class="monitor-material-introduction">
          <SafeMarkdownText :content="materialDisplay.introduction" />
        </p>
        <div v-if="materialDisplay.hasHeader" class="monitor-material-header">
          <p v-for="line in materialDisplay.headerLines" :key="line.key" :class="`monitor-material-header__${line.role}`">
            <SafeMarkdownText :content="line.text" />
          </p>
        </div>
        <div v-if="materialDisplay.hasBody" class="monitor-material-body">
          <template v-for="item in materialDisplay.bodyItems" :key="item.key">
            <button
              v-if="item.type === 'image' && !unavailableImageUrls.has(item.src)"
              type="button"
              class="monitor-question-image-button monitor-question-image-button--inline"
              title="Click to enlarge image"
              @click="previewMaterialImage(item)"
            >
              <img :src="item.src" :alt="item.alt" @error="markImageUnavailable(item.src)" />
            </button>
            <p v-else-if="item.type === 'image'" class="monitor-image-unavailable" role="status">Question image is unavailable.</p>
            <div v-else class="monitor-material-line" :class="{ 'monitor-material-line--empty': item.isEmpty }">
              <SafeMarkdownText :content="item.text" />
            </div>
          </template>
        </div>
      </div>
    </section>

    <section class="monitor-question-section">
      <h3>Question</h3>
      <div class="monitor-question-stem">
        <MixedContent
          :content="normalizedQuestion.stem"
          text-mode="markdown"
          @image-click="previewQuestionImage"
        />
      </div>
    </section>

    <section class="monitor-question-section">
      <h3>Answer choices</h3>
      <component
        :is="answerComponent"
        v-if="answerComponent"
        :question="normalizedQuestion"
        :model-value="correctAnswerValue"
        :readonly="true"
        :answers-visible="true"
        :correct-answer-data="correctAnswerValue"
      />
      <div v-else-if="normalizedQuestion.options?.length" class="monitor-fallback-options">
        <div v-for="option in normalizedQuestion.options" :key="option.key" class="monitor-fallback-option">
          <strong>{{ option.key }}</strong>
          <span>{{ option.text }}</span>
        </div>
      </div>
      <p v-else class="monitor-question-empty">No answer configuration is available.</p>
    </section>

    <div class="monitor-correct-answer">
      <span>Correct answer</span>
      <strong>{{ correctAnswerDisplay }}</strong>
    </div>
  </div>
</template>

<style scoped>
.monitor-question-detail { display: grid; gap: 14px; }
.monitor-question-section { border: 1px solid #d8e2ee; border-radius: 10px; padding: 14px; background: #fbfdff; }
.monitor-question-section h3 { margin: 0 0 12px; padding-bottom: 8px; border-bottom: 1px solid #dfe7f1; color: #17233a; font-size: 15px; }
.monitor-question-stem { color: #24314a; line-height: 1.65; }
.monitor-material-display { color: #24314a; line-height: 1.55; }
.monitor-material-introduction { margin: 0 0 12px; }
.monitor-material-header { margin-bottom: 12px; }
.monitor-material-header p { margin: 0; }
.monitor-material-header__title { font-weight: 800; }
.monitor-material-header__author { color: #5c6b82; font-size: 13px; }
.monitor-material-body { display: grid; gap: 6px; }
.monitor-material-line { min-height: 1.55em; }
.monitor-material-line--empty { min-height: 0.8em; }
.monitor-question-image-button { display: block; width: 100%; border: 0; padding: 0; background: transparent; cursor: zoom-in; }
.monitor-question-image-button img { display: block; width: auto; max-width: 100%; max-height: 360px; margin: 0 auto; border: 1px solid #d8e2ee; border-radius: 8px; object-fit: contain; }
.monitor-question-image-button--inline { margin: 8px 0; }
.monitor-image-unavailable { margin: 0; border: 1px dashed #cbd8e8; border-radius: 8px; padding: 14px; color: #65758f; background: #f6f9fd; text-align: center; }
.monitor-fallback-options { display: grid; gap: 8px; }
.monitor-fallback-option { display: flex; gap: 10px; border: 1px solid #d8e2ee; border-radius: 8px; padding: 10px; background: #fff; color: #24314a; }
.monitor-fallback-option strong { color: #2f6fed; }
.monitor-question-empty { margin: 0; color: #738198; }
.monitor-correct-answer { display: flex; justify-content: space-between; gap: 12px; border-radius: 8px; padding: 12px 14px; color: #155f4b; background: #e9f8f1; }
.monitor-correct-answer strong { overflow-wrap: anywhere; text-align: right; }
</style>
