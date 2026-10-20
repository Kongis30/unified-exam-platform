<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import FormulaText from '@shsat/components/FormulaText.vue';
import PaperPrintAnswer from '@shsat/components/paper/PaperPrintAnswer.vue';
import PaperPrintQuestion from '@shsat/components/paper/PaperPrintQuestion.vue';
import { adminApi } from '@shsat/admin/services/adminApi';
import { getEnglishErrorMessage } from '@shsat/admin/services/http';
import { extractShsatSkillTag } from '@shsat/utils/shsatSkillTags';
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
    return { imageUrl: material.assetUrl, title: material.materialTitle || '' };
  }
  const display = buildMaterialDisplayLines(material.materialContent);
  const title = String(material.materialTitle || '').trim();
  return {
    ...display,
    title,
    headerLines: display.headerLines.filter((line) => normalizeHeading(line.text) !== normalizeHeading(title)),
    bodyItems: reflowPrintMaterialBody(display.bodyItems),
  };
}

function normalizeHeading(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

// 正文单换行通常是 PDF 抽取产生的视觉折行；打印时合并为自然段，空行、图片和块公式仍作为边界保留。
function reflowPrintMaterialBody(items) {
  const result = [];
  let paragraphLines = [];

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    result.push({ type: 'text', key: `print-paragraph-${result.length}`, text: paragraphLines.join(' '), isEmpty: false });
    paragraphLines = [];
  };

  items.forEach((item) => {
    if (item.type === 'image') {
      flushParagraph();
      result.push(item);
    } else if (!item.text.trim()) {
      flushParagraph();
    } else if (/\$\$/.test(item.text)) {
      flushParagraph();
      result.push(item);
    } else {
      paragraphLines.push(item.text.trim());
    }
  });

  flushParagraph();
  return result;
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

// 打印前等待字体和图片完成，避免导出缺图或公式未排版的文件。
async function openPrintDialog() {
  noticeMessage.value = '';
  await document.fonts?.ready;
  const images = [...document.querySelectorAll('.paper-export img')];
  await Promise.all(images.map((image) => image.decode().catch(() => null)));
  const brokenImages = images.filter((image) => !image.complete || image.naturalWidth === 0);
  if (brokenImages.length) {
    noticeMessage.value = 'Some paper images could not be loaded. Fix the image links before exporting.';
    return;
  }
  window.print();
}

watch(() => route.query.section, (value) => {
  const normalized = String(value || 'ALL').toUpperCase();
  selectedSection.value = ['ELA', 'MATH'].includes(normalized) ? normalized : 'ALL';
}, { immediate: true });

watch(exportFileTitle, (value) => {
  document.title = value;
}, { immediate: true });

onMounted(loadPaper);
onBeforeUnmount(() => {
  document.title = previousDocumentTitle;
});
</script>

<template>
  <main class="paper-export">
    <div class="paper-export__toolbar no-print">
      <RouterLink class="paper-export__back" :to="{ name: 'shsat-admin', query: { tab: 'papers' } }">Back to Paper Management</RouterLink>
      <div class="paper-export__controls">
        <div class="paper-export__sections" role="group" aria-label="PDF type">
          <button type="button" :class="{ 'is-active': documentMode === 'STUDENT' }" @click="documentMode = 'STUDENT'">
            Student Paper
          </button>
          <button type="button" :class="{ 'is-active': documentMode === 'ANSWER' }" @click="documentMode = 'ANSWER'">
            Answer Key
          </button>
        </div>
        <div class="paper-export__sections" role="group" aria-label="PDF sections">
          <button
            v-for="option in [{ code: 'ALL', label: 'Whole Paper' }, ...sections.filter((section) => section.code !== 'OTHER').map((section) => ({ code: section.code, label: section.title }))]"
            :key="option.code"
            type="button"
            :class="{ 'is-active': selectedSection === option.code }"
            @click="selectedSection = option.code"
          >
            {{ option.label }}
          </button>
        </div>
        <button class="paper-export__print" type="button" :disabled="loading || !paper" @click="openPrintDialog">
          {{ documentMode === 'ANSWER' ? 'Print / Save Answer PDF' : 'Print / Save Student PDF' }}
        </button>
      </div>
    </div>

    <p v-if="noticeMessage" class="paper-export__notice no-print" role="alert">{{ noticeMessage }}</p>
    <p v-if="hasOtherQuestions" class="paper-export__notice no-print">
      Some questions do not have an ELA or Math tag. They are included in Whole Paper only.
    </p>

    <div v-if="loading" class="paper-export__state no-print">Loading paper...</div>
    <div v-else-if="errorMessage" class="paper-export__state paper-export__state--error no-print" role="alert">
      {{ errorMessage }}
      <button type="button" @click="loadPaper">Retry</button>
    </div>

    <template v-else-if="paper">
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

          <template v-for="item in section.items" :key="item.key">
            <article v-if="item.type === 'material'" class="print-material">
              <h2 v-if="item.display.title">{{ item.display.title }}</h2>
              <img
                v-if="item.display.imageUrl"
                :src="item.display.imageUrl"
                :alt="item.display.title || 'Question material'"
              >
              <template v-else>
                <p v-if="item.display.introduction" class="print-material__intro">
                  <FormulaText :content="item.display.introduction" />
                </p>
                <h3 v-for="line in item.display.headerLines" :key="line.key" :class="`print-material__${line.role}`">
                  {{ line.text }}
                </h3>
                <div class="print-material__body">
                  <template v-for="(bodyItem, index) in item.display.bodyItems" :key="bodyItem.key || index">
                    <img v-if="bodyItem.type === 'image'" :src="bodyItem.src" alt="Question material image">
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
          <footer class="print-running-footer" aria-hidden="true">
            <span>Jin Best Tutoring | {{ testLabel }}</span>
            <span>CONTINUE ON TO THE NEXT PAGE &gt;</span>
          </footer>
        </section>
      </template>

      <template v-if="documentMode === 'ANSWER'">
        <section v-for="section in visibleSections" :key="`answer-details-${section.code}`" class="answer-details">
          <h2 v-if="visibleSections.length > 1">{{ section.title }} Solutions</h2>
          <PaperPrintAnswer v-for="question in section.questions" :key="question.questionId" :question="question" />
        </section>
        <footer class="answer-running-footer" aria-hidden="true">
          <span>Jin Best Tutoring | {{ testLabel }}</span>
          <span>CONTINUE ON TO THE NEXT PAGE &gt;</span>
        </footer>
      </template>
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
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.paper-export__back { color: #315a9c; font-weight: 700; text-decoration: none; }
.paper-export__controls { display: flex; align-items: center; gap: 12px; }
.paper-export__sections { display: flex; gap: 4px; }
.paper-export__sections button,
.paper-export__print,
.paper-export__state button {
  min-height: 38px;
  border: 1px solid #cbd7e8;
  border-radius: 5px;
  padding: 0 12px;
  color: #294e8e;
  background: #fff;
  font: 600 13px Arial, sans-serif;
  cursor: pointer;
}
.paper-export__sections button.is-active,
.paper-export__print { border-color: #315fba; color: #fff; background: #315fba; }
.paper-export__print:disabled { opacity: .55; cursor: wait; }
.paper-export__notice { color: #9b3e2d; background: #fff8f5; }
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
.print-running-footer { display: none; }
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
.answer-running-footer { display: none; }
.print-section__heading { margin: 0 0 28px; text-align: center; }
.print-section__heading > p:first-child { margin: 0 0 14px; font-size: 13pt; }
.print-section__heading h1 { margin: 0; font-size: 19pt; text-transform: uppercase; }
.print-section__range { margin: 10px 0 0; font-size: 12pt; }
.print-instructions { margin: 0 0 26px; line-height: 1.55; }
.print-instructions h2 { margin: 0 0 6px; font-size: 12pt; text-transform: uppercase; }
.print-instructions p { margin: 0; font-size: 11.5pt; }
.print-material { margin: 20px 0 24px; line-height: 1.48; break-inside: auto; }
.print-material h2 { margin: 0 0 12px; font-size: 15pt; text-align: center; }
.print-material h3 { margin: 10px 0; text-align: center; }
.print-material__title { font-size: 13pt; }
.print-material__author { font-size: 11pt; font-weight: 400; }
.print-material__intro { margin: 0 0 18px; font-style: italic; }
.print-material__paragraph { margin: 0 0 8px; text-indent: .2in; white-space: pre-wrap; }
.print-material img { display: block; max-width: 100%; max-height: 8.2in; margin: 14px auto; object-fit: contain; }

@media screen {
  .print-section::after { content: 'Jin Best Tutoring'; position: absolute; bottom: .35in; left: .72in; color: #667085; font-size: 9pt; }
}

@page { size: letter; margin: .62in .72in .72in; }
@media print {
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  .paper-export { min-height: 0; padding: 0; background: #fff; }
  .no-print { display: none !important; }
  .print-cover, .print-blank-page, .print-section { width: auto; min-height: 9.66in; margin: 0; padding: .08in 0 .3in; box-shadow: none; }
  .answer-document-heading, .answer-key, .answer-details { width: auto; margin: 0; padding-right: 0; padding-left: 0; }
  .answer-key__grid { grid-template-rows: repeat(var(--answer-key-rows, 25), auto); }
  .answer-details { padding-bottom: 0; }
  .answer-running-footer { position: fixed; right: 0; bottom: -.52in; left: 0; display: flex; justify-content: space-between; color: #303840; font-size: 8.5pt; }
  .print-cover { break-after: page; page-break-after: always; }
  .print-blank-page { min-height: 9.66in; break-after: page; page-break-after: always; }
  .print-section--new-page { break-before: page; page-break-before: always; }
  .print-running-footer { position: fixed; right: 0; bottom: -.52in; left: 0; display: flex; justify-content: space-between; color: #303840; font-size: 8.5pt; }
}
</style>
