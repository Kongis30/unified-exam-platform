<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import AppButton from '@/components/AppButton.vue';
import MixedContent from '@shsat/components/MixedContent.vue';
import MonitorQuestionDetail from '@shsat/components/MonitorQuestionDetail.vue';
import { getQuestionTypeDefinition, parseJson } from '@shsat/questionTypes';
import { studentApi } from '@shsat/admin/services/studentApi';

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const errorMessage = ref('');
const report = ref(null);
const remainingQuestionNumbers = ref(null);
const activeIndex = ref(0);
const previewImageUrl = ref('');

const reviewQuestions = computed(() => {
  const remaining = remainingQuestionNumbers.value;
  const remainingSet = remaining ? new Set(remaining.map(Number)) : null;
  return (report.value?.questions || [])
    .filter((question) => !hasSubmittedAnswer(question) || question.correct === false)
    .filter((question) => !remainingSet || remainingSet.has(Number(question.questionNumber)))
    .sort((left, right) => Number(left.questionNumber || 0) - Number(right.questionNumber || 0));
});
const activeQuestion = computed(() => reviewQuestions.value[activeIndex.value] || null);
const activeQuestionForDisplay = computed(() => {
  const question = activeQuestion.value;
  if (!question) {
    return null;
  }

  const hasMaterial = question.materialId || question.materialTitle || question.materialContent || question.assetUrl;
  return {
    ...question,
    material: hasMaterial ? {
      materialId: question.materialId,
      materialType: question.materialType,
      materialTitle: question.materialTitle,
      materialContent: question.materialContent,
      assetUrl: question.assetUrl,
    } : null,
  };
});
const studentAnswerComponent = computed(() => {
  return getQuestionTypeDefinition(activeQuestion.value?.questionType).components?.report || null;
});

function unwrapResponse(response) {
  if (response?.success === false) {
    throw new Error(response.message || 'Failed to load wrong answers.');
  }
  return response?.data ?? response;
}

function hasMeaningfulAnswer(value) {
  if (value === null || value === undefined || value === '') {
    return false;
  }
  const parsed = parseJson(value, value);
  if (typeof parsed === 'string') {
    return parsed.trim() !== '';
  }
  if (typeof parsed === 'number' || typeof parsed === 'boolean') {
    return true;
  }
  if (Array.isArray(parsed)) {
    return parsed.some(hasMeaningfulAnswer);
  }
  if (parsed && typeof parsed === 'object') {
    return Object.values(parsed).some(hasMeaningfulAnswer);
  }
  return false;
}

function hasSubmittedAnswer(question) {
  return hasMeaningfulAnswer(question.answerData) || hasMeaningfulAnswer(question.selectedAnswer);
}

function answerLabel(question) {
  if (!hasSubmittedAnswer(question)) {
    return 'Not answered';
  }
  const definition = getQuestionTypeDefinition(question.questionType);
  return definition.formatReportAnswer?.({
    question,
    answerData: question.answerData,
    selectedAnswer: question.selectedAnswer,
    emptyText: 'Not answered',
  }) || String(question.selectedAnswer ?? question.answerData ?? 'Not answered');
}

function questionStatus(question) {
  return hasSubmittedAnswer(question) ? 'Incorrect' : 'Unanswered';
}

function selectQuestion(index) {
  activeIndex.value = index;
}

function goToQuestion(offset) {
  const nextIndex = activeIndex.value + offset;
  if (nextIndex >= 0 && nextIndex < reviewQuestions.value.length) {
    activeIndex.value = nextIndex;
  }
}

function goBack() {
  router.push(typeof route.query.returnTo === 'string' ? route.query.returnTo : '/student');
}

async function loadReviewQuestions() {
  loading.value = true;
  errorMessage.value = '';
  try {
    report.value = unwrapResponse(await studentApi.getAttemptResult(route.params.attemptId));
    if (!report.value.answersVisible) {
      errorMessage.value = 'Answers are not available for this exam yet.';
      return;
    }
    remainingQuestionNumbers.value = unwrapResponse(
      await studentApi.getWrongAnswerQuestionNumbers(route.params.attemptId),
    );
  } catch (error) {
    errorMessage.value = error.message || 'Failed to load wrong answers. Please try again.';
  } finally {
    loading.value = false;
  }
}

onMounted(loadReviewQuestions);
</script>

<template>
    <section class="page-shell wrong-answer-review">
      <header class="wrong-answer-review__header">
        <div>
          <p class="wrong-answer-review__eyebrow">Wrong Answer Book</p>
          <h1 v-if="report"><span>Student:</span> {{ report.studentName || 'Not returned' }}</h1>
          <h1 v-else>Wrong Answer Review</h1>
          <div v-if="report" class="wrong-answer-review__exam-context">
            <p><span>Exam</span><strong>{{ report.examTitle || 'Unavailable' }}</strong></p>
            <p><span>Paper</span><strong>{{ report.paperName || (report.paperId ? `Paper #${report.paperId}` : 'Unavailable') }}</strong></p>
          </div>
          <p v-if="report" class="wrong-answer-review__summary">
            {{ reviewQuestions.length }} incorrect or unanswered questions
          </p>
        </div>
        <AppButton variant="secondary" @click="goBack">Back to Wrong Answer Book</AppButton>
      </header>

      <div v-if="loading" class="wrong-answer-review__state" role="status">Loading questions...</div>
      <div v-else-if="errorMessage" class="wrong-answer-review__state wrong-answer-review__state--error" role="alert">
        {{ errorMessage }}
      </div>
      <div v-else-if="!reviewQuestions.length" class="wrong-answer-review__state">
        This wrong-answer book has been cleared. There are no questions left to review.
      </div>
      <div v-else class="wrong-answer-review__workspace">
        <nav class="wrong-answer-review__menu" aria-label="Wrong answer question menu">
          <h2>Questions</h2>
          <button
            v-for="(question, index) in reviewQuestions"
            :key="question.questionNumber"
            type="button"
            class="wrong-answer-review__menu-item"
            :class="{
              'wrong-answer-review__menu-item--active': index === activeIndex,
              'wrong-answer-review__menu-item--unanswered': !hasSubmittedAnswer(question),
            }"
            :aria-current="index === activeIndex ? 'true' : undefined"
            @click="selectQuestion(index)"
          >
            <span>Q{{ question.questionNumber }}</span>
            <small>{{ questionStatus(question) }}</small>
          </button>
        </nav>

        <article v-if="activeQuestion && activeQuestionForDisplay" class="wrong-answer-review__question">
          <header class="wrong-answer-review__question-header">
            <div>
              <p>{{ activeQuestion.subTypeName || activeQuestion.partName || 'Question' }}</p>
              <h2>Question {{ activeQuestion.questionNumber }}</h2>
            </div>
            <span
              class="wrong-answer-review__status"
              :class="{ 'wrong-answer-review__status--unanswered': !hasSubmittedAnswer(activeQuestion) }"
            >
              {{ questionStatus(activeQuestion) }}
            </span>
          </header>

          <section class="wrong-answer-review__answer">
            <h3>Your answer</h3>
            <component
              :is="studentAnswerComponent"
              v-if="studentAnswerComponent && hasSubmittedAnswer(activeQuestion)"
              :question="activeQuestion"
              :answer-data="activeQuestion.answerData"
              :selected-answer="activeQuestion.selectedAnswer"
              empty-text="Not answered"
            />
            <MixedContent
              v-else
              :content="answerLabel(activeQuestion)"
              text-mode="markdown"
            />
          </section>

          <MonitorQuestionDetail
            :question="activeQuestionForDisplay"
            :question-number="Number(activeQuestion.questionNumber)"
            @preview-image="previewImageUrl = $event"
          />

          <footer class="wrong-answer-review__navigation">
            <AppButton variant="secondary" :disabled="activeIndex === 0" @click="goToQuestion(-1)">
              Previous
            </AppButton>
            <span>{{ activeIndex + 1 }} / {{ reviewQuestions.length }}</span>
            <AppButton
              variant="primary"
              :disabled="activeIndex >= reviewQuestions.length - 1"
              @click="goToQuestion(1)"
            >
              Next
            </AppButton>
          </footer>
        </article>
      </div>

      <div v-if="previewImageUrl" class="wrong-answer-review__image-overlay" @click.self="previewImageUrl = ''">
        <button type="button" aria-label="Close image preview" @click="previewImageUrl = ''">Close</button>
        <img :src="previewImageUrl" alt="Question image preview" />
      </div>
    </section>
</template>

<style scoped>
.wrong-answer-review { display: grid; gap: 20px; }
.wrong-answer-review__header { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.wrong-answer-review__eyebrow { margin: 0 0 6px; color: var(--color-primary); font-size: 12px; font-weight: 800; text-transform: uppercase; }
.wrong-answer-review__header h1 { margin: 0; color: var(--color-text); font-size: 22px; font-weight: 800; }
.wrong-answer-review__header h1 span { color: var(--color-muted); }
.wrong-answer-review__exam-context { display: grid; gap: 5px; margin-top: 8px; }
.wrong-answer-review__exam-context p { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; font-size: 17px; }
.wrong-answer-review__exam-context span { min-width: 48px; color: var(--color-muted); font-weight: 800; }
.wrong-answer-review__exam-context strong { color: var(--color-text); font-weight: 800; }
.wrong-answer-review__summary { margin: 7px 0 0; color: var(--color-muted); }
.wrong-answer-review__state { display: grid; min-height: 220px; place-items: center; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: #fff; color: var(--color-muted); }
.wrong-answer-review__state--error { color: #b42318; }
.wrong-answer-review__workspace { display: grid; grid-template-columns: minmax(190px, 240px) minmax(0, 1fr); align-items: start; gap: 20px; }
.wrong-answer-review__menu { position: sticky; top: 16px; display: grid; gap: 7px; max-height: calc(100vh - 32px); overflow: auto; padding: 16px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: #fff; }
.wrong-answer-review__menu h2 { margin: 0 0 4px; font-size: 16px; }
.wrong-answer-review__menu-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 42px; border: 1px solid var(--color-border); border-radius: 8px; padding: 0 10px; background: #fff; color: var(--color-text); text-align: left; cursor: pointer; }
.wrong-answer-review__menu-item--active { border-color: var(--color-primary); background: var(--color-primary-soft); color: var(--color-primary-strong); }
.wrong-answer-review__menu-item small { color: var(--color-muted); font-size: 11px; }
.wrong-answer-review__menu-item--unanswered small { color: #9a6700; }
.wrong-answer-review__question { display: grid; gap: 16px; min-width: 0; padding: 20px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: #fff; }
.wrong-answer-review__question-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--color-border); padding-bottom: 14px; }
.wrong-answer-review__question-header p { margin: 0 0 4px; color: var(--color-muted); font-size: 12px; }
.wrong-answer-review__question-header h2 { margin: 0; font-size: 20px; }
.wrong-answer-review__status { border-radius: 999px; padding: 5px 10px; color: #a12d25; background: #fff0ee; font-size: 12px; font-weight: 700; }
.wrong-answer-review__status--unanswered { color: #8a5b00; background: #fff5d8; }
.wrong-answer-review__answer { display: grid; gap: 8px; border: 1px solid #f1d5d2; border-radius: 8px; padding: 14px; background: #fff9f8; }
.wrong-answer-review__answer h3 { margin: 0; font-size: 14px; }
.wrong-answer-review__navigation { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-top: 1px solid var(--color-border); padding-top: 14px; }
.wrong-answer-review__navigation span { color: var(--color-muted); font-size: 13px; font-weight: 700; }
.wrong-answer-review__image-overlay { position: fixed; z-index: 1000; inset: 0; display: grid; place-items: center; padding: 24px; background: rgba(15, 23, 42, .78); }
.wrong-answer-review__image-overlay img { max-width: min(100%, 1100px); max-height: calc(100vh - 48px); object-fit: contain; }
.wrong-answer-review__image-overlay button { position: absolute; top: 20px; right: 20px; min-height: 40px; border: 0; border-radius: 8px; padding: 0 14px; background: #fff; color: #17233a; cursor: pointer; }
@media (max-width: 760px) {
  .wrong-answer-review__header { align-items: flex-start; flex-direction: column; }
  .wrong-answer-review__workspace { grid-template-columns: minmax(0, 1fr); }
  .wrong-answer-review__menu { position: static; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); max-height: 220px; }
  .wrong-answer-review__menu h2 { grid-column: 1 / -1; }
  .wrong-answer-review__question { padding: 14px; }
}
</style>
