<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import AppButton from '@/components/AppButton.vue';
import AppCard from '@/components/AppCard.vue';
import AdminLayout from '@/components/admin/AdminLayout.vue';
import { getQuestionTypeDefinition } from '@shsat/questionTypes';
import { normalizeQuestionType, parseJson } from '@shsat/questionTypes/utils';
import { adminApi } from '@shsat/admin/services/adminApi';
import { studentApi } from '@shsat/admin/services/studentApi';
import { authState } from '@/auth';
import {
  extractShsatSkillTag,
  normalizeShsatSkillTag,
  SHSAT_SKILL_TAGS,
  shsatSkillTagByCode,
  shsatSkillTagLabel,
} from '@shsat/utils/shsatSkillTags';

const route = useRoute();
const router = useRouter();

const loading = ref(false);
const errorMessage = ref('');
const report = ref(null);
const activeFilter = ref(route.query.filter === 'incorrect' ? 'incorrect' : 'all');
const EMPTY_CORRECT_ANSWER_TEXT = '-';

const attemptId = computed(() => route.params.attemptId);
const returnTo = computed(() => getQueryStringValue(route.query.returnTo));
const returnLabel = computed(() => getQueryStringValue(route.query.returnLabel) || 'Back to Dashboard');
const reportStudentName = computed(() => {
  return report.value?.studentName
    || getQueryStringValue(route.query.studentName)
    || 'Not returned';
});
const useAdminReportApi = computed(() => isAdmin() || isAdminRouteContext());
const questions = computed(() => {
  return [...(report.value?.questions || [])].sort((left, right) => {
    return Number(left.questionNumber || 0) - Number(right.questionNumber || 0);
  });
});
const answeredQuestionCount = computed(() => questions.value.filter(hasSubmittedAnswer).length);
const rawSectionMaxima = computed(() => ({
  ela: positiveInteger(report.value?.elaRawMaxScore),
  math: positiveInteger(report.value?.mathRawMaxScore),
}));
const rawTotalMaxScore = computed(() => {
  const { ela, math } = rawSectionMaxima.value;
  return ela !== null && math !== null ? ela + math : null;
});
const isReviewReport = computed(() => Boolean(report.value?.review));
const isPracticeReport = computed(() => Boolean(report.value?.practice) && !isReviewReport.value);
const isQuestionSetReport = computed(() => isReviewReport.value || isPracticeReport.value);
const questionFilters = computed(() => {
  const allQuestions = questions.value;
  const baseFilters = [
    { key: 'all', label: 'All Questions', count: allQuestions.length },
    { key: 'incorrect', label: 'Needs Review', count: allQuestions.filter(isReviewRequired).length },
    { key: 'unanswered', label: 'Unanswered', count: allQuestions.filter((question) => getQuestionOutcome(question) === 'unanswered').length },
    { key: 'answered', label: 'Answered', count: allQuestions.filter((question) => getQuestionOutcome(question) !== 'unanswered').length },
  ];

  return baseFilters.filter((filter) => filter.key !== 'incorrect' || report.value?.answersVisible);
});
const filteredQuestions = computed(() => {
  if (activeFilter.value === 'all') {
    return questions.value;
  }

  return questions.value.filter((question) => {
    const outcome = getQuestionOutcome(question);
    if (activeFilter.value === 'incorrect') {
      return isReviewRequired(question);
    }
    if (activeFilter.value === 'unanswered') {
      return outcome === 'unanswered';
    }
    if (activeFilter.value === 'answered') {
      return outcome !== 'unanswered';
    }
    return true;
  });
});
const questionSections = computed(() => {
  const sections = [];
  const sectionMap = new Map();

  filteredQuestions.value.forEach((question) => {
    const sectionKey = String(question.partCode || question.partName || 'general').trim().toLowerCase() || 'general';
    const sectionLabel = [question.partCode, question.partName].filter(Boolean).join(' · ') || 'All Questions';
    const section = sectionMap.get(sectionKey) || {
      key: sectionKey,
      label: sectionLabel,
      questions: [],
      total: 0,
      answered: 0,
      incorrect: 0,
      unanswered: 0,
      needsReview: 0,
    };

    section.questions.push(question);
    section.total += 1;

    const outcome = getQuestionOutcome(question);
    if (outcome === 'unanswered') {
      section.unanswered += 1;
    } else {
      section.answered += 1;
    }
    if (outcome === 'incorrect') {
      section.incorrect += 1;
    }
    if (isReviewRequired(question)) {
      section.needsReview += 1;
    }

    if (!sectionMap.has(sectionKey)) {
      sectionMap.set(sectionKey, section);
      sections.push(section);
    }
  });

  return sections;
});
const knowledgeBreakdown = computed(() => {
  const skillMap = new Map();
  let unlabeledTotal = 0;
  let unlabeledIncorrect = 0;

  questions.value.forEach((question) => {
    const tag = questionShsatSkillTag(question);
    const outcome = getQuestionOutcome(question);

    if (!tag.skillCode) {
      unlabeledTotal += 1;
      if (outcome === 'incorrect' || outcome === 'unanswered') {
        unlabeledIncorrect += 1;
      }
      return;
    }

    const { subject, domain, skill } = shsatSkillTagByCode(tag.skillCode);
    const existing = skillMap.get(tag.skillCode) || {
      key: tag.skillCode,
      subjectCode: subject?.code || tag.subjectCode,
      subjectName: subject?.name || tag.subjectCode,
      domainCode: domain?.code || tag.domainCode,
      domainName: domain?.name || '',
      skillName: skill?.name || shsatSkillTagLabel(tag),
      label: shsatSkillTagLabel(tag),
      total: 0,
      correct: 0,
      incorrect: 0,
      unanswered: 0,
      questions: [],
    };

    existing.total += 1;
    existing.questions.push(question);
    if (outcome === 'correct') {
      existing.correct += 1;
    } else if (outcome === 'unanswered') {
      existing.unanswered += 1;
    } else {
      existing.incorrect += 1;
    }
    skillMap.set(tag.skillCode, existing);
  });

  const skillStats = [...skillMap.values()]
    .map((item) => ({
      ...item,
      accuracy: item.total > 0 ? (item.correct / item.total) * 100 : null,
      needsAttention: item.incorrect + item.unanswered,
      limitedSample: item.total < 2,
    }))
    .sort((left, right) => {
      const subjectDiff = String(left.subjectName || '').localeCompare(String(right.subjectName || ''));
      if (subjectDiff !== 0) {
        return subjectDiff;
      }
      const domainDiff = String(left.domainName || '').localeCompare(String(right.domainName || ''));
      if (domainDiff !== 0) {
        return domainDiff;
      }
      return String(left.skillName || '').localeCompare(String(right.skillName || ''));
    });
  const hierarchyRows = buildKnowledgeHierarchyRows(skillStats);
  const visibleRows = hierarchyRows.filter((row) => row.total > 0);

  const rankedSkills = visibleRows.filter((skill) => !skill.limitedSample);
  const strongest = [...rankedSkills]
    .sort((left, right) => {
      const accuracyDiff = Number(right.accuracy ?? -1) - Number(left.accuracy ?? -1);
      if (accuracyDiff !== 0) {
        return accuracyDiff;
      }
      return right.total - left.total;
    })
    .slice(0, 3);
  const weakest = rankedSkills
    .filter((skill) => skill.needsAttention > 0)
    .slice(0, 3);

  return {
    skills: visibleRows,
    hierarchicalRows: hierarchyRows,
    subjectSummaries: buildKnowledgeSubjectSummaries(hierarchyRows),
    skillAreaCount: visibleRows.length,
    strongest,
    weakest,
    unlabeledTotal,
    unlabeledIncorrect,
    hasTaggedQuestions: skillStats.length > 0,
  };
});

function buildKnowledgeSubjectSummaries(rows) {
  return SHSAT_SKILL_TAGS.map((subject) => {
    const subjectRows = rows.filter((row) => row.subjectCode === subject.code);
    const total = subjectRows.reduce((sum, row) => sum + row.total, 0);
    const correct = subjectRows.reduce((sum, row) => sum + row.correct, 0);
    const skillAreas = subjectRows
      .filter((row) => row.total > 0)
      .map((row) => {
        const questionNumbers = row.questions
          .map((question) => question.questionNumber)
          .filter((questionNumber) => questionNumber !== null && questionNumber !== undefined)
          .sort((left, right) => Number(left) - Number(right));
        const questionTypeLabels = [
          ...new Set(row.questions.map((question) => formatQuestionTypeLabel(question.questionType))),
        ].filter(Boolean);

        return {
          key: row.key,
          name: row.skillName || row.label,
          domainName: row.domainName,
          total: row.total,
          correct: row.correct,
          incorrect: row.incorrect,
          unanswered: row.unanswered,
          accuracy: row.accuracy,
          filledSegments: performanceSegments(row.accuracy, row.total),
          questionNumbers,
          questionLabel: formatKnowledgeQuestionNumbers(questionNumbers),
          detailLabel: formatKnowledgeSkillDetail(questionTypeLabels, row.total, row.correct),
        };
      });

    return {
      key: subject.code,
      name: subject.code === 'MATH' ? 'Math' : 'Reading and Writing',
      total,
      correct,
      accuracy: total > 0 ? (correct / total) * 100 : null,
      skillAreas,
    };
  });
}

function performanceSegments(accuracy, total) {
  if (!total || !Number.isFinite(Number(accuracy))) {
    return 0;
  }
  if (Number(accuracy) <= 0) {
    return 0;
  }
  return Math.max(1, Math.min(8, Math.round((Number(accuracy) / 100) * 8)));
}

function buildKnowledgeHierarchyRows(skillStats) {
  const statMap = new Map(skillStats.map((item) => [item.key, item]));
  const rows = [];

  SHSAT_SKILL_TAGS.forEach((subject) => {
    const subjectRowStart = rows.length;

    subject.domains.forEach((domain) => {
      const domainRowStart = rows.length;

      domain.skills.forEach((skill) => {
        const stat = statMap.get(skill.code);
        const total = stat?.total || 0;
        const correct = stat?.correct || 0;
        const incorrect = stat?.incorrect || 0;
        const unanswered = stat?.unanswered || 0;
        rows.push({
          key: skill.code,
          subjectCode: subject.code,
          subjectName: subject.name,
          domainCode: domain.code,
          domainName: domain.name,
          skillName: skill.name,
          label: `${domain.name} · ${skill.name}`,
          total,
          correct,
          incorrect,
          unanswered,
          accuracy: total > 0 ? (correct / total) * 100 : null,
          needsAttention: incorrect + unanswered,
          limitedSample: total > 0 && total < 2,
          questions: stat?.questions || [],
          showSubject: false,
          subjectRowspan: 0,
          showDomain: false,
          domainRowspan: 0,
        });
      });

      if (rows[domainRowStart]) {
        rows[domainRowStart].showDomain = true;
        rows[domainRowStart].domainRowspan = domain.skills.length;
      }
    });

    if (rows[subjectRowStart]) {
      rows[subjectRowStart].showSubject = true;
      rows[subjectRowStart].subjectRowspan = subject.domains.reduce((sum, domain) => sum + domain.skills.length, 0);
    }
  });

  return rows;
}
const timeAnalysis = computed(() => {
  const sectionTimes = buildSectionTimeStats();
  // 报告总答题用时按两科题目计时求和，不使用提交时间减开始时间的墙钟跨度。
  const totalTime = sectionTimes.reduce((sum, sectionTime) => sum + (sectionTime.totalSeconds || 0), 0);
  const answeredCount = answeredQuestionCount.value;
  const totalCount = questions.value.length || 0;
  const hasQuestionTime = totalTime > 0;

  return {
    totalTime: hasQuestionTime ? totalTime : null,
    averageAnswered: hasQuestionTime && answeredCount > 0 ? totalTime / answeredCount : null,
    averageAll: hasQuestionTime && totalCount > 0 ? totalTime / totalCount : null,
    sectionTimes,
  };
});
const summaryHighlights = computed(() => {
  if (!report.value) {
    return [];
  }

  const cards = [];

  if (report.value.scoreVisible) {
    if (isQuestionSetReport.value) {
      cards.push({
        key: 'practice-result',
        label: 'Correct / Total',
        value: `${report.value.correctCount ?? 0} / ${questions.value.length}`,
        meta: 'Questions in this review task',
        tone: 'primary',
      });
    } else {
      cards.push({
        key: 'raw-total',
        label: 'Raw Total',
        value: formatRawTotalScore(report.value),
        meta: scoringStatusText.value,
        tone: 'primary',
        group: 'raw',
      });
      cards.push({
        key: 'ela',
        label: 'ELA Raw',
        value: formatRawSectionScore(report.value.elaRawScore ?? report.value.section1Score, rawSectionMaxima.value.ela),
        meta: formatRawSectionMeta(rawSectionMaxima.value.ela),
        group: 'raw',
      });
      cards.push({
        key: 'math',
        label: 'Math Raw',
        value: formatRawSectionScore(report.value.mathRawScore ?? report.value.section2Score, rawSectionMaxima.value.math),
        meta: formatRawSectionMeta(rawSectionMaxima.value.math),
        group: 'raw',
      });
      if (hasScaledScoring(report.value)) {
        cards.push({
          key: 'composite',
          label: 'Composite Score',
          value: formatCompositeScore(report.value),
          meta: formatScaledBreakdown(report.value),
          tone: 'danger',
          group: 'scaled',
        });
      }
    }
    cards.push({
      key: 'accuracy',
      label: 'Accuracy',
      value: formatPercent(report.value.accuracy),
      meta: `${report.value.correctCount ?? 'Not returned'} correct`,
      group: 'detail',
    });
    if (!isQuestionSetReport.value) {
      cards.push({
        key: 'correct',
        label: 'Correct',
        value: report.value.correctCount ?? '-',
        group: 'detail',
      });
    }
    cards.push({
      key: 'wrong',
      label: 'Wrong',
      value: report.value.wrongCount ?? '-',
      group: 'detail',
    });
    cards.push({
      key: 'unanswered',
      label: 'Unanswered',
      value: report.value.unansweredCount ?? '-',
      group: 'detail',
    });
    cards.push({
      key: 'completion',
      label: 'Completion',
      value: formatPercent(report.value.completionRate),
      group: 'detail',
    });
    cards.push({
      key: 'time',
      label: 'Time Used',
      value: formatDuration(report.value.timeUsed),
      group: 'detail',
    });
    cards.push({
      key: 'focusViolations',
      label: 'Left Exam Page',
      value: report.value.focusViolationCount ?? 0,
      meta: 'Times the exam page was left during the attempt',
      group: 'detail',
    });
    cards.push({
      key: 'submitted',
      label: 'Submitted',
      value: formatDateTime(report.value.submittedAt),
      group: 'detail',
    });
  } else {
    cards.push(
      {
        key: 'answered',
        label: 'Answered',
        value: `${answeredQuestionCount.value} / ${questions.value.length || 0}`,
        meta: `${report.value.unansweredCount ?? Math.max((questions.value.length || 0) - answeredQuestionCount.value, 0)} unanswered`,
        tone: 'primary',
      },
      {
        key: 'completion',
        label: 'Completion',
        value: formatPercent(report.value.completionRate),
        meta: 'Based on submitted answers',
      },
      {
        key: 'time',
        label: 'Time Used',
        value: formatDuration(report.value.timeUsed),
        meta: 'Recorded for this attempt',
      },
      {
        key: 'submitted',
        label: 'Submitted At',
        value: formatDateTime(report.value.submittedAt),
        meta: 'Local browser time',
      }
    );
  }

  return cards;
});
const detailStats = computed(() => {
  if (!report.value) {
    return [];
  }

  const stats = [];

  if (report.value.scoreVisible) {
    if (isQuestionSetReport.value) {
      stats.push(
        { label: 'Questions', value: questions.value.length },
        { label: 'Correct', value: report.value.correctCount ?? 'Not returned' },
        { label: 'Wrong', value: report.value.wrongCount ?? 'Not returned' },
        { label: 'Unanswered', value: report.value.unansweredCount ?? 'Not returned' },
        { label: 'Accuracy', value: formatPercent(report.value.accuracy) },
        { label: 'Time Used', value: formatDuration(report.value.timeUsed) }
      );
    } else {
      stats.push(
        { label: 'Correct', value: report.value.correctCount ?? 'Not returned' },
        { label: 'Wrong', value: report.value.wrongCount ?? 'Not returned' },
        { label: 'Unanswered', value: report.value.unansweredCount ?? 'Not returned' },
        { label: 'Completion', value: formatPercent(report.value.completionRate) },
        { label: 'Time Used', value: formatDuration(report.value.timeUsed) }
      );
    }
  } else {
    stats.push(
      { label: 'Questions', value: questions.value.length || 0 },
      { label: 'Time Used', value: formatDuration(report.value.timeUsed) }
    );
  }

  stats.push({ label: 'Submitted At', value: formatDateTime(report.value.submittedAt) });

  return stats;
});
const visibilityNotes = computed(() => {
  const notes = [];

  if (!report.value) {
    return notes;
  }

  if (!report.value.scoreVisible) {
    notes.push('Scores and detailed correctness are hidden by the current visibility policy.');
  } else if (scoringStatusText.value) {
    notes.push(scoringStatusText.value);
  }

  if (!report.value.answersVisible) {
    notes.push('Detailed correctness status is hidden, but correct answers are listed for review.');
  }

  return notes;
});
const scoringStatusText = computed(() => {
  if (!report.value?.scoreVisible) {
    return '';
  }

  if (isRawOnly(report.value)) {
    return 'Raw-only scoring: scaled scores and composite score are not available.';
  }

  if (report.value?.estimated) {
    return 'Estimated SHSAT scale: scaled scores and composite score are estimates.';
  }

  if (report.value?.scoringMode === 'SHSAT_SCALE_TABLE') {
    return 'Official scale table scoring.';
  }

  return 'Scoring mode was not returned.';
});

function unwrapResponse(response, fallbackMessage) {
  if (response?.success === false) {
    throw new Error(response.message || fallbackMessage);
  }

  return response?.data ?? response;
}

function getQueryStringValue(value) {
  return typeof value === 'string' ? value : '';
}

function isAdminRouteContext() {
  return getQueryStringValue(route.query.adminReport) === '1'
    || getQueryStringValue(route.query.reportContext).toLowerCase() === 'admin'
    || getQueryStringValue(route.query.source).toLowerCase() === 'admin'
    || getQueryStringValue(route.query.returnTo).startsWith('/admin');
}

function getReportApi() {
  return useAdminReportApi.value ? adminApi : studentApi;
}

async function loadReport() {
  loading.value = true;
  errorMessage.value = '';

  try {
    report.value = unwrapResponse(
      await getReportApi().getAttemptResult(attemptId.value),
      'Failed to load attempt report'
    );
    normalizeFilterSelection();
  } catch (error) {
    errorMessage.value = error.message || 'Failed to load attempt report. Please try again later.';
  } finally {
    loading.value = false;
  }
}

function isAdmin() {
  return ['ADMIN', 'TEACHER'].includes(authState.user?.roleCode);
}

function goBack() {
  if (returnTo.value) {
    router.push(returnTo.value);
    return;
  }

  router.push(isAdmin() ? { name: 'shsat-admin' } : { name: 'exam-type', params: { code: 'SHSAT' } });
}

function openExamMonitor() {
  if (!report.value?.examId) {
    return;
  }
  router.push({
    name: 'admin-exam-monitor',
    params: { examId: report.value.examId },
    query: { attemptId: report.value.attemptId || attemptId.value },
  });
}

function printReport() {
  window.print();
}

function reviewQuestion(question) {
  if (!report.value?.examId || question.questionNumber === null || question.questionNumber === undefined) {
    return;
  }

  router.push({
    name: 'student-exam',
    params: { examId: report.value.examId },
    query: {
      review: '1',
      attemptId: report.value.attemptId,
      questionNumber: question.questionNumber,
      fromReport: '1',
      adminReport: useAdminReportApi.value ? '1' : undefined,
      returnTo: route.fullPath,
    },
  });
}

function formatDateTime(value) {
  if (!value) {
    return 'Not returned';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) {
    return 'Not returned';
  }

  const totalSeconds = Math.max(Number(seconds), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const restSeconds = totalSeconds % 60;
  return `${minutes} min ${restSeconds} sec`;
}

function formatCompactDuration(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) {
    return 'Not available';
  }

  const totalSeconds = Math.max(Math.round(Number(seconds)), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const restSeconds = totalSeconds % 60;
  if (minutes <= 0) {
    return `${restSeconds} sec`;
  }
  return restSeconds > 0 ? `${minutes}m ${restSeconds}s` : `${minutes}m`;
}

function formatTimeAnalysisDuration(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) {
    return '-';
  }
  return formatDuration(seconds);
}

function formatTimeAnalysisCompactDuration(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) {
    return '-';
  }
  return formatCompactDuration(seconds);
}

function buildSectionTimeStats() {
  return ['ELA', 'MATH'].map((sectionCode) => {
    const sectionQuestions = questions.value.filter((question) => normalizeSectionCode(question) === sectionCode);
    const answered = sectionQuestions.filter(hasSubmittedAnswer);
    const totalSeconds = answered.reduce((sum, question) => {
      const seconds = Number(question.timeSpent);
      return Number.isFinite(seconds) && seconds > 0 ? sum + seconds : sum;
    }, 0);

    return {
      key: sectionCode,
      label: sectionCode === 'MATH' ? 'Math Time' : 'ELA Time',
      totalSeconds: totalSeconds > 0 ? totalSeconds : null,
      answeredCount: answered.length,
      averageSeconds: totalSeconds > 0 && answered.length > 0 ? totalSeconds / answered.length : null,
    };
  });
}

function normalizeSectionCode(question) {
  const normalized = String(question?.partCode || question?.partName || '').trim().toUpperCase();
  if (normalized.includes('MATH')) {
    return 'MATH';
  }
  if (normalized.includes('ELA') || normalized.includes('ENGLISH') || normalized.includes('READ')) {
    return 'ELA';
  }
  return normalized;
}

function formatPercent(value) {
  if (value === null || value === undefined) {
    return 'Not available yet';
  }

  return `${Number(value).toFixed(2)}%`;
}

function formatWholePercent(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return 'Not available';
  }

  return `${Math.round(Number(value))}%`;
}

function formatKnowledgeSkillDetail(questionTypeLabels, total, correct) {
  const typeLabel = questionTypeLabels.length ? questionTypeLabels.join(', ') : '';
  const countLabel = `${total} ${total === 1 ? 'question' : 'questions'}, ${correct} correct`;
  return typeLabel ? `${typeLabel} · ${countLabel}` : countLabel;
}

function formatKnowledgeQuestionNumbers(questionNumbers) {
  if (!questionNumbers.length) {
    return '';
  }
  return questionNumbers.map((questionNumber) => `Q${questionNumber}`).join(', ');
}

function questionShsatSkillTag(question) {
  const config = parseJson(question?.questionConfig, {});
  return normalizeShsatSkillTag(question?.shsatSkillTag || extractShsatSkillTag(config));
}

function formatScore(value) {
  if (value === null || value === undefined) {
    return 'Not available yet';
  }

  return Number(value).toString();
}

function formatScoreWithMax(value, maxScore) {
  if (value === null || value === undefined) {
    return 'Not available yet';
  }

  return `${formatScore(value)} / ${formatScore(maxScore)}`;
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatRawSectionScore(value, maxScore) {
  return maxScore === null ? formatScore(value) : formatScoreWithMax(value, maxScore);
}

function formatRawSectionMeta(maxScore) {
  return maxScore === null ? 'Raw score' : `${maxScore} scored questions`;
}

function formatRawTotalScore(reportData) {
  return formatRawSectionScore(reportData?.rawTotalScore ?? reportData?.totalScore, rawTotalMaxScore.value);
}

function formatCompositeScore(reportData) {
  const score = reportData?.compositeScore ?? reportData?.totalScaledScore;
  const maxScore = reportData?.compositeMaxScore;
  if (score === null || score === undefined) {
    return 'Not available yet';
  }

  return maxScore ? `${formatScore(score)} / ${formatScore(maxScore)}` : formatScore(score);
}

function formatScaledBreakdown(reportData) {
  const elaScaled = reportData?.elaScaledScore ?? reportData?.section1ScaledScore;
  const mathScaled = reportData?.mathScaledScore ?? reportData?.section2ScaledScore;
  return `ELA scaled ${formatScore(elaScaled)} · Math scaled ${formatScore(mathScaled)}`;
}

function isRawOnly(reportData) {
  return reportData?.scoringMode === 'RAW_ONLY';
}

function hasScaledScoring(reportData) {
  return !isRawOnly(reportData) && (reportData?.compositeScore ?? reportData?.totalScaledScore) !== null
    && (reportData?.compositeScore ?? reportData?.totalScaledScore) !== undefined;
}

function formatAnswer(value) {
  return formatAnswerValue(value, 'Not answered');
}

function hasMeaningfulAnswer(value) {
  if (value === null || value === undefined) {
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

function formatSubmittedAnswer(question) {
  const definition = getQuestionTypeDefinition(question.questionType);
  if (typeof definition.formatReportAnswer === 'function') {
    return definition.formatReportAnswer({
      question,
      answerData: question.answerData,
      selectedAnswer: question.selectedAnswer,
      emptyText: 'Not answered',
    });
  }

  return formatAnswer(question.selectedAnswer);
}

function getReportAnswerComponent(question) {
  return getQuestionTypeDefinition(question?.questionType).components?.report || null;
}

function isImageMaterial(question) {
  return Boolean(question?.assetUrl);
}

function getCorrectReportAnswerData(question) {
  return hasMeaningfulCorrectAnswer(question?.correctAnswerData)
    ? question.correctAnswerData
    : question?.correctAnswer;
}

function formatCorrectAnswer(question) {
  if (!hasCorrectAnswer(question)) {
    return EMPTY_CORRECT_ANSWER_TEXT;
  }

  if (isFillInBlankQuestion(question)) {
    return formatFillBlankCorrectAnswer(question);
  }

  const definition = getQuestionTypeDefinition(question.questionType);
  const answerData = hasMeaningfulCorrectAnswer(question.correctAnswerData)
    ? question.correctAnswerData
    : question.correctAnswer;
  let formattedAnswer = '';
  if (typeof definition.formatReportAnswer === 'function') {
    formattedAnswer = definition.formatReportAnswer({
      question,
      answerData,
      selectedAnswer: question.correctAnswer,
      emptyText: EMPTY_CORRECT_ANSWER_TEXT,
    });
  } else {
    formattedAnswer = question.correctAnswer || EMPTY_CORRECT_ANSWER_TEXT;
  }

  return normalizeCorrectAnswerDisplay(formattedAnswer);
}

function isFillInBlankQuestion(question) {
  return normalizeQuestionType(question?.questionType, '') === 'FILL_IN_BLANK';
}

function formatFillBlankCorrectAnswer(question) {
  const answers = fillBlankAcceptedAnswers(question);
  return answers.length > 0 ? answers.join(', ') : EMPTY_CORRECT_ANSWER_TEXT;
}

function fillBlankAcceptedAnswers(question) {
  const acceptedAnswers = [];
  const addAnswer = (value) => {
    const answer = String(value ?? '').trim();
    if (answer && !acceptedAnswers.includes(answer)) {
      acceptedAnswers.push(answer);
    }
  };

  const parsedData = parseJson(question?.correctAnswerData, question?.correctAnswerData);
  if (Array.isArray(parsedData)) {
    parsedData.forEach(addAnswer);
  } else if (parsedData && typeof parsedData === 'object') {
    if (Array.isArray(parsedData.answers)) {
      parsedData.answers.forEach(addAnswer);
    } else if (parsedData.value !== undefined) {
      addAnswer(parsedData.value);
    }
  } else {
    addAnswer(parsedData);
  }

  if (acceptedAnswers.length === 0) {
    String(question?.correctAnswer ?? '')
      .split(/[;,|]/)
      .forEach(addAnswer);
  }

  return acceptedAnswers;
}

function hasCorrectAnswer(question) {
  return hasMeaningfulCorrectAnswer(question?.correctAnswerData)
    || hasMeaningfulCorrectAnswer(question?.correctAnswer);
}

function hasMeaningfulCorrectAnswer(value) {
  if (isEmptyCorrectAnswerText(value)) {
    return false;
  }
  return hasMeaningfulAnswer(value);
}

function normalizeCorrectAnswerDisplay(value) {
  if (isEmptyCorrectAnswerText(value)) {
    return EMPTY_CORRECT_ANSWER_TEXT;
  }

  const text = String(value ?? '').trim();
  return text || EMPTY_CORRECT_ANSWER_TEXT;
}

function isEmptyCorrectAnswerText(value) {
  const text = String(value ?? '').trim();
  return !text
    || text === 'Not returned'
    || text === 'Not answered'
    || text === 'answers=[]'
    || /^answers\s*[:=]\s*\[\s*\]$/i.test(text);
}

function getQuestionStatus(question) {
  const outcome = getQuestionOutcome(question);

  if (outcome === 'correct') {
    return 'Correct';
  }

  if (outcome === 'incorrect') {
    return 'Needs Review';
  }

  if (outcome === 'unanswered') {
    return 'Unanswered';
  }

  return 'Answered';
}

function isReviewRequired(question) {
  const outcome = getQuestionOutcome(question);
  return outcome === 'incorrect' || outcome === 'unanswered';
}

function getQuestionOutcome(question) {
  if (!hasSubmittedAnswer(question)) {
    return 'unanswered';
  }

  if (question.correct === true) {
    return 'correct';
  }

  if (question.correct === false) {
    return 'incorrect';
  }

  return 'answered';
}

function normalizeFilterSelection() {
  if (!questionFilters.value.some((filter) => filter.key === activeFilter.value)) {
    activeFilter.value = 'all';
  }
}

function prettifyQuestionTypeLabel(questionType) {
  return String(questionType || '')
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function formatQuestionTypeLabel(questionType) {
  const definition = getQuestionTypeDefinition(questionType);
  const label = String(definition?.label || questionType || '').trim();
  if (!label) {
    return 'Question';
  }
  return /^[A-Z0-9_]+$/.test(label) ? prettifyQuestionTypeLabel(label) : label;
}

function formatAnswerValue(value, emptyText = 'Not answered') {
  if (value === null || value === undefined || value === '') {
    return emptyText;
  }

  return formatParsedAnswerValue(parseJson(value, value), emptyText);
}

function formatParsedAnswerValue(value, emptyText = 'Not answered') {
  if (value === null || value === undefined || value === '') {
    return emptyText;
  }

  if (typeof value === 'string') {
    return value.trim() || emptyText;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const items = value
      .map((item) => formatParsedAnswerValue(item, ''))
      .filter(Boolean);
    return items.length > 0 ? items.join(', ') : emptyText;
  }

  if (value && typeof value === 'object') {
    for (const key of ['value', 'text', 'expression']) {
      if (key in value) {
        return formatParsedAnswerValue(value[key], emptyText);
      }
    }

    for (const key of ['answers', 'selectedAnswers', 'values', 'points']) {
      if (Array.isArray(value[key])) {
        return formatParsedAnswerValue(value[key], emptyText);
      }
    }

    const entries = Object.entries(value)
      .filter(([, entryValue]) => entryValue !== null && entryValue !== undefined && entryValue !== '')
      .map(([key, entryValue]) => `${prettifyQuestionTypeLabel(key)}: ${formatParsedAnswerValue(entryValue, '-')}`);

    return entries.length > 0 ? entries.join(' · ') : emptyText;
  }

  return String(value);
}

function questionSetGroups(questionList) {
  const groups = [];

  questionList.forEach((question) => {
    const key = questionSetKey(question);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = {
        key,
        label: questionSetLabel(question),
        questions: [],
        answered: 0,
        incorrect: 0,
        unanswered: 0,
        needsReview: 0,
      };
      groups.push(group);
    }

    group.questions.push(question);
    const outcome = getQuestionOutcome(question);
    if (outcome === 'unanswered') {
      group.unanswered += 1;
    } else {
      group.answered += 1;
    }
    if (outcome === 'incorrect') {
      group.incorrect += 1;
    }
    if (isReviewRequired(question)) {
      group.needsReview += 1;
    }
  });

  return groups;
}

function questionSetKey(question) {
  const section = question.partCode || question.partName || 'general';
  if (question.materialId) {
    return `${section}:material:${question.materialId}`;
  }
  return `${section}:subtype:${question.subTypeId || question.subTypeName || question.questionType || 'general'}`;
}

function questionSetLabel(question) {
  if (question.materialId) {
    const category = String(question.materialCategory || '').trim();
    return category ? `${category} Set` : 'Passage Set';
  }
  return question.subTypeName || formatQuestionTypeLabel(question.questionType);
}

function questionRangeLabel(questionList) {
  const numbers = questionList
    .map((question) => Number(question.questionNumber))
    .filter((number) => Number.isFinite(number))
    .sort((left, right) => left - right);
  if (numbers.length === 0) {
    return 'No question numbers';
  }
  const first = numbers[0];
  const last = numbers[numbers.length - 1];
  return first === last ? `Question ${first}` : `Questions ${first}-${last}`;
}

onMounted(loadReport);
</script>

<template>
  <AdminLayout>
    <section class="page-shell attempt-report">
      <div class="attempt-report__hero">
          <div class="attempt-report__hero-copy">
          <p class="attempt-report__eyebrow">
            Attempt Report
            <span v-if="isReviewReport" class="attempt-report__practice-badge">Review</span>
            <span v-else-if="isPracticeReport" class="attempt-report__practice-badge">Practice</span>
          </p>
          <h1 class="page-title attempt-report__title">
            <span>Student:</span> <strong>{{ reportStudentName }}</strong>
          </h1>
          <div class="attempt-report__exam-context">
            <p><span>Exam</span><strong>{{ report?.examTitle || 'Unavailable' }}</strong></p>
            <p><span>Paper</span><strong>{{ report?.paperName || (report?.paperId ? `Paper #${report.paperId}` : 'Unavailable') }}</strong></p>
          </div>
            <p class="page-subtitle">
              Review your score, timing, and question-by-question performance.
            </p>
        </div>
        <div class="attempt-report__actions report-print-hidden">
            <button
              class="icon-refresh-button"
              :class="{ 'icon-refresh-button--loading': loading }"
              type="button"
              :disabled="loading"
              aria-label="Refresh report"
              title="Refresh report"
              @click="loadReport"
            >
              <svg class="icon-refresh-button__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M12 5a7 7 0 0 0-6.32 4H3.5A9 9 0 0 1 19 6.64V4h2v6h-6V8h2.7A6.98 6.98 0 0 0 12 5Zm6.32 10H20.5A9 9 0 0 1 5 17.36V20H3v-6h6v2H6.3A6.98 6.98 0 0 0 12 19a7 7 0 0 0 6.32-4Z" />
              </svg>
            </button>
          <AppButton variant="secondary" :disabled="loading || !report" @click="printReport">Print Report</AppButton>
          <AppButton v-if="isAdmin() && report?.examId" variant="secondary" @click="openExamMonitor">Monitor</AppButton>
          <AppButton variant="ghost" @click="goBack">{{ returnLabel }}</AppButton>
        </div>
      </div>

      <AppCard v-if="loading" title="Loading Report">
        <div class="attempt-report__state">
          <span class="attempt-report__spinner" aria-hidden="true"></span>
          <p class="status-note">Loading attempt report...</p>
        </div>
      </AppCard>

      <AppCard v-else-if="errorMessage" title="Unable to Load Report">
        <div class="attempt-report__state attempt-report__state--error">
          <p class="error-text">{{ errorMessage }}</p>
          <AppButton variant="secondary" @click="loadReport">Retry</AppButton>
        </div>
      </AppCard>

      <template v-else-if="report">
          <AppCard class="result-summary-card" title="Result Summary">
            <div class="summary-fields">
              <div v-for="card in summaryHighlights" :key="card.key" class="summary-field">
                <span class="summary-field__label">{{ card.label }}</span>
                <span class="summary-field__value">{{ card.value }}</span>
              </div>
            </div>
        </AppCard>

          <AppCard class="knowledge-card">
            <div v-if="!report.scoreVisible" class="analysis-empty">
              Knowledge breakdown is hidden because score visibility is disabled for this attempt.
            </div>
            <div v-else-if="!knowledgeBreakdown.hasTaggedQuestions" class="analysis-empty">
              No tagged questions were found for this attempt yet.
            </div>
            <div v-else class="knowledge-analysis">
              <header class="knowledge-analysis__header">
                <div>
                  <h2>Knowledge and Skills</h2>
                  <p>Performance across tagged SHSAT content domains and question types.</p>
                </div>
                <span>{{ knowledgeBreakdown.skillAreaCount }} skill areas</span>
              </header>

              <div class="knowledge-score-grid">
                <section
                  v-for="subject in knowledgeBreakdown.subjectSummaries"
                  :key="subject.key"
                  class="knowledge-score-subject"
                >
                  <h3>{{ subject.name }}</h3>
                  <div class="knowledge-score-list">
                    <article
                      v-for="skillArea in subject.skillAreas"
                      :key="skillArea.key"
                      class="knowledge-score-item"
                    >
                      <div class="knowledge-score-item__header">
                        <strong>{{ skillArea.name }}</strong>
                        <span>{{ formatWholePercent(skillArea.accuracy) }}</span>
                      </div>
                      <p class="knowledge-score-item__detail">{{ skillArea.detailLabel }}</p>
                      <div class="knowledge-segment-bar" aria-hidden="true">
                        <span
                          v-for="segment in 8"
                          :key="segment"
                          :class="{ 'knowledge-segment-bar__segment--filled': segment <= skillArea.filledSegments }"
                          class="knowledge-segment-bar__segment"
                        ></span>
                      </div>
                      <div class="knowledge-score-item__footer">
                        <span>{{ skillArea.incorrect }} wrong, {{ skillArea.unanswered }} unanswered</span>
                        <span :title="skillArea.questionLabel">{{ skillArea.questionLabel }}</span>
                      </div>
                    </article>
                  </div>
                </section>
              </div>

              <p v-if="knowledgeBreakdown.unlabeledTotal > 0" class="analysis-muted">
                {{ knowledgeBreakdown.unlabeledTotal }} questions do not have a knowledge tag yet.
              </p>
            </div>
          </AppCard>

          <AppCard title="Time Analysis" subtitle="Review overall pacing for this attempt.">
            <div class="time-analysis-grid">
              <article class="time-analysis-card">
                <p>Total Time</p>
                <strong>{{ formatTimeAnalysisDuration(timeAnalysis.totalTime) }}</strong>
              </article>
              <article
                v-for="sectionTime in timeAnalysis.sectionTimes"
                :key="sectionTime.key"
                class="time-analysis-card"
              >
                <p>{{ sectionTime.label }}</p>
                <strong>{{ formatTimeAnalysisDuration(sectionTime.totalSeconds) }}</strong>
                <span>{{ sectionTime.answeredCount }} answered · avg {{ formatTimeAnalysisCompactDuration(sectionTime.averageSeconds) }}</span>
              </article>
              <article class="time-analysis-card">
                <p>Average per Answered Question</p>
                <strong>{{ formatTimeAnalysisCompactDuration(timeAnalysis.averageAnswered) }}</strong>
              </article>
            </div>
            <p class="analysis-muted">
              Average across all questions: {{ formatTimeAnalysisCompactDuration(timeAnalysis.averageAll) }}.
            </p>
          </AppCard>

          <AppCard title="Question Review" subtitle="Use filters to focus on unanswered or missed questions, then jump back into review mode.">
            <div class="review-toolbar">
              <div class="review-filters">
                <button
                  v-for="filter in questionFilters"
                  :key="filter.key"
                  class="review-filter"
                  :class="{ 'review-filter--active': activeFilter === filter.key }"
                  type="button"
                  @click="activeFilter = filter.key"
                >
                  <span>{{ filter.label }}</span>
                  <strong>{{ filter.count }}</strong>
                </button>
              </div>
              <p class="review-toolbar__summary">
                Showing {{ filteredQuestions.length }} of {{ questions.length }} questions.
              </p>
          </div>

            <div v-if="questionSections.length" class="question-sections">
              <section v-for="section in questionSections" :key="section.key" class="question-section">
                <div class="question-section__header">
                  <div>
                    <h3 class="question-section__title">{{ section.label }}</h3>
                    <p class="question-section__subtitle">
                      {{ section.answered }} answered · {{ section.unanswered }} unanswered
                      <span v-if="report.answersVisible"> · {{ section.needsReview }} to review</span>
                    </p>
                  </div>
                  <span class="question-section__count">{{ section.total }} questions</span>
                </div>

                <div class="question-set-list">
                  <article v-for="set in questionSetGroups(section.questions)" :key="set.key" class="question-set-card">
                    <header class="question-set-card__header">
                      <div>
                        <h4>{{ set.label }}</h4>
                        <p>
                          {{ questionRangeLabel(set.questions) }} · {{ set.answered }} answered · {{ set.unanswered }} unanswered
                          <span v-if="report.answersVisible"> · {{ set.needsReview }} to review</span>
                        </p>
                      </div>
                      <span class="question-set-card__count">{{ set.questions.length }} questions</span>
                    </header>

                    <div class="question-table-wrap">
                      <table class="question-table question-table--compact">
                        <thead>
                          <tr>
                            <th>Question</th>
                            <th>Type</th>
                            <th>Your Answer</th>
                            <th>Correct Answer</th>
                            <th>Status</th>
                            <th v-if="report.scoreVisible">Score</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr
                            v-for="question in set.questions"
                            :key="question.questionNumber"
                            :class="{
                              'question-row--wrong': getQuestionOutcome(question) === 'incorrect',
                              'question-row--unanswered': getQuestionOutcome(question) === 'unanswered',
                            }"
                          >
                            <td class="question-table__question">
                              <button class="question-link" type="button" @click="reviewQuestion(question)">
                                Question {{ question.questionNumber }}
                              </button>
                              <img
                                v-if="isImageMaterial(question)"
                                class="question-preview__image"
                                :src="question.assetUrl"
                                alt="Question material image"
                                loading="lazy"
                              />
                            </td>
                            <td>
                              <span class="type-pill">{{ formatQuestionTypeLabel(question.questionType) }}</span>
                            </td>
                            <td class="question-table__answer">
                              <span v-if="!hasSubmittedAnswer(question)" class="answer-placeholder">Not answered</span>
                              <component
                                :is="getReportAnswerComponent(question)"
                                v-else-if="getReportAnswerComponent(question)"
                                class="question-table__answer-component"
                                :question="question"
                                :answer-data="question.answerData"
                                :selected-answer="question.selectedAnswer"
                                empty-text="Not answered"
                              />
                              <span v-else>{{ formatSubmittedAnswer(question) }}</span>
                            </td>
                            <td class="question-table__answer">
                              <span v-if="!hasCorrectAnswer(question)" class="answer-placeholder">{{ EMPTY_CORRECT_ANSWER_TEXT }}</span>
                              <component
                                :is="getReportAnswerComponent(question)"
                                v-else-if="getReportAnswerComponent(question)"
                                class="question-table__answer-component"
                                :question="question"
                                :answer-data="getCorrectReportAnswerData(question)"
                                :selected-answer="question.correctAnswer"
                                :empty-text="EMPTY_CORRECT_ANSWER_TEXT"
                              />
                              <span v-else>{{ formatCorrectAnswer(question) }}</span>
                            </td>
                            <td>
                              <span
                                class="result-pill"
                                :class="{
                                  'result-pill--correct': getQuestionOutcome(question) === 'correct',
                                  'result-pill--wrong': getQuestionOutcome(question) === 'incorrect',
                                  'result-pill--neutral': getQuestionOutcome(question) === 'unanswered',
                                }"
                              >
                                {{ getQuestionStatus(question) }}
                              </span>
                            </td>
                            <td v-if="report.scoreVisible" class="score-cell">
                              {{ formatScore(question.score) }} / {{ formatScore(question.maxScore) }}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </article>
                </div>
              </section>
            </div>

            <p v-else-if="questions.length === 0" class="status-note">
              No question details were returned for this attempt.
            </p>
            <p v-else class="status-note">
              No questions match the current filter.
          </p>
        </AppCard>
      </template>
    </section>
  </AdminLayout>
</template>

<style scoped>
.attempt-report {
  display: grid;
  gap: 24px;
}

.attempt-report__hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
}

.attempt-report__hero-copy {
  display: grid;
  gap: 8px;
}

.attempt-report__exam-context {
  display: grid;
  gap: 6px;
}

.attempt-report__exam-context p {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  font-size: 17px;
}

.attempt-report__exam-context span {
  min-width: 48px;
  color: var(--color-muted);
  font-weight: 800;
}

.attempt-report__exam-context strong {
  color: var(--color-text);
  font-weight: 800;
}

.attempt-report__title {
  max-width: 760px;
  font-size: 22px;
  font-weight: 800;
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.attempt-report__title span {
  color: var(--color-muted);
}

.attempt-report__title strong {
  color: var(--color-text);
  font-weight: 800;
}

.attempt-report__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 12px;
}

.attempt-report__eyebrow {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 8px;
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.attempt-report__practice-badge {
  border-radius: 999px;
  padding: 4px 8px;
  color: #8a5b00;
  background: #fff4d8;
  font-size: 11px;
  letter-spacing: 0.04em;
}

.report-notes {
  display: grid;
  gap: 8px;
  margin-bottom: 18px;
}

.report-note {
  margin: 0;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.5;
}

.attempt-report__state {
  display: grid;
  justify-items: center;
  gap: 14px;
  padding: 32px;
  text-align: center;
}

.attempt-report__state--error {
  justify-items: start;
  text-align: left;
}

.attempt-report__spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--color-primary-soft);
  border-top-color: var(--color-primary);
  border-radius: 999px;
  animation: spin 800ms linear infinite;
}

.result-summary-card {
  padding: 12px 14px;
}

.result-summary-card :deep(.app-card__header) {
  margin-bottom: 8px;
}

.result-summary-card :deep(.app-card__title) {
  font-size: 16px;
}

.summary-fields {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 12px 18px;
  max-width: 1080px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 14px 16px;
  background: #ffffff;
}

.summary-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.summary-field__label {
  color: var(--color-muted);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.summary-field__value {
  color: var(--color-text);
  font-size: 16px;
  font-weight: 900;
  line-height: 1.15;
  overflow-wrap: anywhere;
}

.detail-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 8px;
  margin: 8px 0 0;
}

.detail-stat {
  border-top: 1px solid var(--color-border);
  padding-top: 7px;
}

.detail-stat dt {
  color: var(--color-muted);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}

.detail-stat dd {
  margin: 3px 0 0;
  color: var(--color-text);
  font-size: 13px;
  font-weight: 850;
}

.analysis-empty {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 14px;
  color: var(--color-muted);
  background: #fbfcff;
  font-size: 14px;
  line-height: 1.5;
}

.analysis-muted {
  margin: 10px 0 0;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.45;
}

.knowledge-card {
  border-color: #d7e4f8;
  border-radius: 8px;
  padding: 28px;
  background: #ffffff;
  box-shadow: 0 16px 34px rgba(15, 23, 42, 0.04);
}

.knowledge-analysis {
  display: grid;
  gap: 28px;
}

.knowledge-analysis__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.knowledge-analysis__header h2 {
  margin: 0;
  color: #111827;
  font-size: 18px;
  font-weight: 850;
  line-height: 1.2;
}

.knowledge-analysis__header p {
  margin: 12px 0 0;
  color: #7c899d;
  font-size: 15px;
  font-weight: 500;
  line-height: 1.4;
}

.knowledge-analysis__header > span {
  flex: 0 0 auto;
  color: #8d8a86;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  white-space: nowrap;
}

.knowledge-score-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 34px;
}

.knowledge-score-subject {
  min-width: 0;
}

.knowledge-score-subject h3 {
  margin: 0 0 18px;
  color: #111827;
  font-size: 20px;
  font-weight: 900;
  line-height: 1.2;
}

.knowledge-score-list {
  display: grid;
}

.knowledge-score-item {
  display: grid;
  gap: 9px;
  padding: 0 0 22px;
}

.knowledge-score-item + .knowledge-score-item {
  border-top: 1px solid #e6edf5;
  padding-top: 23px;
}

.knowledge-score-item__header,
.knowledge-score-item__footer {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 14px;
  min-width: 0;
}

.knowledge-score-item__header strong {
  min-width: 0;
  color: #111827;
  font-size: 18px;
  font-weight: 900;
  line-height: 1.22;
  overflow-wrap: anywhere;
}

.knowledge-score-item__header span {
  flex: 0 0 auto;
  color: #111827;
  font-size: 17px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}

.knowledge-score-item__detail {
  margin: 0;
  color: #536175;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.35;
}

.knowledge-segment-bar {
  display: grid;
  grid-template-columns: repeat(8, minmax(16px, 1fr));
  gap: 4px;
  min-height: 14px;
}

.knowledge-segment-bar__segment {
  display: block;
  height: 14px;
  border: 1px solid #1f2937;
  background: #ffffff;
}

.knowledge-segment-bar__segment--filled {
  background: #1f2937;
}

.knowledge-score-item__footer {
  color: #7c899d;
  font-size: 13px;
  font-weight: 650;
  line-height: 1.35;
}

.knowledge-score-item__footer span:last-child {
  flex: 0 1 auto;
  max-width: 40%;
  color: #374151;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.time-analysis-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.time-analysis-card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 14px;
  background: #ffffff;
}

.time-analysis-card p {
  margin: 0;
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 750;
  text-transform: uppercase;
}

.time-analysis-card strong {
  display: block;
  margin-top: 8px;
  color: var(--color-text);
  font-size: 20px;
  line-height: 1.2;
}

.time-analysis-card span {
  display: block;
  margin-top: 6px;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.35;
}

.review-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.review-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.review-filter {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 10px 14px;
  color: var(--color-text);
  background: #ffffff;
  font-weight: 700;
  cursor: pointer;
  transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease;
}

.review-filter strong {
  color: var(--color-muted);
  font-size: 12px;
}

.review-filter--active {
  border-color: rgba(47, 111, 237, 0.24);
  color: var(--color-primary-strong);
  background: rgba(47, 111, 237, 0.08);
}

.review-filter--active strong {
  color: inherit;
}

.review-toolbar__summary {
  margin: 0;
  color: var(--color-muted);
  font-size: 13px;
}

.question-sections {
  display: grid;
  gap: 22px;
}

.question-section {
  display: grid;
  gap: 12px;
}

.question-section__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}

.question-section__title {
  margin: 0;
  color: var(--color-text);
  font-size: 18px;
  font-weight: 800;
}

.question-section__subtitle {
  margin: 4px 0 0;
  color: var(--color-muted);
  font-size: 13px;
}

.question-section__count {
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.question-set-list {
  display: grid;
  gap: 8px;
}

.question-set-card {
  overflow: hidden;
  border: 1px solid rgba(219, 230, 247, 0.72);
  border-radius: 10px;
  background: #ffffff;
}

.question-set-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid rgba(219, 230, 247, 0.72);
  padding: 8px 12px;
  background: #fbfcff;
}

.question-set-card__header h4,
.question-set-card__header p {
  margin: 0;
}

.question-set-card__header h4 {
  color: var(--color-text);
  font-size: 13px;
  font-weight: 800;
}

.question-set-card__header p,
.question-set-card__count {
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.4;
}

.question-set-card__count {
  flex: 0 0 auto;
  padding: 0;
  background: transparent;
  font-weight: 800;
}

.question-table-wrap {
  overflow-x: auto;
  background: #ffffff;
}

.question-table {
  width: 100%;
  min-width: 0;
  border-collapse: collapse;
}

.question-table th,
.question-table td {
  border-bottom: 1px solid var(--color-border);
  padding: 8px 12px;
  text-align: center;
  vertical-align: top;
}

.question-table th:first-child,
.question-table td:first-child { text-align: left; }

.question-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  text-align: center;
  color: var(--color-muted);
  font-size: 12px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  background: #fbfcfe;
}

.question-table tbody tr:hover {
  background: rgba(246, 249, 255, 0.6);
}

.question-table tbody tr.question-row--wrong {
  background: #fff1f2;
}

.question-table tbody tr.question-row--wrong:hover {
  background: #ffe8eb;
}

.question-table tbody tr.question-row--unanswered {
  background: #fff8e1;
}

.question-table tbody tr.question-row--unanswered:hover {
  background: #fff3c4;
}

.question-table__question {
  min-width: 120px;
}

.question-preview__image {
  display: block;
  width: min(180px, 100%);
  max-height: 110px;
  margin-top: 8px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  object-fit: contain;
  background: #ffffff;
}

.question-table__answer {
  min-width: 0;
  color: var(--color-text);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.type-pill {
  display: inline-flex;
  border-radius: 999px;
  padding: 6px 10px;
  color: #42526b;
  background: #f3f6fa;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.question-link {
  border: 0;
  padding: 0;
  color: var(--color-primary);
  background: transparent;
  font-weight: 700;
  cursor: pointer;
}

.answer-placeholder {
  color: var(--color-muted);
  font-weight: 700;
}

.score-cell {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.result-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 6px 10px;
  color: var(--color-muted);
  background: #eef3f8;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.result-pill--correct {
  color: var(--color-success);
  background: rgba(20, 135, 101, 0.1);
}

.result-pill--wrong {
  color: var(--color-danger);
  background: rgba(199, 55, 71, 0.1);
}

.result-pill--neutral {
  color: #62748a;
  background: #eef2f7;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 780px) {
  .attempt-report__hero,
  .review-toolbar,
  .question-section__header,
  .attempt-report__actions {
    flex-direction: column;
  }

  .attempt-report__actions {
    align-items: stretch;
  }

  .detail-stats,
  .knowledge-score-grid,
  .time-analysis-grid {
    grid-template-columns: 1fr;
  }

  .knowledge-card {
    padding: 22px;
  }

  .knowledge-analysis__header {
    flex-direction: column;
    gap: 8px;
  }

  .knowledge-analysis__header > span {
    text-align: left;
  }

  .knowledge-score-grid {
    gap: 28px;
  }

  .knowledge-score-item__header,
  .knowledge-score-item__footer {
    align-items: flex-start;
  }

  .knowledge-score-item__footer span:last-child {
    max-width: 46%;
  }
}

@media print {
  @page {
    margin: 12mm;
  }

  .attempt-report {
    width: 100%;
    max-width: none;
    min-width: 0;
    gap: 16px;
  }

  .knowledge-card,
  .knowledge-score-subject,
  .knowledge-score-item {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .knowledge-card {
    border-color: #d7e4f8;
    padding: 18px;
    box-shadow: none;
  }

  .knowledge-analysis {
    gap: 18px;
  }

  .knowledge-analysis__header {
    flex-direction: row;
    gap: 16px;
  }

  .knowledge-analysis__header h2 {
    font-size: 17px;
  }

  .knowledge-analysis__header p {
    margin-top: 8px;
    font-size: 12px;
  }

  .knowledge-analysis__header > span {
    font-size: 11px;
    text-align: right;
    white-space: nowrap;
  }

  .knowledge-score-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 24px;
  }

  .knowledge-score-subject h3 {
    margin-bottom: 12px;
    font-size: 16px;
  }

  .knowledge-score-item {
    gap: 6px;
    padding-bottom: 14px;
  }

  .knowledge-score-item + .knowledge-score-item {
    padding-top: 14px;
  }

  .knowledge-score-item__header strong {
    font-size: 14px;
  }

  .knowledge-score-item__header span {
    font-size: 14px;
  }

  .knowledge-score-item__detail,
  .knowledge-score-item__footer {
    font-size: 11px;
  }

  .knowledge-segment-bar {
    grid-template-columns: repeat(8, minmax(10px, 1fr));
    gap: 3px;
  }

  .knowledge-segment-bar__segment {
    height: 10px;
    border-color: #1f2937;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }

  .knowledge-segment-bar__segment--filled {
    background: #1f2937;
  }

  .report-print-hidden,
  .attempt-report__actions,
  .icon-refresh-button {
    display: none !important;
  }

  .question-table-wrap {
    overflow: visible;
  }

  .question-set-card {
    overflow: visible;
  }

  .question-table {
    display: block;
    width: 100%;
    max-width: 100%;
    min-width: 0;
  }

  .question-table thead {
    display: none;
  }

  .question-table tbody {
    display: grid;
    gap: 10px;
  }

  .question-table tbody tr {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto auto;
    grid-template-areas:
      "question type status score"
      "your your your your"
      "correct correct correct correct";
    gap: 8px 12px;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 10px 12px;
  }

  .question-table tbody tr.question-row--wrong {
    background: #fff1f2;
  }

  .question-table tbody tr.question-row--unanswered {
    background: #fff8e1;
  }

  .question-table tbody td {
    display: block;
    width: auto;
    min-width: 0 !important;
    border: 0;
    padding: 0;
  }

  .question-table__question {
    grid-area: question;
  }

  .question-table tbody td:nth-child(2) {
    grid-area: type;
  }

  .question-table tbody td:nth-child(3) {
    grid-area: your;
  }

  .question-table tbody td:nth-child(4) {
    grid-area: correct;
  }

  .question-table tbody td:nth-child(5) {
    grid-area: status;
  }

  .question-table tbody td:nth-child(6) {
    grid-area: score;
  }

  .question-table tbody td:nth-child(3),
  .question-table tbody td:nth-child(4) {
    border-top: 1px solid var(--color-border);
    padding-top: 8px;
  }

  .question-table tbody td:nth-child(3)::before,
  .question-table tbody td:nth-child(4)::before {
    display: block;
    margin-bottom: 4px;
    color: var(--color-muted);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .question-table tbody td:nth-child(3)::before {
    content: "Your Answer";
  }

  .question-table tbody td:nth-child(4)::before {
    content: "Correct Answer";
  }

  .summary-table-wrap {
    overflow: visible;
  }

  .summary-table {
    min-width: 0;
  }

  .summary-table th,
  .summary-table td,
  .question-table th,
  .question-table td {
    min-width: 0 !important;
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: normal;
  }

  .question-table__answer,
  .question-table__answer-component {
    width: auto;
    max-width: 100% !important;
    min-width: 0 !important;
  }

  .question-table__answer-component {
    display: block;
  }

  .question-table__answer :deep(.inline-choice-report),
  .question-table__answer :deep(.drag-report),
  .question-table__answer :deep(.table-grid-report),
  .question-table__answer :deep(.formula-text),
  .question-table__answer :deep(.mixed-content) {
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    overflow: visible !important;
    white-space: normal !important;
  }

  .question-table__answer :deep(.inline-choice-report__row) {
    min-width: 0;
    flex-wrap: wrap;
  }

  .question-table__answer :deep(.drag-report__choices),
  .question-table__answer :deep(.drag-report__choice) {
    min-width: 0;
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .question-table__answer :deep(.table-grid-report) {
    table-layout: auto;
    border-radius: 0;
  }

  .question-table__answer :deep(.table-grid-report th),
  .question-table__answer :deep(.table-grid-report td) {
    min-width: 0;
    max-width: 100%;
    padding: 4px;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .question-table__answer :deep(.formula-text__block-math),
  .question-table__answer :deep(.mixed-content__block-math) {
    overflow: visible !important;
  }

  .type-pill {
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .question-table tbody tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .review-toolbar {
    display: none;
  }

  .question-link {
    color: inherit;
    font: inherit;
    font-weight: 700;
    text-decoration: none;
    cursor: default;
  }
}
</style>
