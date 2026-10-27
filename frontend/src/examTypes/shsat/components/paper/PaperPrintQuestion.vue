<script setup>
import { computed } from 'vue';

import FormulaText from '@shsat/components/FormulaText.vue';
import MixedContent from '@shsat/components/MixedContent.vue';
import GraphSelectPointsPlot from '@shsat/questionTypes/graphQuestion/GraphSelectPointsPlot.vue';
import { GRAPH_POINT_MODE, normalizeGraphConfig } from '@shsat/questionTypes/graphQuestion/helpers';
import { imageUrlForQuestion, normalizeHotSpotConfig } from '@shsat/questionTypes/hotSpot/helpers';
import { normalizeHotTextConfig } from '@shsat/questionTypes/hotText/helpers';
import { normalizeInlineChoiceConfig, parseInlineTextParts } from '@shsat/questionTypes/inlineChoice/helpers';
import { normalizeSolutionSetConfig } from '@shsat/questionTypes/solutionSet/helpers';
import SolutionSetNumberLine from '@shsat/questionTypes/solutionSet/SolutionSetNumberLine.vue';
import { normalizeTableGridItems, normalizeTableGridMode, TABLE_GRID_TEXT_MODE } from '@shsat/questionTypes/tableGrid/helpers';
import { INLINE_GAP_MATCH_MODE, normalizeDragAndDropConfig } from '@shsat/questionTypes/dragAndDrop/helpers';
import { isMultiSelectType, normalizeQuestionType, parseJsonObject, parseOptions } from '@shsat/questionTypes/utils';

const props = defineProps({
  question: { type: Object, required: true },
});

const questionType = computed(() => normalizeQuestionType(props.question.questionType));
const config = computed(() => parseJsonObject(props.question.questionConfig));
const options = computed(() => parseOptions(props.question.options));
const isMultiSelect = computed(() => isMultiSelectType(questionType.value));
const isChoiceQuestion = computed(() => [
  'MULTIPLE_CHOICE', 'MULTI_SELECT', 'MULTI_SELECT_FIXED', 'SINGLE_CHOICE', 'CHOICE',
  'CHECKBOX', 'MULTIPLE_RESPONSE', 'MULTIPLE_ANSWER',
].includes(questionType.value));

const inlineConfig = computed(() => normalizeInlineChoiceConfig(config.value, options.value));
const inlineParts = computed(() => parseInlineTextParts(inlineConfig.value.inlineText));
const dragConfig = computed(() => normalizeDragAndDropConfig(config.value));
const tableRows = computed(() => normalizeTableGridItems(config.value.rows, 'row'));
const tableColumns = computed(() => normalizeTableGridItems(config.value.columns, 'column'));
const tableTextMode = computed(() => normalizeTableGridMode(config.value) === TABLE_GRID_TEXT_MODE);
const graphConfig = computed(() => normalizeGraphConfig({
  ...config.value,
  graphMode: GRAPH_POINT_MODE,
  points: [],
}));
const solutionConfig = computed(() => normalizeSolutionSetConfig(config.value));
const hotTextConfig = computed(() => normalizeHotTextConfig(config.value));
const hotSpotConfig = computed(() => normalizeHotSpotConfig(config.value));
const hotSpotImageUrl = computed(() => imageUrlForQuestion(props.question, hotSpotConfig.value));

// 长目标句先完整呈现，再把作答线放到下一行；短公式继续与作答线并排。
function isLongTargetLabel(label) {
  const text = String(label || '').trim();
  return text.length > 26 || text.split(/\s+/).length > 4;
}

</script>

<template>
  <article class="print-question">
    <div class="print-question__stem">
      <strong class="print-question__number">{{ question.questionNumber }}.</strong>
      <MixedContent :content="question.stem || ''" />
    </div>

    <div v-if="isChoiceQuestion" class="print-question__choices">
      <div v-for="(option, index) in options" :key="`${option.key}-${index}`" class="print-question__choice">
        <span class="print-question__marker" :class="{ 'print-question__marker--checkbox': isMultiSelect }" aria-hidden="true"></span>
        <strong>{{ option.key }}.</strong>
        <FormulaText :content="option.text" />
      </div>
    </div>

    <template v-else-if="questionType === 'INLINE_CHOICE'">
      <p class="print-question__inline-text">
        <template v-for="(part, index) in inlineParts" :key="`${part.type}-${part.id || index}`">
          <span v-if="part.type === 'text'"><FormulaText :content="part.text" /></span>
          <span v-else class="print-question__inline-blank" aria-label="Answer blank"></span>
        </template>
      </p>
      <div class="print-question__inline-choice-groups">
        <section v-for="(blank, index) in inlineConfig.blanks" :key="blank.id" class="print-question__inline-choice-group">
          <strong class="print-question__inline-choice-label">{{ blank.label || `Blank ${index + 1}` }}</strong>
          <div class="print-question__inline-choice-options">
            <div v-for="option in blank.options" :key="option.key" class="print-question__inline-choice-option">
              <b>{{ option.key }}.</b>
              <FormulaText :content="option.text" />
            </div>
          </div>
        </section>
      </div>
    </template>

    <template v-else-if="questionType === 'DRAG_AND_DROP'">
      <p v-if="dragConfig.mode !== INLINE_GAP_MATCH_MODE" class="print-question__instruction">Use the answer choices to complete each target.</p>
      <div class="print-question__answer-bank">
        <span v-for="(choice, index) in dragConfig.choices" :key="choice.id" class="print-question__answer-choice">
          <b>{{ String.fromCharCode(65 + index) }}.</b> <FormulaText :content="choice.text" />
        </span>
      </div>
      <p v-if="dragConfig.mode === INLINE_GAP_MATCH_MODE" class="print-question__drag-inline">
        <template v-for="(part, index) in dragConfig.contentParts" :key="`${part.type}-${part.id || index}`">
          <span v-if="part.type === 'text'" class="print-question__drag-text"><FormulaText :content="part.text" /></span>
          <span v-else class="print-question__drag-gap" aria-label="Answer space"></span>
        </template>
      </p>
      <div v-else class="print-question__targets">
        <div
          v-for="target in dragConfig.targets"
          :key="target.id"
          class="print-question__target"
          :class="{ 'print-question__target--long': isLongTargetLabel(target.label) }"
        >
          <strong>{{ target.label }}</strong><span></span>
        </div>
      </div>
    </template>

    <div v-else-if="questionType === 'TABLE_GRID'" class="print-question__table-wrap">
      <table class="print-question__table">
        <colgroup>
          <col class="print-question__table-label-column">
          <col v-for="column in tableColumns" :key="column.id" class="print-question__table-answer-column">
        </colgroup>
        <thead><tr><th></th><th v-for="column in tableColumns" :key="column.id">{{ column.label }}</th></tr></thead>
        <tbody>
          <tr v-for="row in tableRows" :key="row.id">
            <th>{{ row.label }}</th>
            <td v-for="column in tableColumns" :key="column.id">
              <span v-if="!tableTextMode" class="print-question__table-marker" aria-hidden="true"></span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else-if="questionType === 'GRAPH_QUESTION'" class="print-question__graph">
      <p>{{ graphConfig.interaction.instruction || 'Plot the point or points on the coordinate plane.' }}</p>
      <GraphSelectPointsPlot :question-config="graphConfig" :readonly="true" mode="answer" />
    </div>

    <div v-else-if="questionType === 'SOLUTION_SET'" class="print-question__number-line">
      <p>{{ solutionConfig.instruction }}</p>
      <SolutionSetNumberLine :question-config="solutionConfig" :model-value="{}" :readonly="true" />
    </div>

    <div v-else-if="questionType === 'HOT_SPOT'" class="print-question__hotspot">
      <p>{{ hotSpotConfig.selectionMode === 'single' ? 'Mark the correct area.' : 'Mark the correct area or areas.' }}</p>
      <img v-if="hotSpotImageUrl" :src="hotSpotImageUrl" alt="Question image">
      <div v-else class="print-question__response-lines"><span></span></div>
    </div>

    <div v-else-if="questionType === 'HOT_TEXT'" class="print-question__hot-text">
      <p>Underline or circle the word or phrase that answers the question.</p>
      <p class="print-question__passage">
        <template v-for="(part, index) in hotTextConfig.contentParts" :key="part.id || index">
          <span :class="{ 'print-question__marked-text': part.type === 'segment' }">{{ part.text }}</span>
        </template>
      </p>
    </div>

    <div v-else class="print-question__response-lines" :class="{ 'print-question__response-lines--short': questionType === 'FILL_IN_BLANK' }">
      <span></span>
      <span v-if="questionType !== 'FILL_IN_BLANK'"></span>
    </div>
  </article>
</template>

<style>
.print-question {
  margin: 0 0 14px;
  padding: 0;
  font-size: 10.5pt;
  line-height: 1.3;
  break-inside: avoid-page;
  page-break-inside: avoid;
}
.print-question__stem { display: flex; align-items: baseline; gap: 7px; white-space: pre-wrap; }
.print-question__number { flex: 0 0 auto; }
.print-question__choices { display: grid; gap: 2px; margin: 7px 0 0 14px; }
.print-question__choice { display: grid; grid-template-columns: 18px 23px minmax(0, 1fr); align-items: start; gap: 5px; }
.print-question__marker { width: 9px; height: 9px; margin-top: .42em; border: 1px solid #303840; border-radius: 50%; }
.print-question__marker--checkbox, .print-question__table-marker { border-radius: 0; }
.print-question__table-marker { display: inline-block; width: 9px; height: 9px; border: 1px solid #303840; }
.print-question__instruction { margin: 7px 0; font-style: italic; }
.print-question__answer-bank { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 8px 0; padding: 6px 8px; border: 1px solid #7d858d; break-inside: avoid-page; page-break-inside: avoid; }
.print-question__answer-choice { display: inline-flex; align-items: baseline; gap: 4px; min-width: 0; max-width: 100%; white-space: normal; }
.print-question__drag-inline { margin: 7px 0 3px; line-height: 1.8; white-space: pre-wrap; }
.print-question__drag-text { white-space: pre-wrap; }
.print-question__drag-gap { display: inline-block; width: .85in; height: 1em; margin: 0 3px; border-bottom: 1px solid #525960; vertical-align: baseline; }
.print-question__targets { display: grid; gap: 7px; margin-top: 7px; }
.print-question__targets > div { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(1.1in, 1fr); align-items: end; gap: 10px; break-inside: avoid-page; page-break-inside: avoid; }
.print-question__targets > .print-question__target--long { grid-template-columns: minmax(0, 1fr); gap: 3px; }
.print-question__targets span { min-height: 20px; border-bottom: 1px solid #525960; }
.print-question__inline-text { white-space: pre-wrap; }
.print-question__inline-blank { display: inline-block; min-width: 1in; height: 1em; margin: 0 3px; border-bottom: 1px solid #303840; vertical-align: baseline; }
.print-question__inline-choice-groups { margin-top: 6px; }
.print-question__inline-choice-group { margin: 5px 0; break-inside: avoid-page; page-break-inside: avoid; }
.print-question__inline-choice-label { display: block; margin-bottom: 3px; }
.print-question__inline-choice-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3px 16px; }
.print-question__inline-choice-option { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; gap: 4px; min-width: 0; }
.print-question__table { width: 100%; margin-top: 12px; border-collapse: collapse; table-layout: fixed; text-align: center; }
.print-question__table-label-column { width: 44%; }
.print-question__table-answer-column { width: auto; }
.print-question__table th, .print-question__table td { border: 1px solid #555; padding: 5px 7px; overflow-wrap: anywhere; }
.print-question__table th:first-child { text-align: left; }
.print-question__graph { margin-top: 12px; break-inside: avoid; }
.print-question__graph > p, .print-question__number-line > p, .print-question__hotspot > p, .print-question__hot-text > p:first-child { margin: 0 0 8px; font-style: italic; }
.print-question__graph svg { max-width: 100%; }
.print-question__number-line { margin-top: 12px; break-inside: avoid; }
.print-question__number-line figure { margin: 8px 0 0; }
.print-question__hotspot img { display: block; max-width: 100%; max-height: 5in; margin: 12px auto; object-fit: contain; }
.print-question__passage { white-space: pre-wrap; }
.print-question__marked-text { text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 2px; }
.print-question__response-lines { display: grid; gap: 22px; margin: 18px 0 4px 20px; }
.print-question__response-lines span { min-height: 25px; border-bottom: 1px solid #525960; }
.print-question__response-lines--short { max-width: 2.2in; }
.print-question .mixed-content__image { max-width: 70%; border: 0; border-radius: 0; box-shadow: none; }
.print-question .mixed-content__image-block { cursor: default; }
.print-question .mixed-content__block-math,
.print-question .formula-text__block-math { margin: 5px auto; }
@media print {
  .print-question { break-inside: avoid-page; page-break-inside: avoid; }
  .print-question__table thead { display: table-header-group; }
  .print-question__table tr { break-inside: avoid; page-break-inside: avoid; }
  .print-question__graph svg, .print-question__number-line svg { print-color-adjust: exact; }
}
</style>
