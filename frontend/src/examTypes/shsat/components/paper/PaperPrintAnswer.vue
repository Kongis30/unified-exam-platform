<script setup>
import { computed } from 'vue';

import FormulaText from '@shsat/components/FormulaText.vue';
import { getQuestionTypeDefinition, normalizeQuestionType, parseJson, parseJsonObject, parseOptions } from '@shsat/questionTypes';
import { extractShsatSkillTag, shsatSkillTagLabel } from '@shsat/utils/shsatSkillTags';
import { answerDisplayText } from '@/utils/answerDisplay.js';

const props = defineProps({
  question: { type: Object, required: true },
  compact: { type: Boolean, default: false },
});

// 复用考试报告的题型标准化与答案格式化契约，确保复杂题型导出的答案可读。
const normalizedQuestion = computed(() => {
  const question = {
    ...props.question,
    questionType: normalizeQuestionType(props.question.questionType, 'TEXT'),
    options: parseOptions(props.question.options),
    questionConfig: parseJsonObject(props.question.questionConfig),
    correctAnswerData: parseJson(props.question.correctAnswerData, props.question.correctAnswerData),
  };
  const definition = getQuestionTypeDefinition(question.questionType);
  return definition.migrated ? definition.normalizeQuestion(question) : question;
});

const definition = computed(() => getQuestionTypeDefinition(normalizedQuestion.value.questionType));
const answer = computed(() => {
  const question = normalizedQuestion.value;
  const formatted = definition.value.formatReportAnswer?.({
    question,
    answerData: question.correctAnswerData,
    selectedAnswer: question.correctAnswer,
    emptyText: '',
  });
  return answerDisplayText(formatted || question.correctAnswer, '—');
});
const skillTag = computed(() => extractShsatSkillTag(normalizedQuestion.value.questionConfig));
const topic = computed(() => shsatSkillTagLabel(skillTag.value).replace(' · ', ' - '));
const explanation = computed(() => {
  const config = normalizedQuestion.value.questionConfig;
  return String(config.explanation || config.solutionExplanation || config.rationale || '').trim();
});
</script>

<template>
  <span v-if="compact" class="print-answer-compact"><FormulaText :content="answer" /></span>
  <article v-else class="print-answer">
    <h3>{{ question.questionNumber }}. Answer: <FormulaText :content="answer" /></h3>
    <p v-if="topic"><strong>Topic:</strong> {{ topic }}</p>
    <p v-if="question.difficulty"><strong>Level:</strong> {{ question.difficulty }}</p>
    <div v-if="explanation" class="print-answer__explanation">
      <strong>Explanation:</strong>
      <FormulaText :content="explanation" />
    </div>
  </article>
</template>

<style>
.print-answer-compact { min-width: 0; }
.print-answer { margin: 0 0 18px; font-size: 10.5pt; line-height: 1.4; break-inside: avoid-page; page-break-inside: avoid; }
.print-answer h3 { margin: 0 0 3px; font-size: 11pt; }
.print-answer p { margin: 0 0 2px; }
.print-answer__explanation { margin-top: 5px; white-space: pre-wrap; }
.print-answer__explanation > strong { display: block; }
</style>
