import { http } from './http';
import {
  addClassStudent, addClassStudents, apiRequest, cachedResource, createClass as createPlatformClass,
  createExam as createPlatformExam, createUser as createPlatformUser,
  deleteClass as deletePlatformClass, listAvailableStudents, listClassStudents, listClasses, listExams, listPapers, listPaperGroups,
  publishExam as publishPlatformExam, removeClassStudent, reorderClasses as reorderPlatformClasses, saveExamTargets,
  sealPaper as sealPlatformPaper, updateClass as updatePlatformClass, updateExam as updatePlatformExam,
} from '@/api/platform';
import { DEFAULT_INITIAL_PASSWORD, usernameFromFullName } from '@shsat/utils/accountCredentials';
import { applyShsatSkillTagToConfig } from '@shsat/utils/shsatSkillTags';

const SHSAT = 'SHSAT';

function paperSummary(paper) {
  return {
    paperId: paper.id,
    paperCode: paper.paperCode,
    paperGroupId: paper.groupId,
    paperGroupName: paper.groupName,
    paperName: paper.title,
    paperDescription: paper.description || '',
    defaultDuration: Math.round((paper.defaultDurationSeconds || 0) / 60),
    status: paper.status,
    displayOrder: paper.versionNo,
    totalQuestions: paper.questionCount || 0,
    totalParts: paper.sectionCount || 0,
    totalScore: Number(paper.totalScore || 0),
    online: paper.status === 'READY',
  };
}

function paperGroup(group) {
  return {
    ...group, paperGroupId: group.id, groupId: group.id,
    groupName: group.name, groupDesc: group.description || '', displayOrder: group.sortOrder,
  };
}

function classSummary(classroom) {
  return {
    ...classroom,
    classId: classroom.id,
    className: classroom.name,
    classDescription: classroom.description || '',
    displayOrder: classroom.sortOrder,
    isActive: classroom.active ?? classroom.status === 'ACTIVE',
  };
}

function classSavePayload(payload) {
  return {
    name: payload.name || payload.className,
    description: payload.description ?? payload.classDescription ?? null,
    sortOrder: payload.displayOrder || 0,
    teacherName: payload.teacherName || null,
    teacherEmail: payload.teacherEmail || null,
    gradeLevel: payload.gradeLevel || null,
    academicYear: payload.academicYear || null,
    active: payload.active,
  };
}

function parseJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function mapPaperDetail(detail) {
  const unassignedSection = detail.sections.find((section) => section.sectionKind === 'UNASSIGNED');
  const paperSections = detail.sections.filter((section) => section.sectionKind !== 'UNASSIGNED');
  const parts = paperSections.map((section) => ({
    partId: String(section.id), paperId: detail.summary.id,
    partNumber: section.sortOrder + 1, partCode: section.settings?.partCode || section.sectionCode,
    partName: section.title, partIntro: section.instructions || '',
    questionRange: section.settings?.questionRange || '',
    questionCount: section.settings?.questionCount || section.questions.length,
    displayOrder: section.sortOrder + 1,
  }));
  const subTypes = paperSections.flatMap((part) => part.children.map((section) => ({
    subTypeId: String(section.id), paperId: detail.summary.id,
    partId: String(part.id), subTypeCode: section.settings?.subTypeCode
      || (section.sectionCode.startsWith(`${part.sectionCode}_`)
        ? section.sectionCode.slice(part.sectionCode.length + 1)
        : section.sectionCode),
    subTypeName: section.title, subTypeIntro: section.instructions || '',
    questionRange: section.settings?.questionRange || '',
    questionCount: section.settings?.questionCount || section.questions.length,
    displayOrder: section.sortOrder + 1,
  })));
  const materials = (detail.materials || []).map((item) => {
    const part = parts.find((entry) => entry.partCode === item.partCode);
    const subType = item.subTypeCode && part
      ? subTypes.find((entry) => entry.subTypeCode === item.subTypeCode && String(entry.partId) === String(part.partId))
      : null;
    return {
      materialId: String(item.id), paperId: detail.summary.id,
      partId: part ? String(part.partId) : null,
      subTypeId: subType ? String(subType.subTypeId) : null,
      materialType: item.materialType || 'TEXT', materialCategory: item.category || null,
      materialTitle: item.title || null, materialContent: item.content || null,
      assetUrl: item.assetUrl || null, displayOrder: Number(item.sortOrder || 0),
    };
  });
  let nextQuestionNumber = 1;
  const questions = paperSections.flatMap((part) => {
    const groups = [{ ...part, subTypeId: null }, ...part.children.map((child) => ({ ...child, subTypeId: String(child.id) }))];
    return groups.flatMap((section) => section.questions.map((item) => {
      const render = parseJson(item.render);
      const questionNumber = Number(item.displayNumber || nextQuestionNumber);
      nextQuestionNumber = Math.max(nextQuestionNumber, questionNumber + 1);
      const material = render.material || null;
      let materialId = render.materialId == null ? null : String(render.materialId);
      if (material) {
        const key = `${material.type || 'TEXT'}:${material.title || ''}:${material.content || material.assetUrl || ''}`;
        let saved = materials.find((entry) => entry.materialId === materialId)
          || materials.find((entry) => entry.key === key);
        if (!saved) {
          saved = {
            key, materialId: materialId || `material-${materials.length + 1}`, paperId: detail.summary.id,
            partId: String(part.id), subTypeId: section.subTypeId,
            materialType: material.type || 'TEXT', materialCategory: material.category || null,
            materialTitle: material.title || null, materialContent: material.content || null,
            assetUrl: material.assetUrl || null, displayOrder: item.sortOrder + 1,
          };
          materials.push(saved);
        }
        materialId = saved.materialId;
      }
      return {
        questionId: item.questionId, paperItemId: item.paperItemId, paperId: detail.summary.id,
        questionSchemaVersion: item.payloadSchemaVersion || 1,
        sourceQuestionId: render.sourceQuestionId ?? null,
        sourceScoringSectionCode: render.sourceScoringSectionCode ?? null,
        sourceDifficulty: render.sourceDifficulty ?? null,
        legacyCorrectAnswer: render.legacyCorrectAnswer ?? null,
        partId: String(part.id), subTypeId: section.subTypeId, materialId,
        questionNumber,
        questionType: item.questionTypeCode, stem: item.stem,
        scoringSectionCode: item.scoringSectionCode || part.sectionCode,
        explanation: item.explanation ?? null,
        totalScore: item.maxPoints ?? 1,
        shsatSkillTag: render.questionConfig?.shsatSkillTag || null,
        options: JSON.stringify(render.options || []),
        correctAnswerData: JSON.stringify(item.answerKey),
        questionConfig: JSON.stringify(render.questionConfig || {}),
        validationRules: JSON.stringify(render.validationRules || {}),
        scoringRules: JSON.stringify(item.grading || {}), difficulty: render.difficulty || null,
        // Paper item sortOrder is local to its subtype; displayNumber carries the
        // paper-wide order needed by the editor when flattening those subtypes.
        displayOrder: questionNumber,
        materialType: material?.type === 'IMAGE' ? 'image' : material ? 'text' : 'none',
        materialTitle: material?.title || '', materialCategory: material?.category || 'Reading Passage',
        materialContent: material?.content || '', imageUrl: material?.assetUrl || '',
      };
    }));
  });
  if (unassignedSection) {
    questions.push(...unassignedSection.questions.map((item) => {
      const render = parseJson(item.render);
      const questionNumber = Number(item.displayNumber || nextQuestionNumber++);
      return {
        questionId: item.questionId, paperItemId: item.paperItemId, paperId: detail.summary.id,
        partId: null, subTypeId: null, materialId: null,
        questionNumber, questionType: item.questionTypeCode,
        stem: item.stem, options: JSON.stringify(render.options || []),
        correctAnswerData: JSON.stringify(item.answerKey), questionConfig: JSON.stringify(render.questionConfig || {}),
        validationRules: JSON.stringify(render.validationRules || {}), scoringRules: JSON.stringify(item.grading || {}),
        difficulty: render.difficulty || null, displayOrder: questionNumber,
        materialType: 'none', materialTitle: '', materialCategory: 'Reading Passage', materialContent: '', imageUrl: '',
      };
    }));
  }
  return {
    paperId: detail.summary.id, paperGroupId: detail.groupId,
    paperGroupName: detail.summary.groupName, paperName: detail.summary.title,
    paperDescription: detail.description || '', defaultDuration: Math.round((detail.summary.defaultDurationSeconds || 0) / 60),
    status: detail.summary.status, online: detail.summary.status === 'READY',
    totalParts: parts.length, totalQuestions: questions.length,
    scoringProfileCode: detail.scoringProfileCode || 'SHSAT_2026_100',
    parts, subTypes, materials, questions, solutionCount: Number(detail.solutionCount || 0),
  };
}

function parsePayload(value, fallback) {
  const parsed = parseJson(value, fallback);
  return parsed === undefined || parsed === null ? fallback : parsed;
}

function mapShsatQuestion(question, sortOrder, sectionCode) {
  const options = parsePayload(question.options, []);
  const answerKey = parsePayload(question.correctAnswerData, {});
  const render = {
    options,
    questionConfig: applyShsatSkillTagToConfig(parsePayload(question.questionConfig, {}), question.shsatSkillTag),
    validationRules: parsePayload(question.validationRules, {}),
    difficulty: question.difficulty || null,
  };
  for (const field of ['sourceQuestionId', 'sourceScoringSectionCode', 'sourceDifficulty', 'legacyCorrectAnswer']) {
    if (question[field] !== undefined) render[field] = question[field];
  }
  if (question.materialType && question.materialType !== 'none') {
    if (question.materialId && /^\d+$/.test(String(question.materialId))) {
      render.materialId = Number(question.materialId);
    } else if (question.materialId) {
      render.materialRef = String(question.materialId);
    }
    render.material = {
      type: question.materialType === 'image' ? 'IMAGE' : 'TEXT',
      title: question.materialTitle || null,
      category: question.materialCategory || null,
      content: question.materialType === 'text' ? question.materialContent || null : null,
      assetUrl: question.materialType === 'image' ? question.imageUrl || null : null,
    };
  }
  return {
    questionTypeCode: question.questionType || 'MULTIPLE_CHOICE',
    payloadSchemaVersion: Number(question.questionSchemaVersion || 1),
    stem: question.stem || '', render, answerKey,
    grading: parsePayload(question.scoringRules, {}), explanation: question.explanation ?? null,
    categoryId: null, sortOrder, displayNumber: Number(question.questionNumber || sortOrder + 1),
    maxPoints: question.totalScore == null ? 1 : Number(question.totalScore),
    scoringSectionCode: question.scoringSectionCode || sectionCode || null,
  };
}

function toSectionRequest(part, subTypes, questions, partOrder) {
  const code = String(part.partCode || `PART_${partOrder + 1}`).slice(0, 60);
  const partQuestions = questions.filter((question) => question.partId && String(question.partId) === String(part.partId));
  const children = subTypes
    .filter((subType) => String(subType.partId) === String(part.partId))
    .sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0))
    .map((subType, index) => ({
      sectionCode: `${code}_${String(subType.subTypeCode || `SUBTYPE_${index + 1}`).slice(0, 50)}`.slice(0, 60),
      sectionKind: 'SUBTYPE', title: subType.subTypeName || 'Question Type',
      sortOrder: index, instructions: subType.subTypeIntro || null,
      settings: { questionRange: subType.questionRange || '', questionCount: Number(subType.questionCount || 0), subTypeCode: subType.subTypeCode || null },
      questions: questions.filter((question) => String(question.subTypeId) === String(subType.subTypeId))
        .sort((a, b) => Number(a.displayOrder || a.questionNumber || 0) - Number(b.displayOrder || b.questionNumber || 0))
        .map((question, order) => mapShsatQuestion(question, order, code)),
      children: [],
    }));
  const assignedSubTypes = new Set(subTypes.filter((item) => String(item.partId) === String(part.partId)).map((item) => String(item.subTypeId)));
  const looseQuestions = partQuestions.filter((question) => !assignedSubTypes.has(String(question.subTypeId)));
  return {
    sectionCode: code, sectionKind: 'PART', title: part.partName || code,
    sortOrder: partOrder, instructions: part.partIntro || null,
    settings: { partNumber: Number(part.partNumber || partOrder + 1), questionRange: part.questionRange || '', questionCount: Number(part.questionCount || 0), partCode: part.partCode || null },
    questions: looseQuestions.sort((a, b) => Number(a.displayOrder || a.questionNumber || 0) - Number(b.displayOrder || b.questionNumber || 0)
      ).map((question, order) => mapShsatQuestion(question, order, code)),
    children,
  };
}

function toMaterialRequest(material, parts, subTypes, index) {
  const part = parts.find((item) => String(item.partId) === String(material.partId));
  const subType = subTypes.find((item) => String(item.subTypeId) === String(material.subTypeId));
  if (!part) return null;
  return {
    materialId: /^\d+$/.test(String(material.materialId || '')) ? String(material.materialId) : null,
    clientRef: String(material.materialId || `material-${index + 1}`),
    partCode: part.partCode,
    subTypeCode: subType?.subTypeCode || null,
    materialType: material.materialType || 'TEXT',
    category: material.materialCategory || null,
    title: material.materialTitle || null,
    content: material.materialType === 'IMAGE' ? null : material.materialContent || null,
    assetUrl: material.assetUrl || null,
    sortOrder: Number(material.displayOrder || index),
  };
}

export const adminApi = {
  async getPaperGroups({ force = false } = {}) {
    const groups = await listPaperGroups(SHSAT, { force });
    return groups.map(paperGroup);
  },

  createPaperGroup(payload) {
    return apiRequest(`/api/admin/exam-types/${SHSAT}/paper-groups`, {
      method: 'POST', body: JSON.stringify({ name: payload.groupName, description: payload.groupDesc, sortOrder: 0 }),
    }).then(paperGroup);
  },

  updatePaperGroup(paperGroupId, payload) {
    return apiRequest(`/api/admin/paper-groups/${paperGroupId}`, {
      method: 'PUT', body: JSON.stringify({ name: payload.groupName, description: payload.groupDesc, sortOrder: payload.displayOrder || 0 }),
    }).then(paperGroup);
  },

  deletePaperGroup(paperGroupId) {
    return apiRequest(`/api/admin/paper-groups/${paperGroupId}`, { method: 'DELETE' });
  },

  reorderPaperGroups(paperGroupIds) {
    return apiRequest(`/api/admin/exam-types/${SHSAT}/paper-groups/order`, {
      method: 'PUT', body: JSON.stringify({ paperGroupIds }),
    }).then((groups) => groups.map(paperGroup));
  },

  async getPapers(params = {}, { force = false } = {}) {
    const papers = (await listPapers(SHSAT, { force })).map(paperSummary);
    return papers.filter((paper) => {
      const matchesGroup = !params.groupId || String(paper.paperGroupId || '') === String(params.groupId);
      const matchesKeyword = !params.keyword || `${paper.paperName} ${paper.paperCode}`.toLowerCase().includes(params.keyword.toLowerCase());
      const matchesOnline = !params.online || paper.online === (params.online === 'true');
      return matchesGroup && matchesKeyword && matchesOnline;
    });
  },

  getPaper(paperId) {
    return apiRequest(`/api/admin/papers/${paperId}`).then(mapPaperDetail);
  },

  getPaperStructureStats(paperId) {
    return apiRequest(`/api/admin/papers/${paperId}/structure-stats`);
  },

  savePaperStructure(paperId, structure) {
    const sections = [...structure.parts]
      .sort((a, b) => Number(a.displayOrder || a.partNumber || 0) - Number(b.displayOrder || b.partNumber || 0))
      .map((part, index) => toSectionRequest(part, structure.subTypes, structure.questions, index));
    const assignedQuestionIds = new Set(structure.parts.flatMap((part) => structure.questions
      .filter((question) => String(question.partId) === String(part.partId)).map((question) => String(question.localId))));
    const unassignedQuestions = structure.questions.filter((question) => !assignedQuestionIds.has(String(question.localId)));
    if (unassignedQuestions.length) {
      sections.push({
        sectionCode: 'UNASSIGNED', sectionKind: 'UNASSIGNED', title: 'Unassigned',
        sortOrder: sections.length, instructions: null, settings: {}, children: [],
        questions: unassignedQuestions.map((question, index) => mapShsatQuestion(question, index, null)),
      });
    }
    const materials = (structure.materials || [])
      .map((material, index) => toMaterialRequest(material, structure.parts, structure.subTypes, index))
      .filter(Boolean);
    return apiRequest(`/api/admin/papers/${paperId}/structure`, {
      method: 'PUT', body: JSON.stringify({ sections, materials }),
    }).then(mapPaperDetail);
  },

  getPaperDeleteImpact(paperId) {
    return http.get(`/admin/papers/${paperId}/delete-impact`);
  },

  deletePaper(paperId) {
    return http.delete(`/admin/papers/${paperId}`);
  },

  getOfficialShsatLabelTemplate() {
    return Promise.resolve({
      totalQuestions: 100,
      defaultDuration: 180,
      parts: [
        { code: 'ELA', name: 'English Language Arts', intro: 'SHSAT English Language Arts section with 50 scored questions.', questionRange: '1-50', questionCount: 50, subTypes: [
          { code: 'REVISING_EDITING_PART_A', name: 'Revising/Editing Part A', intro: 'Stand-alone language and writing questions.' },
          { code: 'REVISING_EDITING_PART_B', name: 'Revising/Editing Part B', intro: 'Passage-based writing improvement questions.' },
          { code: 'READING_COMPREHENSION', name: 'Reading Comprehension', intro: 'Passage-based reading analysis questions.' },
        ] },
        { code: 'MATH', name: 'Mathematics', intro: 'SHSAT Mathematics section with 50 scored questions.', questionRange: '51-100', questionCount: 50, subTypes: [
          { code: 'MATH_FILL_IN_BLANK', name: 'Math Fill in the Blank', intro: 'Math questions answered by entering a value.' },
          { code: 'MATH_MULTIPLE_CHOICE', name: 'Math Multiple Choice', intro: 'Math questions answered by choosing one option.' },
          { code: 'MATH_TECH_ENHANCED', name: 'Math Tech-Enhanced', intro: 'Technology-enhanced SHSAT math interaction questions.' },
        ] },
      ],
    });
  },

  createPaper(payload) {
    const paperCode = payload.paperCode || `${String(payload.paperName || 'SHSAT').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 58)}_${Date.now()}`;
    return apiRequest(`/api/admin/exam-types/${SHSAT}/papers`, {
      method: 'POST', body: JSON.stringify({
        paperCode, title: payload.paperName, description: payload.paperDescription || null,
        groupId: payload.paperGroupId || null, defaultDurationSeconds: payload.defaultDuration ? Number(payload.defaultDuration) * 60 : null,
      }),
    }).then((paper) => ({ ...paper, paperId: paper.summary.id }));
  },

  updatePaper(paperId, payload) {
    return apiRequest(`/api/admin/papers/${paperId}`, {
      method: 'PATCH', body: JSON.stringify({
        title: payload.paperName, description: payload.paperDescription || null,
        groupId: payload.paperGroupId || null,
        defaultDurationSeconds: payload.defaultDuration ? Number(payload.defaultDuration) * 60 : null,
      }),
    });
  },

  updatePaperScoringProfile(paperId, scoringProfileCode) {
    return apiRequest(`/api/admin/papers/${paperId}/scoring-profile`, {
      method: 'PATCH', body: JSON.stringify({ scoringProfileCode }),
    }).then(mapPaperDetail);
  },

  createPaperVersion(paperId) {
    return http.post(`/admin/papers/${paperId}/versions`);
  },

  sealPaper(paperId) {
    return sealPlatformPaper(paperId);
  },

  createPart(paperId, payload) {
    return http.post(`/admin/papers/${paperId}/parts`, payload);
  },

  updatePart(paperId, partId, payload) {
    return http.put(`/admin/papers/${paperId}/parts/${partId}`, payload);
  },

  deletePart(paperId, partId) {
    return http.delete(`/admin/papers/${paperId}/parts/${partId}`);
  },

  createSubType(paperId, payload) {
    return http.post(`/admin/papers/${paperId}/sub-types`, payload);
  },

  updateSubType(paperId, subTypeId, payload) {
    return http.put(`/admin/papers/${paperId}/sub-types/${subTypeId}`, payload);
  },

  deleteSubType(paperId, subTypeId) {
    return http.delete(`/admin/papers/${paperId}/sub-types/${subTypeId}`);
  },

  createMaterial(paperId, payload) {
    return http.post(`/admin/papers/${paperId}/materials`, payload);
  },

  updateMaterial(paperId, materialId, payload) {
    return http.put(`/admin/papers/${paperId}/materials/${materialId}`, payload);
  },

  deleteMaterial(paperId, materialId) {
    return http.delete(`/admin/papers/${paperId}/materials/${materialId}`);
  },

  uploadMaterialImage(paperId, file, metadata = {}) {
    const formData = new FormData();
    formData.append('file', file);

    Object.entries(metadata).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        formData.append(key, value);
      }
    });

    return http.post(`/admin/papers/${paperId}/materials/images`, formData);
  },

  uploadQuestionImage(paperId, file) {
    const formData = new FormData();
    formData.append('file', file);

    return http.post(`/admin/papers/${paperId}/question-images`, formData);
  },

  createQuestion(paperId, payload) {
    return http.post(`/admin/papers/${paperId}/questions`, payload);
  },

  importQuestionsFromPaper(paperId, payload) {
    return http.post(`/admin/papers/${paperId}/questions/import-from-exam`, payload);
  },

  updateQuestion(paperId, questionId, payload) {
    return http.put(`/admin/papers/${paperId}/questions/${questionId}`, payload);
  },

  reorderQuestions(paperId, questionIds) {
    return http.patch(`/admin/papers/${paperId}/questions/reorder`, { questionIds });
  },

  deleteQuestion(paperId, questionId) {
    return http.delete(`/admin/papers/${paperId}/questions/${questionId}`);
  },

  movePaperToGroup(paperId, paperGroupId) {
    return http.patch(`/admin/papers/${paperId}/group`, { paperGroupId });
  },

  uploadPaperSolution(paperId, file, description) {
    const formData = new FormData();
    formData.append('file', file);

    if (description) {
      formData.append('description', description);
    }

    return http.post(`/admin/papers/${paperId}/solutions`, formData);
  },

  async getExams(params = {}, examRows = null) {
    const exams = await (examRows || listExams(SHSAT));
    return exams.map((exam) => ({
      examId: exam.id, id: exam.id, paperId: exam.paperId, paperTitle: exam.paperTitle,
      examTitle: exam.title, title: exam.title, description: exam.description,
      status: exam.status, published: exam.status === 'PUBLISHED', targetType: exam.targetScope,
      targetSummary: exam.targetSummary,
      hasStudentAttempts: exam.hasStudentAttempts,
      startTime: exam.opensAt, endTime: exam.closesAt,
      duration: Math.round((exam.durationSeconds || 0) / 60), attemptLimit: exam.attemptLimit,
      publishedAt: exam.publishedAt,
    })).filter((exam) => !params.keyword || `${exam.title} ${exam.paperTitle}`.toLowerCase().includes(params.keyword.toLowerCase()));
  },

  getExam(examId) {
    return apiRequest(`/api/admin/exams/${examId}`).then(({ summary, classIds, studentUserIds, studentTargets }) => ({
      ...summary,
      examId: summary.id,
      examTitle: summary.title,
      paperName: summary.paperTitle,
      startTime: summary.opensAt,
      endTime: summary.closesAt,
      targetType: summary.targetScope,
      targetSummary: summary.targetSummary,
      target_ids: classIds,
      studentUserIds,
      studentTargets,
      published: summary.status === 'PUBLISHED',
    }));
  },

  async createExam(payload) {
    const created = await createPlatformExam(Number(payload.paperId), {
      title: payload.examTitle, description: payload.examDescription || null,
      opensAt: new Date(payload.startTime).toISOString(), closesAt: new Date(payload.endTime).toISOString(),
      durationSeconds: Math.max(1, Number(payload.duration || 0) * 60),
      attemptLimit: Number(payload.attemptLimit || 1),
      targetScope: payload.targetType === 'ALL_STUDENTS' ? 'ALL_STUDENTS' : 'SELECTED',
      autoSubmit: payload.autoSubmit,
      allowReview: payload.allowReview,
    });
    if (payload.targetType === 'SPECIFIC_CLASSES') {
      try {
        await saveExamTargets(created.summary.id, { classIds: payload.target_ids || [], studentUserIds: payload.studentUserIds || [], studentTargets: payload.studentTargets || [] });
      } catch (error) {
        // 草稿已经创建，调用方重试时应更新该草稿，避免重复创建考试。
        error.draftExamId = created.summary.id;
        throw error;
      }
    }
    return { examId: created.summary.id, ...created.summary };
  },

  async updateExam(examId, payload) {
    const updated = await updatePlatformExam(examId, {
      title: payload.examTitle, description: payload.examDescription || null,
      opensAt: new Date(payload.startTime).toISOString(), closesAt: new Date(payload.endTime).toISOString(),
      durationSeconds: Math.max(1, Number(payload.duration || 0) * 60), attemptLimit: Number(payload.attemptLimit || 1),
      targetScope: payload.targetType === 'ALL_STUDENTS' ? 'ALL_STUDENTS' : 'SELECTED',
      autoSubmit: payload.autoSubmit,
      allowReview: payload.allowReview,
    });
    if (payload.targetType === 'SPECIFIC_CLASSES') {
      await saveExamTargets(examId, { classIds: payload.target_ids || [], studentUserIds: payload.studentUserIds || [], studentTargets: payload.studentTargets || [] });
    }
    return { examId, ...updated.summary };
  },

  publishExam(examId) {
    return publishPlatformExam(examId);
  },

  unpublishExam(examId) {
    return http.post(`/admin/exams/${examId}/unpublish`);
  },

  hideExamRelease(examId) {
    return http.delete(`/admin/exams/${examId}`);
  },

  async getClasses({ force = false } = {}) {
    return (await listClasses(['SHSAT'], { force })).map(classSummary);
  },

  async getClass(classId) {
    const classroom = await apiRequest(`/api/admin/classes/${classId}?examTypeCodes=SHSAT`);
    return classSummary(classroom);
  },

  async createClass(payload) {
    return classSummary(await createPlatformClass(classSavePayload(payload), ['SHSAT']));
  },

  async updateClass(classId, payload) {
    return classSummary(await updatePlatformClass(classId, classSavePayload(payload), ['SHSAT']));
  },

  deleteClass(classId) {
    return deletePlatformClass(classId);
  },

  async reorderClasses(classIds) {
    return (await reorderPlatformClasses(classIds, ['SHSAT'])).map(classSummary);
  },

  async getClassStudents(classId, { force = false } = {}) {
    return (await listClassStudents(classId, ['SHSAT'], { force })).map((student) => ({
      studentId: student.id, id: student.id, username: student.username, studentName: student.realName,
      realName: student.realName, email: student.email, studentNumber: student.username,
      gender: student.gender || '', notes: student.notes || '',
      timeMultiplier: Number(student.timeMultiplier || 1), active: student.active !== false, isActive: student.active !== false,
      averageScore: student.averageScore, examCount: Number(student.examCount || 0),
    }));
  },

  getClassExams(classId) {
    return http.get(`/admin/classes/${classId}/exams`);
  },

  updateStudent(classId, studentId, payload) {
    return http.put(`/admin/classes/${classId}/students/${studentId}`, {
      studentName: payload.studentName, classId: Number(payload.classId || classId),
      gender: payload.gender || null, notes: payload.notes || null,
      timeMultiplier: Number(payload.timeMultiplier || 1), active: payload.active !== false,
    });
  },

  removeStudentFromClass(classId, studentId) {
    return removeClassStudent(classId, studentId);
  },

  createUser(payload) {
    return createPlatformUser({
      username: usernameFromFullName(payload.realName), password: DEFAULT_INITIAL_PASSWORD,
      realName: payload.realName, roleCode: payload.role, email: payload.email || null, phone: payload.phone || null,
      workspaceCodes: ['SHSAT'],
    });
  },

  async getUnassignedStudentAccounts({ force = false } = {}) {
    return (await this.getAvailableStudentAccounts({ force })).filter((student) => !student.classNames);
  },

  async getAvailableStudentAccounts({ force = false } = {}) {
    return (await listAvailableStudents({ examTypeCode: 'SHSAT', force })).map((student) => ({
      userId: student.id,
      studentId: student.id,
      username: student.username,
      realName: student.realName,
      email: student.email,
      classNames: student.classNames || '',
    }));
  },

  assignStudentAccountToClass(userId, classId) {
    return addClassStudent(classId, userId);
  },

  addStudentsToClass(classId, studentIds) {
    return addClassStudents(classId, studentIds);
  },

  getClassExamScores(examId, classId) {
    return http.get(`/admin/reports/exams/${examId}/classes/${classId}`);
  },

  createWrongAnswerTask(payload) {
    return http.post('/admin/wrong-answer-tasks', payload);
  },

  getWrongAnswerTasks(examId = undefined, classId = undefined, { force = false } = {}) {
    const params = new URLSearchParams();
    if (examId !== undefined) params.set('examId', examId);
    if (classId !== undefined) params.set('classId', classId);
    return cachedResource(`/api/admin/wrong-answer-tasks${params.size ? `?${params}` : ''}`, ['review:SHSAT'], 30_000, { force });
  },

  endWrongAnswerTask(taskId) {
    return http.post(`/admin/wrong-answer-tasks/${taskId}/end`);
  },

  getWrongAnswerTask(taskId) {
    return http.get(`/admin/wrong-answer-tasks/${taskId}`);
  },

  getStudentAttemptHistory(studentId, classId, options = {}) {
    const query = new URLSearchParams({ classId: String(classId) });
    return cachedResource(`/api/admin/reports/students/${studentId}/attempts?${query}`, ['student', 'class:SHSAT'], 30_000, options);
  },

  getAttemptResult(attemptId) {
    return http.get(`/admin/reports/attempts/${attemptId}/result`);
  },

  getExamMonitorLive(examId, options = {}) {
    return http.get(`/admin/reports/exams/${examId}/monitor/live`, options);
  },

  getExamMonitorAnalytics(examId, options = {}) {
    return http.get(`/admin/reports/exams/${examId}/monitor/analytics`, options);
  },

  getExamMonitorQuestion(examId, questionNumber) {
    return http.get(`/admin/reports/exams/${examId}/monitor/questions/${questionNumber}`);
  },
};
