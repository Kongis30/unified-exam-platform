import {
  apiRequest,
  getStudentAttempt,
  listStudentExams,
  listExams,
  saveStudentAnswer,
  setStudentBookmark,
  startStudentAttempt,
  submitStudentAttempt,
} from '@/api/platform';
import { getUserRole } from '@/examTypes/shsat/admin/authBridge';

function parseJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function mapExam(exam) {
  return {
    ...exam,
    examId: exam.id,
    examTitle: exam.title,
    startTime: exam.opensAt,
    endTime: exam.closesAt,
    attemptStatus: exam.activeAttemptId ? 'IN_PROGRESS' : null,
    canStart: exam.activeAttemptId !== null || exam.attemptsUsed < exam.attemptLimit,
    remainingAttempts: Math.max(0, exam.attemptLimit - exam.attemptsUsed),
  };
}

function mapAttempt(attempt) {
  const materials = [];
  const questions = (attempt.questions || []).map((question, index) => {
    const render = question.display || {};
    const rawMaterial = render.material;
    let materialId = null;
    if (rawMaterial) {
      const identity = JSON.stringify(rawMaterial);
      let material = materials.find((entry) => entry.identity === identity);
      if (!material) {
        material = {
          identity,
          materialId: `attempt-material-${materials.length + 1}`,
          materialType: rawMaterial.type || 'TEXT',
          materialCategory: rawMaterial.category || 'Reading Passage',
          materialTitle: rawMaterial.title || '',
          materialContent: rawMaterial.content || '',
          assetUrl: rawMaterial.assetUrl || '',
        };
        materials.push(material);
      }
      materialId = material.materialId;
    }
    return {
      ...question,
      questionId: question.paperItemId,
      questionNumber: question.displayNumber || index + 1,
      questionType: question.questionTypeCode,
      sectionCode: question.sectionCode || '',
      partId: question.parentSectionCode || question.sectionCode || 'UNASSIGNED',
      partCode: question.parentSectionCode || question.sectionCode || '',
      partName: question.parentSectionTitle || question.sectionTitle || '',
      subTypeId: question.parentSectionCode ? question.sectionCode : null,
      materialId,
      stem: question.stem,
      options: JSON.stringify(render.options || []),
      questionConfig: JSON.stringify(render.questionConfig || {}),
      validationRules: JSON.stringify(render.validationRules || {}),
      scoringRules: JSON.stringify(render.grading || {}),
      answerData: question.answer == null ? null : JSON.stringify(question.answer),
      material: materials.find((entry) => entry.materialId === materialId) || null,
    };
  });
  const partsByCode = new Map();
  const subTypes = [];
  for (const question of questions) {
    const code = question.partCode;
    if (!code) continue;
    if (!partsByCode.has(code)) {
      partsByCode.set(code, {
        partId: question.partId,
        partCode: code,
        partName: question.partName || code,
        partIntro: '',
        displayOrder: partsByCode.size + 1,
      });
    }
    if (question.subTypeId && !subTypes.some((item) => item.subTypeId === question.subTypeId)) {
      subTypes.push({ subTypeId: question.subTypeId, partId: question.partId,
        subTypeCode: question.sectionCode, subTypeName: question.sectionCode });
    }
  }
  return {
    ...attempt,
    attemptId: attempt.id,
    examTitle: attempt.examTitle,
    remainingSeconds: attempt.expiresAt
      ? Math.max(0, Math.ceil((new Date(attempt.expiresAt).getTime() - Date.now()) / 1000)) : 0,
    focusViolationCount: Number(attempt.progressState?.focusViolationCount || 0),
    questions,
    parts: [...partsByCode.values()],
    subTypes,
    materials,
    answers: questions.filter((question) => question.answer != null).map((question) => ({
      questionNumber: question.questionNumber,
      answerData: question.answerData,
      marked: question.marked,
    })),
  };
}

export const studentApi = {
  async getExams() {
    if (['admin', 'teacher'].includes(getUserRole())) {
      return (await listExams('SHSAT')).map((exam) => ({
        ...exam,
        examId: exam.id,
        examTitle: exam.title,
        startTime: exam.opensAt,
        endTime: exam.closesAt,
      }));
    }
    return (await listStudentExams()).filter((exam) => exam.examTypeCode === 'SHSAT').map(mapExam);
  },

  async startExam(examId, payload = {}) {
    return mapAttempt(await startStudentAttempt(examId, payload?.firstSection || ''));
  },

  async submitAnswer(attemptId, payload) {
    const answer = parseJson(payload.answerData, { value: payload.selectedAnswer || '' });
    return mapAttempt(await saveStudentAnswer(attemptId, payload.questionId, answer, payload.timeSpent || 0));
  },

  async setQuestionMarked(attemptId, questionId, marked) {
    return mapAttempt(await setStudentBookmark(attemptId, questionId, marked));
  },

  async getAttempt(attemptId) {
    return mapAttempt(await getStudentAttempt(attemptId));
  },

  async completeAttempt(attemptId) {
    return mapAttempt(await submitStudentAttempt(attemptId));
  },

  async submitSection(attemptId, sectionCode) {
    return mapAttempt(await apiRequest(`/api/student/attempts/${attemptId}/sections/submit`, {
      method: 'POST', body: JSON.stringify({ sectionCode }),
    }));
  },

  updateAttemptPresence(attemptId, payload) {
    return apiRequest(`/api/student/attempts/${attemptId}/presence`, {
      method: 'POST', body: JSON.stringify(payload),
    });
  },
  recordFocusViolation(attemptId) {
    return apiRequest(`/api/student/attempts/${attemptId}/focus-violations`, { method: 'POST' });
  },
  async getAttemptResult(attemptId) {
    return apiRequest(`/api/student/attempts/${attemptId}/report`);
  },
  async getAttemptHistory() {
    return apiRequest('/api/student/attempts/history');
  },
  async getWrongAnswerQuestionNumbers(attemptId) {
    return apiRequest(`/api/student/attempts/${attemptId}/wrong-answer-question-numbers`);
  },
  async startWrongAnswerPractice(attemptId) {
    return mapAttempt(await apiRequest(`/api/student/attempts/${attemptId}/wrong-answers/practice`, { method: 'POST' }));
  },
  async getPaperDetail() { throw new Error('This exam paper is unavailable. Please contact your teacher.'); },
};
