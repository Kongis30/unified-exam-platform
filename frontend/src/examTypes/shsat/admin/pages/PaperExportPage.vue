<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import FormulaText from '@shsat/components/FormulaText.vue';
import PaperPrintAnswer from '@shsat/components/paper/PaperPrintAnswer.vue';
import PaperPrintQuestion from '@shsat/components/paper/PaperPrintQuestion.vue';
import { adminApi } from '@shsat/admin/services/adminApi';
import { getEnglishErrorMessage } from '@shsat/admin/services/http';
import { extractShsatSkillTag } from '@shsat/utils/shsatSkillTags';
import { formatMaterialBodyForPrint } from '@shsat/utils/printMaterial';
import { buildMaterialDisplayLines } from '@shsat/utils/textMaterial';
import { normalizeQuestionType, parseJsonObject } from '@shsat/questionTypes/utils';

const route = useRoute();
const paper = ref(null);
const loading = ref(true);
const errorMessage = ref('');
const noticeMessage = ref('');
const selectedSection = ref('ALL');
const documentMode = ref('STUDENT');
const previousDocumentTitle = document.title;
let printPageTitleStyle = null;

const sectionNames = {
  ELA: 'English Language Arts',
  MATH: 'Mathematics',
  OTHER: 'Other Questions',
};

const questions = computed(() => [...(paper.value?.questions || [])]
  .sort((left, right) => Number(left.questionNumber || left.displayOrder || 0) - Number(right.questionNumber || right.displayOrder || 0)));

const sections = computed(() => {
  const grouped = new Map();
  questions.value.forEach((question) => {
    const code = sectionCode(question);
    if (!grouped.has(code)) grouped.set(code, []);
    grouped.get(code).push(question);
  });

  return ['ELA', 'MATH', 'OTHER']
    .filter((code) => grouped.has(code))
    .map((code) => ({ code, title: sectionNames[code], questions: grouped.get(code) }));
});

const visibleSections = computed(() => selectedSection.value === 'ALL'
  ? sections.value
  : sections.value.filter((section) => section.code === selectedSection.value));

const printItemsBySection = computed(() => visibleSections.value.map((section) => ({
  ...section,
  items: buildPrintItems(section.questions, paper.value?.materials || []),
})));

const testLabel = computed(() => {
  const name = String(paper.value?.paperName || 'SHSAT Practice Test');
  const matched = name.match(/(crash\s*course\s*)?(?:test|exam)\s*#?\s*(\d+)/i);
  if (!matched) return name;
  return `${matched[1] ? 'Crash Course ' : ''}Test ${matched[2]}`;
});

const exportFileTitle = computed(() => {
  const section = selectedSection.value === 'ALL' ? 'Whole Paper' : sectionNames[selectedSection.value];
  const documentType = documentMode.value === 'ANSWER' ? 'Solutions' : 'Student Paper';
  return `${paper.value?.paperName || 'SHSAT Paper'} - ${section} - ${documentType}`;
});

const hasOtherQuestions = computed(() => sections.value.some((section) => section.code === 'OTHER'));

function sectionCode(question) {
  const configured = String(question.scoringSectionCode || '').toUpperCase();
  if (configured.includes('ELA')) return 'ELA';
  if (configured.includes('MATH')) return 'MATH';
  const tagged = extractShsatSkillTag(parseJsonObject(question.questionConfig)).subjectCode;
  return tagged === 'ELA' || tagged === 'MATH' ? tagged : 'OTHER';
}

// 按 SHSAT 分科标签组织试题，并在关联题首次出现时插入材料。
function buildPrintItems(sectionQuestions, materials) {
  const materialById = new Map(materials.map((material) => [String(material.materialId), material]));
  const emittedMaterials = new Set();
  const items = [];

  sectionQuestions.forEach((question) => {
    const materialId = question.materialId == null ? '' : String(question.materialId);
    if (materialId && !emittedMaterials.has(materialId)) {
      const material = materialById.get(materialId);
      if (material) items.push({
        type: 'material',
        key: `material-${materialId}`,
        material,
        display: materialModel(material),
      });
      emittedMaterials.add(materialId);
    }
    items.push({ type: 'question', key: `question-${question.questionId}`, question });
  });

  return items;
}

function materialModel(material) {
  if (String(material.materialType || '').toUpperCase() === 'IMAGE' && material.assetUrl) {
    return { imageUrl: material.assetUrl, title: '' };
  }
  const display = buildMaterialDisplayLines(material.materialContent);
  const title = String(material.materialTitle || '').trim();
  return {
    ...display,
    title,
    headerLines: display.headerLines.filter((line) => normalizeHeading(line.text) !== normalizeHeading(title)),
    bodyItems: formatMaterialBodyForPrint(display.bodyItems),
  };
}

function normalizeHeading(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

async function loadPaper() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const response = await adminApi.getPaper(route.params.paperId);
    paper.value = response?.data ?? response;
    if (!paper.value?.paperId) throw new Error('Paper data is unavailable.');
  } catch (error) {
    errorMessage.value = getEnglishErrorMessage(error, 'Unable to load this paper for PDF export.');
  } finally {
    loading.value = false;
  }
}

// 打印前等待公式字体就绪；图片仅做即时检查，缺失或仍在加载时提示但不拦截用户打印。
async function openPrintDialog() {
  noticeMessage.value = '';
  document.querySelectorAll('.paper-export math-span, .paper-export math-div')
    .forEach((element) => element.render?.());
  await document.fonts?.ready;
  const images = [...document.querySelectorAll('.paper-export img')];
  const unavailableImages = images.filter((image) => image.complete && image.naturalWidth === 0);
  const pendingImages = images.filter((image) => !image.complete);
  if (unavailableImages.length || pendingImages.length) {
    noticeMessage.value = 'Some images are missing or still loading. You can continue printing; affected images may be blank.';
  }
  window.print();
}

// 为打印纸张设置随试卷名称更新的页眉样式，离开页面时会移除。
function setPrintPageTitle(title) {
  if (!title) return;
  if (!printPageTitleStyle) {
    printPageTitleStyle = document.createElement('style');
    printPageTitleStyle.dataset.paperPrintTitle = 'true';
    document.head.append(printPageTitleStyle);
  }
  printPageTitleStyle.textContent = `@page { @top-center { content: ${JSON.stringify(title)}; } }`;
}

watch(() => route.query.section, (value) => {
  const normalized = String(value || 'ALL').toUpperCase();
  selectedSection.value = ['ELA', 'MATH'].includes(normalized) ? normalized : 'ALL';
}, { immediate: true });

watch(exportFileTitle, (value) => {
  document.title = value;
}, { immediate: true });

watch(() => paper.value?.paperName, setPrintPageTitle, { immediate: true });

onMounted(loadPaper);
onBeforeUnmount(() => {
  document.title = previousDocumentTitle;
  printPageTitleStyle?.remove();
});
</script>

<template>
  <main class="paper-export">
    <div class="paper-export__toolbar no-print">
      <div class="paper-export__toolbar-heading">
        <RouterLink class="paper-export__back" :to="{ name: 'shsat-admin' }">Back to Paper Management</RouterLink>
        <span class="paper-export__toolbar-title">Print setup</span>
      </div>
      <div class="paper-export__controls">
        <div class="paper-export__control-group" role="group" aria-label="Document type">
          <span class="paper-export__control-label">Document</span>
          <div class="paper-export__segments">
            <button type="button" :aria-pressed="documentMode === 'STUDENT'" :class="{ 'is-active': documentMode === 'STUDENT' }" @click="documentMode = 'STUDENT'">
              Student Paper
            </button>
            <button type="button" :aria-pressed="documentMode === 'ANSWER'" :class="{ 'is-active': documentMode === 'ANSWER' }" @click="documentMode = 'ANSWER'">
              Answer Key
            </button>
          </div>
        </div>
        <div class="paper-export__control-group" role="group" aria-label="Paper section">
          <span class="paper-export__control-label">Section</span>
          <div class="paper-export__segments">
            <button
              v-for="option in [{ code: 'ALL', label: 'All Sections' }, ...sections.filter((section) => section.code !== 'OTHER').map((section) => ({ code: section.code, label: section.code }))]"
              :key="option.code"
              type="button"
              :aria-pressed="selectedSection === option.code"
              :class="{ 'is-active': selectedSection === option.code }"
              @click="selectedSection = option.code"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
        <button
          class="paper-export__print"
          type="button"
          :aria-label="documentMode === 'ANSWER' ? 'Print or save answer key PDF' : 'Print or save student paper PDF'"
          :disabled="loading || !paper"
          @click="openPrintDialog"
        >
          Print / Save PDF
        </button>
      </div>
    </div>

    <p class="paper-export__print-hint no-print">
      In print settings, turn off “Headers and footers” to omit the browser date and URL. The document includes the paper name and page number.
    </p>
    <p v-if="noticeMessage" class="paper-export__notice no-print" role="alert">{{ noticeMessage }}</p>
    <p v-if="hasOtherQuestions" class="paper-export__notice no-print">
      Some questions do not have an ELA or Math tag. They are included in Whole Paper only.
    </p>
    <p v-if="paper" class="paper-export__scroll-hint no-print">Swipe horizontally to view the full Letter-size page.</p>

    <div v-if="loading" class="paper-export__state no-print">Loading paper...</div>
    <div v-else-if="errorMessage" class="paper-export__state paper-export__state--error no-print" role="alert">
      {{ errorMessage }}
      <button type="button" @click="loadPaper">Retry</button>
    </div>

    <template v-else-if="paper">
      <div class="paper-export__document-scroll">
      <template v-if="documentMode === 'STUDENT'">
      <section class="print-cover">
        <img class="print-cover__logo" src="/logo.png" alt="Jin Best Tutoring">
        <p class="print-cover__brand">Jin Best Tutoring</p>
        <p class="print-cover__contact">(929) 528-1060 / (929) 701-9872</p>
        <p class="print-cover__contact">14456 Roosevelt Ave, Flushing, NY 11354</p>
        <div class="print-cover__exam-name">
          <span v-if="selectedSection !== 'ALL'">{{ sectionNames[selectedSection] }} - SHSAT</span>
          <span v-else>SHSAT - {{ sections.map((section) => section.title).join(' & ') }}</span>
          <strong>{{ testLabel }}</strong>
        </div>
        <div class="print-cover__student">Student Name: ______________________________</div>
      </section>

      <div class="print-blank-page" aria-hidden="true"></div>
      </template>

      <template v-if="documentMode === 'ANSWER'">
        <section class="answer-document-heading">
          <h1>{{ testLabel }} Solutions</h1>
          <p v-if="selectedSection !== 'ALL'">{{ sectionNames[selectedSection] }} Section</p>
          <p v-else>SHSAT Practice Test</p>
        </section>
        <section v-for="section in visibleSections" :key="`answer-key-${section.code}`" class="answer-key">
          <h2 v-if="visibleSections.length > 1">{{ section.title }}</h2>
          <div class="answer-key__grid" :style="{ '--answer-key-rows': Math.ceil(section.questions.length / 2) }">
            <div v-for="question in section.questions" :key="question.questionId" class="answer-key__item">
              <strong>{{ question.questionNumber }}.</strong>
              <PaperPrintAnswer :question="question" compact />
            </div>
          </div>
        </section>
      </template>

      <template v-for="(section, sectionIndex) in printItemsBySection" :key="section.code">
        <section v-if="documentMode === 'STUDENT'" class="print-section" :class="{ 'print-section--new-page': sectionIndex > 0 }">
          <header class="print-section__heading">
            <p>{{ testLabel }}</p>
            <h1>{{ section.title }} Section</h1>
            <p class="print-section__range">
              Questions {{ section.questions[0]?.questionNumber }}-{{ section.questions[section.questions.length - 1]?.questionNumber }}
            </p>
          </header>

          <div class="print-instructions">
            <h2>Directions</h2>
            <p v-if="section.code === 'ELA'">Read each passage and answer the questions that follow. Base your answers on the information provided.</p>
            <p v-else-if="section.code === 'MATH'">Solve each problem. Select the best answer or write your answer in the space provided.</p>
            <p v-else>Answer each question using the space or choices provided.</p>
          </div>

          <div class="print-section__columns">
            <template v-for="item in section.items" :key="item.key">
              <article v-if="item.type === 'material'" class="print-material">
                <h2 v-if="item.display.title">{{ item.display.title }}</h2>
                <img
                  v-if="item.display.imageUrl"
                  :src="item.display.imageUrl"
                  alt="Question material image"
                >
                <template v-else>
                  <p v-if="item.display.introduction" class="print-material__intro">
                    <FormulaText :content="item.display.introduction" />
                  </p>
                  <h3 v-for="line in item.display.headerLines" :key="line.key" :class="`print-material__${line.role}`">
                    <FormulaText :content="line.text" />
                  </h3>
                  <div class="print-material__body">
                    <template v-for="(bodyItem, index) in item.display.bodyItems" :key="bodyItem.key || index">
                      <img v-if="bodyItem.type === 'image'" :src="bodyItem.src" alt="Question material image">
                      <table v-else-if="bodyItem.type === 'table'" class="print-material__table">
                        <thead v-if="bodyItem.hasHeader">
                          <tr><th v-for="(cell, cellIndex) in bodyItem.rows[0]" :key="cellIndex"><FormulaText :content="cell" /></th></tr>
                        </thead>
                        <tbody>
                          <tr v-for="(row, rowIndex) in bodyItem.rows.slice(bodyItem.hasHeader ? 1 : 0)" :key="rowIndex">
                            <td v-for="(cell, cellIndex) in row" :key="cellIndex"><FormulaText :content="cell" /></td>
                          </tr>
                        </tbody>
                      </table>
                      <p v-else-if="bodyItem.text.trim()" class="print-material__paragraph"><FormulaText :content="bodyItem.text" /></p>
                    </template>
                  </div>
                </template>
              </article>
              <PaperPrintQuestion
                v-else
                :question="item.question"
              />
            </template>
          </div>
        </section>
      </template>

      <template v-if="documentMode === 'ANSWER'">
        <section v-for="section in visibleSections" :key="`answer-details-${section.code}`" class="answer-details">
          <h2 v-if="visibleSections.length > 1">{{ section.title }} Solutions</h2>
          <PaperPrintAnswer v-for="question in section.questions" :key="question.questionId" :question="question" />
        </section>
      </template>
      </div>
    </template>
  </main>
</template>

<style>
.paper-export {
  min-height: 100vh;
  padding: 24px;
  color: #202938;
  background: #eef2f7;
  font-family: Georgia, 'Times New Roman', serif;
}

.paper-export__toolbar,
.paper-export__state,
.paper-export__notice {
  max-width: 8.5in;
  margin: 0 auto 16px;
  padding: 16px 20px;
  border: 1px solid #d4deeb;
  border-radius: 8px;
  background: #fff;
  font-family: Arial, sans-serif;
}

.paper-export__toolbar {
  display: grid;
  gap: 14px;
}

.paper-export__toolbar-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e5eaf1;
}

.paper-export__back {
  color: #315a9c;
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
}

.paper-export__back:hover { text-decoration: underline; }
.paper-export__toolbar-title { color: #697586; font-size: 12px; font-weight: 700; }
.paper-export__controls {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: end;
  gap: 12px;
}

.paper-export__control-group { display: grid; gap: 6px; min-width: 0; }
.paper-export__control-label { color: #697586; font-size: 11px; font-weight: 700; }
.paper-export__segments {
  display: flex;
  gap: 3px;
  min-height: 38px;
  padding: 3px;
  border: 1px solid #d9e1ec;
  border-radius: 7px;
  background: #f3f6fa;
}

.paper-export__segments button,
.paper-export__print,
.paper-export__state button {
  min-height: 38px;
  border: 1px solid transparent;
  border-radius: 5px;
  padding: 0 11px;
  color: #294e8e;
  background: transparent;
  font: 600 13px Arial, sans-serif;
  cursor: pointer;
  white-space: nowrap;
}

.paper-export__segments button:hover:not(.is-active) { background: #e8edf5; }
.paper-export__segments button.is-active { border-color: #c5d5ef; color: #244e91; background: #fff; box-shadow: 0 1px 2px rgba(24, 42, 70, .08); }
.paper-export__print { border-color: #315fba; color: #fff; background: #315fba; font-weight: 700; }
.paper-export__print:hover:not(:disabled) { background: #244f9f; }
.paper-export__print:disabled { opacity: .55; cursor: wait; }
.paper-export__notice { color: #9b3e2d; background: #fff8f5; }
.paper-export__print-hint {
  max-width: 8.5in;
  margin: 0 auto 12px;
  color: #697586;
  font: 12px/1.45 Arial, sans-serif;
}
.paper-export__document-scroll { box-sizing: border-box; width: 100%; max-width: 8.5in; margin: 0 auto; overflow-x: auto; overflow-y: hidden; }
.paper-export__scroll-hint { display: none; }
.paper-export__state--error { color: #9b3e2d; }

.print-cover,
.print-blank-page,
.print-section {
  box-sizing: border-box;
  width: 8.5in;
  min-height: 11in;
  margin: 0 auto 24px;
  padding: .75in .72in .85in;
  background: #fff;
  box-shadow: 0 2px 14px rgba(19, 38, 68, .12);
}

.print-cover {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.print-cover__logo { width: 1.2in; height: 1.2in; object-fit: contain; margin-bottom: 24px; }
.print-cover__brand { margin: 0 0 12px; font-size: 26pt; font-weight: 700; }
.print-cover__contact { margin: 2px 0; font-size: 11pt; }
.print-cover__exam-name { display: grid; gap: 14px; margin-top: 1.4in; font-size: 18pt; }
.print-cover__exam-name strong { font-size: 20pt; }
.print-cover__student { align-self: stretch; margin-top: 1.2in; text-align: left; font-size: 14pt; }
.print-blank-page { page-break-after: always; }

.print-section { position: relative; }
.print-section--new-page { break-before: page; page-break-before: always; }
.answer-document-heading { width: 8.5in; margin: 0 auto 18px; padding: .1in .72in 0; text-align: center; }
.answer-document-heading h1 { margin: 0 0 5px; font-size: 18pt; }
.answer-document-heading p { margin: 0; font-size: 11pt; }
.answer-key { width: 8.5in; margin: 0 auto 14px; padding: 0 .72in; }
.answer-key h2 { margin: 0 0 6px; font-size: 12pt; }
.answer-key__grid { display: grid; grid-template-columns: 1fr 1fr; grid-auto-flow: column; grid-template-rows: repeat(var(--answer-key-rows, 25), auto); gap: 2px 28px; }
.answer-key__item { display: grid; grid-template-columns: 34px minmax(0, 1fr); align-items: baseline; font-size: 9.5pt; line-height: 1.25; }
.answer-key__item > strong { white-space: nowrap; }
.answer-details { width: 8.5in; margin: 0 auto; padding: 0 .72in .3in; }
.answer-details h2 { margin: 18px 0 12px; font-size: 14pt; }
.print-section__heading { margin: 0 0 14px; text-align: center; }
.print-section__heading > p:first-child { margin: 0 0 5px; font-size: 10pt; }
.print-section__heading h1 { margin: 0; font-size: 12pt; text-transform: uppercase; }
.print-section__range { margin: 4px 0 0; font-size: 9pt; }
.print-instructions { margin: 0 0 12px; line-height: 1.3; }
.print-instructions h2 { margin: 0 0 4px; font-size: 10pt; text-transform: uppercase; }
.print-instructions p { margin: 0; font-size: 10pt; }
.print-material { margin: 10px 0 16px; line-height: 1.4; break-inside: auto; }
.print-material h2 { margin: 0 0 12px; font-size: 15pt; text-align: center; }
.print-material h3 { margin: 10px 0; text-align: center; }
.print-material__title { font-size: 13pt; }
.print-material__author { font-size: 11pt; font-weight: 400; }
.print-material__intro { margin: 0 0 18px; font-style: italic; }
.print-material__paragraph { margin: 0 0 8px; text-indent: .2in; white-space: pre-wrap; }
.print-material img { display: block; max-width: 100%; max-height: 6in; margin: 10px auto; object-fit: contain; }
.print-material__table { width: 100%; margin: 8px 0 12px; border-collapse: collapse; table-layout: auto; font-size: .96em; line-height: 1.25; }
.print-material__table th, .print-material__table td { padding: 3px 5px; border-bottom: 1px solid #858b92; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.print-material__table thead { display: table-header-group; }
.print-material__table th { font-weight: 700; }
.print-material__table tr { break-inside: avoid; page-break-inside: avoid; }

@media screen and (max-width: 760px) {
  .paper-export { padding: 16px; }
  .paper-export__toolbar { padding: 14px; }
  .paper-export__scroll-hint { display: block; max-width: 8.5in; margin: 0 auto 10px; color: #697586; font: 12px/1.45 Arial, sans-serif; }
  .paper-export__controls { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .paper-export__control-group:last-of-type { grid-column: 1 / -1; }
  .paper-export__segments button { flex: 1 1 auto; padding: 0 8px; }
  .paper-export__print { grid-column: 1 / -1; width: 100%; }
}

@media screen and (max-width: 420px) {
  .paper-export__controls { grid-template-columns: minmax(0, 1fr); }
  .paper-export__control-group:last-of-type,
  .paper-export__print { grid-column: auto; }
}

@page {
  size: letter;
  margin: .72in .72in .62in;

  @top-center {
    content: "";
    color: #303840;
    font: 9pt Georgia, 'Times New Roman', serif;
  }

  @bottom-center {
    content: counter(page);
    color: #303840;
    font: 9pt Georgia, 'Times New Roman', serif;
  }
}

@media print {
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  .paper-export { min-height: 0; padding: 0; background: #fff; }
  .no-print { display: none !important; }
  .paper-export__document-scroll { width: auto; max-width: none; margin: 0; overflow: visible; }
  .print-cover, .print-blank-page, .print-section { width: auto; min-height: 9.66in; margin: 0; padding: .16in 0 .3in; box-shadow: none; }
  .answer-document-heading, .answer-key, .answer-details { width: auto; margin: 0; padding-right: 0; padding-left: 0; }
  .answer-key__grid { grid-template-rows: repeat(var(--answer-key-rows, 25), auto); }
  .answer-details { padding-bottom: 0; }
  .print-cover { break-after: page; page-break-after: always; }
  .print-blank-page { min-height: 9.66in; break-after: page; page-break-after: always; }
  .print-section--new-page { break-before: page; page-break-before: always; }
  .print-section__columns { column-count: 1; column-gap: 0; column-fill: auto; }
  .print-section__columns .print-question { break-inside: avoid-page; page-break-inside: avoid; }
  .print-material h2, .print-material h3 { break-after: avoid-page; }
  .print-material__paragraph { orphans: 3; widows: 3; }
}
</style>
