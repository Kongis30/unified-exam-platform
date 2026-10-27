<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';

import AppButton from '@/components/AppButton.vue';
import AppCard from '@/components/AppCard.vue';
import ClassExamScoreTrend from '@/components/admin/ClassExamScoreTrend.vue';
import AdminLayout from '@/components/admin/AdminLayout.vue';
import { adminApi } from '@shsat/admin/services/adminApi';

const route = useRoute();
const router = useRouter();

const loading = ref(false);
const errorMessage = ref('');
const formError = ref('');
const classToast = ref('');
const showClassModal = ref(false);
const submittingClass = ref(false);
const showStudentModal = ref(false);
const showAddStudentsModal = ref(false);
const availableStudentAccounts = ref([]);
const selectedStudentIds = ref([]);
const studentSearch = ref('');
const addStudentsError = ref('');
const loadingAvailableStudents = ref(false);
const addingStudents = ref(false);
const studentFormError = ref('');
const editingStudentId = ref('');
const submittingStudent = ref(false);
const studentRosterNotice = ref('');
const studentRemovalError = ref('');
const showStudentRemovalModal = ref(false);
const studentPendingRemoval = ref(null);
const removingStudent = ref(false);
const classInfo = ref(null);
const classes = ref([]);
const exams = ref([]);
const students = ref([]);
const examKeyword = ref('');
let classToastTimer = null;

const classId = computed(() => route.params.classId);
let restoringClassExamState = false;

function classExamStateKey() {
  return `shsat-class-exams:${classId.value}`;
}

const examFilters = reactive({
  sortBy: 'start-desc',
  page: 1,
  pageSize: 10,
});

const classForm = reactive({
  className: '',
  classDescription: '',
  teacherName: '',
  teacherEmail: '',
  gradeLevel: '',
  academicYear: '',
  active: true,
});

const studentForm = reactive({
  classId: '',
  studentName: '',
  gender: '',
  notes: '',
  timeMultiplier: 1,
  active: true,
});

// SHSAT accommodation: standard students run at 1x (180 min); ELL/extended-time get 2x (360 min).
const timeMultiplierOptions = [
  { value: 1, label: 'Standard time (180 min)' },
  { value: 2, label: 'Extended time / ELL (360 min)' },
];

const genderOptions = [
  { value: '', label: 'Not specified' },
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
  { value: 'Other', label: 'Other' },
];

const relatedClassExams = computed(() => {
  const keyword = examKeyword.value.trim().toLowerCase();

  const filtered = exams.value
    .filter((exam) => {
      if (!keyword) {
        return true;
      }

      return [
        exam.examTitle,
        exam.paperName,
        exam.targetType,
        formatExamTarget(exam),
      ].some((value) => String(value || '').toLowerCase().includes(keyword));
    });

  return filtered.sort((a, b) => {
    const leftTime = getTimeValue(a.startTime);
    const rightTime = getTimeValue(b.startTime);

    return examFilters.sortBy === 'start-asc' ? leftTime - rightTime : rightTime - leftTime;
  });
});

const classExamTotalPages = computed(() => {
  return Math.max(1, Math.ceil(relatedClassExams.value.length / Number(examFilters.pageSize || 10)));
});

const paginatedClassExams = computed(() => {
  const pageSize = Number(examFilters.pageSize || 10);
  const currentPage = Math.min(examFilters.page, classExamTotalPages.value);
  const start = (currentPage - 1) * pageSize;

  return relatedClassExams.value.slice(start, start + pageSize);
});

const selectableStudents = computed(() => {
  const currentIds = new Set(students.value.map((student) => String(student.studentId || student.id)));
  const keyword = studentSearch.value.trim().toLowerCase();
  return availableStudentAccounts.value
    .filter((student) => !currentIds.has(String(student.userId)))
    .filter((student) => !keyword || [student.realName, student.username, student.email, student.classNames]
      .some((value) => String(value || '').toLowerCase().includes(keyword)));
});

const allSelectableStudentsSelected = computed(() => (
  selectableStudents.value.length > 0
  && selectableStudents.value.every((student) => selectedStudentIds.value.includes(String(student.userId)))
));

const classExamPageStart = computed(() => {
  if (relatedClassExams.value.length === 0) {
    return 0;
  }

  return (Math.min(examFilters.page, classExamTotalPages.value) - 1) * Number(examFilters.pageSize || 10) + 1;
});

const classExamPageEnd = computed(() => {
  return Math.min(
    relatedClassExams.value.length,
    classExamPageStart.value + paginatedClassExams.value.length - 1,
  );
});

const summary = computed(() => ({
  students: classInfo.value?.studentCount || students.value.length || 0,
  exams: classInfo.value?.examCount || classInfo.value?.participatedExamCount || relatedClassExams.value.length,
  average: formatNumber(getClassAverage(classInfo.value)),
  teacher: classInfo.value?.teacherName || '-',
  grade: classInfo.value?.gradeLevel || '-',
  academicYear: classInfo.value?.academicYear || '-',
}));

const assignableClasses = computed(() => {
  return classes.value.filter((item) => item.className !== 'Unassigned Students');
});

const studentPendingRemovalName = computed(() => {
  return getStudentName(studentPendingRemoval.value);
});

const canConfirmStudentRemoval = computed(() => {
  return Boolean(studentPendingRemoval.value) && !removingStudent.value;
});

function unwrapResponse(response, fallbackMessage) {
  if (response?.success === false) {
    throw new Error(response.message || fallbackMessage);
  }

  return response?.data ?? response;
}

function unwrapListResponse(response, fallbackMessage) {
  const payload = unwrapResponse(response, fallbackMessage);

  if (Array.isArray(payload)) {
    return payload;
  }

  return payload?.items || payload?.records || payload?.list || payload?.content || [];
}

async function loadPage() {
  loading.value = true;
  errorMessage.value = '';

  try {
    const [classResponse, examResponse, studentResponse, classListResponse] = await Promise.all([
      adminApi.getClass(classId.value),
      adminApi.getClassExams(classId.value),
      adminApi.getClassStudents(classId.value),
      adminApi.getClasses(),
    ]);

    classInfo.value = unwrapResponse(classResponse, 'Failed to load class details');
    exams.value = unwrapListResponse(examResponse, 'Failed to load exams');
    students.value = unwrapListResponse(studentResponse, 'Failed to load students');
    classes.value = unwrapListResponse(classListResponse, 'Failed to load classes');
  } catch (error) {
    errorMessage.value = error.message || 'Failed to load class details. Please try again later.';
  } finally {
    loading.value = false;
  }
}

function goBack() {
  router.push({ name: 'shsat-admin', query: { tab: 'classes' } });
}

function resetClassExamPage() {
  examFilters.page = 1;
}

// 班级详情跳转成绩或监考页时保存列表条件，返回后由同一班级恢复。
function saveClassExamState() {
  try {
    window.sessionStorage.setItem(classExamStateKey(), JSON.stringify({
      keyword: examKeyword.value,
      sortBy: examFilters.sortBy,
      page: examFilters.page,
      pageSize: examFilters.pageSize,
    }));
  } catch {
    // 隐私浏览或存储空间受限时仍允许正常导航。
  }
}

function restoreClassExamState() {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(classExamStateKey()) || 'null');
    if (!saved || typeof saved !== 'object') return;

    restoringClassExamState = true;
    examKeyword.value = typeof saved.keyword === 'string' ? saved.keyword.slice(0, 200) : '';
    examFilters.sortBy = ['start-asc', 'start-desc'].includes(saved.sortBy) ? saved.sortBy : 'start-desc';
    examFilters.page = Number.isInteger(saved.page) && saved.page > 0 ? saved.page : 1;
    examFilters.pageSize = [5, 10, 20].includes(saved.pageSize) ? saved.pageSize : 10;
  } catch {
    // 损坏或不可读的旧状态按默认列表显示。
  } finally {
    restoringClassExamState = false;
  }
}

function goClassExamPage(page) {
  examFilters.page = Math.min(Math.max(1, page), classExamTotalPages.value);
}

function openEditClassModal() {
  const item = classInfo.value || {};

  closeClassToast();
  formError.value = '';
  Object.assign(classForm, {
    className: item.className || '',
    classDescription: item.classDescription || '',
    teacherName: item.teacherName || '',
    teacherEmail: item.teacherEmail || '',
    gradeLevel: item.gradeLevel || '',
    academicYear: item.academicYear || '',
    active: getClassActiveState(item),
  });
  showClassModal.value = true;
}

function closeClassModal() {
  if (submittingClass.value) {
    return;
  }

  showClassModal.value = false;
  formError.value = '';
}

function closeClassToast() {
  if (classToastTimer) {
    window.clearTimeout(classToastTimer);
    classToastTimer = null;
  }
  classToast.value = '';
}

function showClassToast(message) {
  closeClassToast();
  classToast.value = message;
  classToastTimer = window.setTimeout(closeClassToast, 3_500);
}

async function submitClass() {
  formError.value = '';

  if (!classForm.className.trim()) {
    formError.value = 'Class name is required.';
    return;
  }

  submittingClass.value = true;

  try {
    classInfo.value = unwrapResponse(
      await adminApi.updateClass(classId.value, { ...classForm }),
      'Failed to update class'
    );
    showClassToast('Class updated.');
    showClassModal.value = false;
  } catch (error) {
    formError.value = error.message || 'Failed to update class';
  } finally {
    submittingClass.value = false;
  }
}

function viewClassExamScores(exam) {
  if (!exam?.examId) {
    return;
  }

  router.push({
    name: 'admin-class-exam-results',
    params: {
      classId: classId.value,
      examId: exam.examId,
    },
  });
}

function openExamMonitor(exam) {
  if (!exam?.examId) {
    return;
  }

  router.push({
    name: 'admin-exam-monitor',
    params: { examId: String(exam.examId) },
  });
}

function getStudentId(student) {
  return student?.studentId || student?.id || '';
}

async function openAddStudentsModal() {
  closeClassToast();
  showAddStudentsModal.value = true;
  availableStudentAccounts.value = [];
  selectedStudentIds.value = [];
  studentSearch.value = '';
  addStudentsError.value = '';
  loadingAvailableStudents.value = true;
  try {
    availableStudentAccounts.value = unwrapListResponse(
      await adminApi.getAvailableStudentAccounts(),
      'Failed to load student accounts',
    );
  } catch (error) {
    addStudentsError.value = error.message || 'Failed to load student accounts.';
  } finally {
    loadingAvailableStudents.value = false;
  }
}

function toggleStudentSelection(studentId, checked) {
  const id = String(studentId);
  selectedStudentIds.value = checked
    ? [...new Set([...selectedStudentIds.value, id])]
    : selectedStudentIds.value.filter((selectedId) => selectedId !== id);
}

function toggleAllSelectableStudents(checked) {
  const visibleIds = selectableStudents.value.map((student) => String(student.userId));
  const selected = new Set(selectedStudentIds.value);
  visibleIds.forEach((id) => checked ? selected.add(id) : selected.delete(id));
  selectedStudentIds.value = [...selected];
}

async function submitAddStudents() {
  if (!selectedStudentIds.value.length || addingStudents.value) return;
  addingStudents.value = true;
  addStudentsError.value = '';
  try {
    const addedCount = selectedStudentIds.value.length;
    await adminApi.addStudentsToClass(classId.value, selectedStudentIds.value);
    showAddStudentsModal.value = false;
    selectedStudentIds.value = [];
    studentRosterNotice.value = `${addedCount} student${addedCount === 1 ? '' : 's'} added to this class.`;
    await loadPage();
  } catch (error) {
    addStudentsError.value = error.message || 'Failed to add students.';
  } finally {
    addingStudents.value = false;
  }
}

function closeAddStudentsModal() {
  if (addingStudents.value) return;
  showAddStudentsModal.value = false;
  addStudentsError.value = '';
}

function openStudentDetail(student) {
  const studentDetailId = getStudentId(student);

  if (!studentDetailId) {
    return;
  }

  router.push({
    name: 'admin-student-detail',
    params: { classId: classId.value, studentId: String(studentDetailId) },
    query: {
      studentName: student.studentName || student.name || '',
      studentNumber: student.studentNumber || '',
      className: classInfo.value?.className || '',
      returnTo: route.fullPath,
      returnLabel: 'Back to Class Detail',
    },
  });
}

function openEditStudentModal(student) {
  if (!student) {
    return;
  }

  closeClassToast();
  editingStudentId.value = String(student.studentId || student.id || '');
  studentFormError.value = '';
  Object.assign(studentForm, {
    classId: String(student.classId || classId.value),
    studentName: student.studentName || student.name || '',
    gender: normalizeGender(student.gender),
    notes: student.notes || '',
    timeMultiplier: normalizeTimeMultiplier(student.timeMultiplier),
    active: student.isActive !== false && student.active !== false,
  });
  showStudentModal.value = true;
}

function closeStudentModal() {
  if (submittingStudent.value) {
    return;
  }

  showStudentModal.value = false;
  editingStudentId.value = '';
  studentFormError.value = '';
}

function openStudentRemovalModal(student) {
  if (!getStudentId(student)) {
    return;
  }

  closeClassToast();
  studentPendingRemoval.value = student;
  studentRemovalError.value = '';
  showStudentRemovalModal.value = true;
}

function closeStudentRemovalModal() {
  if (removingStudent.value) {
    return;
  }

  showStudentRemovalModal.value = false;
  studentPendingRemoval.value = null;
  studentRemovalError.value = '';
}

async function confirmStudentRemoval() {
  const student = studentPendingRemoval.value;
  const studentId = getStudentId(student);

  if (!studentId || !canConfirmStudentRemoval.value) {
    return;
  }

  removingStudent.value = true;
  studentRemovalError.value = '';

  try {
    const studentName = getStudentName(student);
    unwrapResponse(
      await adminApi.removeStudentFromClass(classId.value, studentId),
      'Failed to remove student from this class'
    );
    showStudentRemovalModal.value = false;
    studentPendingRemoval.value = null;
    await loadPage();
    showClassToast(`${studentName} was removed from this class.`);
  } catch (error) {
    studentRemovalError.value = error.message || 'Failed to remove student from this class. Please try again.';
  } finally {
    removingStudent.value = false;
  }
}

async function submitStudent() {
  studentFormError.value = '';

  if (!studentForm.studentName.trim()) {
    studentFormError.value = 'Student name is required.';
    return;
  }

  if (!studentForm.classId) {
    studentFormError.value = 'Class is required.';
    return;
  }

  if (!editingStudentId.value) {
    studentFormError.value = 'Select a student to edit.';
    return;
  }

  submittingStudent.value = true;

  try {
    await adminApi.updateStudent(classId.value, editingStudentId.value, {
      classId: Number(studentForm.classId),
      studentName: studentForm.studentName,
      gender: studentForm.gender,
      notes: studentForm.notes,
      timeMultiplier: studentForm.timeMultiplier,
      active: studentForm.active,
    });
    await loadPage();
    showStudentModal.value = false;
    editingStudentId.value = '';
    showClassToast('Student details updated.');
  } catch (error) {
    studentFormError.value = error.message || 'Failed to save student';
  } finally {
    submittingStudent.value = false;
  }
}

function normalizeTimeMultiplier(value) {
  const multiplier = Number(value);
  return Number.isFinite(multiplier) && multiplier >= 1 ? multiplier : 1;
}

function normalizeGender(value) {
  const gender = String(value || '').trim();
  const lowerGender = gender.toLowerCase();

  if (!gender) {
    return '';
  }

  if (['male', 'm'].includes(lowerGender)) {
    return 'Male';
  }

  if (['female', 'f'].includes(lowerGender)) {
    return 'Female';
  }

  if (['other', 'non-binary', 'nonbinary'].includes(lowerGender)) {
    return 'Other';
  }

  return '';
}

function getExamTargetIds(exam) {
  const rawIds = exam?.target_ids || exam?.targetIds || exam?.targetClassIds || [];

  if (Array.isArray(rawIds)) {
    return rawIds.map(Number).filter((value) => Number.isFinite(value));
  }

  return String(rawIds || '')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value));
}

function formatExamTarget(exam) {
  const targetType = String(exam?.targetType || 'ALL_STUDENTS');
  const ids = getExamTargetIds(exam);

  if (targetType === 'ALL_STUDENTS') {
    return 'All students';
  }

  if (targetType === 'SPECIFIC_CLASSES') {
    return ids.length ? `Classes: ${ids.join(', ')}` : 'Specific classes';
  }

  if (targetType === 'SPECIFIC_STUDENTS') {
    return 'Selected students';
  }

  return targetType;
}

function formatClassExamMeta(exam) {
  const title = String(exam?.examTitle || '').trim();
  const paperName = String(exam?.paperName || '').trim();
  const meta = [];

  if (paperName && paperName !== title && !/^\d+$/.test(title)) {
    meta.push(`Paper: ${paperName}`);
  }

  const target = formatExamTarget(exam);

  if (target) {
    meta.push(target);
  }

  return meta.filter(Boolean);
}

function getClassExamStatus(exam) {
  if (exam?.published === false) {
    return {
      label: 'Hidden',
      className: 'exam-status-pill--hidden',
    };
  }

  const now = Date.now();
  const startTime = getTimeValue(exam?.startTime);
  const endTime = getTimeValue(exam?.endTime);

  if (endTime && now > endTime) {
    return {
      label: 'Ended',
      className: 'exam-status-pill--ended',
    };
  }

  if (startTime && now < startTime) {
    return {
      label: 'Scheduled',
      className: 'exam-status-pill--scheduled',
    };
  }

  if (startTime && (!endTime || now <= endTime)) {
    return {
      label: 'Live',
      className: 'exam-status-pill--live',
    };
  }

  const status = String(exam?.status || '').trim();

  return {
    label: status || 'Not set',
    className: status ? 'exam-status-pill--neutral' : 'exam-status-pill--muted',
  };
}

function getClassAverage(item) {
  return item?.averageScore ?? item?.avgScore;
}

function getClassActiveState(item) {
  return item?.isActive ?? item?.active ?? true;
}

function getStudentName(student) {
  return student?.studentName || student?.name || 'Unnamed student';
}

function getStudentExamCount(student) {
  const count = Number(student?.examCount || 0);
  return Number.isFinite(count) ? Math.max(0, count) : 0;
}

function getStudentAverageText(student) {
  if (getStudentExamCount(student) === 0) {
    return 'No data';
  }

  return formatNumber(student?.averageScore ?? student?.avgScore);
}

function getStudentStatus(student) {
  const active = student?.isActive !== false && student?.active !== false;

  return {
    active,
    label: active ? 'Active' : 'Inactive',
  };
}

function getTimeValue(value) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

function formatDateTime(value) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value).replace('T', ' ');
  }

  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function getClassExamDisplayTitle(exam) {
  const title = String(exam?.examTitle || '').trim();
  const paperName = String(exam?.paperName || '').trim();

  if (/^\d+$/.test(title) && paperName) {
    return paperName;
  }

  return title || paperName || 'Untitled exam';
}

function formatNumber(value) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) {
    return '-';
  }

  return Number(value).toFixed(2).replace(/\.00$/, '');
}

watch(
  () => [
    examKeyword.value,
    examFilters.sortBy,
    examFilters.pageSize,
  ],
  () => {
    if (!restoringClassExamState) resetClassExamPage();
  },
  { flush: 'sync' },
);

watch(classExamTotalPages, (totalPages) => {
  if (examFilters.page > totalPages) {
    examFilters.page = totalPages;
  }
});

onMounted(() => {
  restoreClassExamState();
  loadPage();
});
onBeforeRouteUpdate(saveClassExamState);
onBeforeRouteLeave(saveClassExamState);
watch(classId, () => {
  restoreClassExamState();
  loadPage();
});
onBeforeUnmount(() => {
  saveClassExamState();
  closeClassToast();
});
</script>

<template>
  <AdminLayout>
    <section class="page-shell class-detail-page">
      <Teleport to="body">
        <div v-if="classToast" class="class-detail-toast" role="status" aria-live="polite">
          <div>
            <strong>Success</strong>
            <p>{{ classToast }}</p>
          </div>
          <button type="button" aria-label="Close notification" @click="closeClassToast">&times;</button>
        </div>
      </Teleport>

      <section class="class-detail-hero">
        <div class="class-detail-hero__top">
          <button class="class-back-button" type="button" @click="goBack">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M15 18 9 12l6-6"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span>Back to Classes</span>
          </button>
          <div class="class-detail-hero__actions">
            <AppButton variant="secondary" @click="openEditClassModal">Edit Class</AppButton>
            <button
              class="icon-refresh-button"
              :class="{ 'icon-refresh-button--loading': loading }"
              type="button"
              :disabled="loading"
              aria-label="Refresh class detail"
              title="Refresh class detail"
              @click="loadPage"
            >
              <svg class="icon-refresh-button__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M12 5a7 7 0 0 0-6.32 4H3.5A9 9 0 0 1 19 6.64V4h2v6h-6V8h2.7A6.98 6.98 0 0 0 12 5Zm6.32 10H20.5A9 9 0 0 1 5 17.36V20H3v-6h6v2H6.3A6.98 6.98 0 0 0 12 19a7 7 0 0 0 6.32-4Z" />
              </svg>
            </button>
          </div>
        </div>

        <div class="class-detail-hero__main">
          <div>
            <p class="admin-eyebrow">Class Detail</p>
            <h1>{{ classInfo?.className || `Class #${classId}` }}</h1>
            <p>{{ classInfo?.classDescription || 'No description provided for this class.' }}</p>
          </div>
          <span class="status-pill" :class="{ 'status-pill--on': getClassActiveState(classInfo) }">
            {{ getClassActiveState(classInfo) ? 'Active' : 'Inactive' }}
          </span>
        </div>

        <dl class="class-detail-summary">
          <div>
            <dt>Students</dt>
            <dd>{{ summary.students }}</dd>
          </div>
          <div>
            <dt>Exams</dt>
            <dd>{{ summary.exams }}</dd>
          </div>
          <div>
            <dt>Average</dt>
            <dd>{{ summary.average }}</dd>
          </div>
          <div>
            <dt>Teacher</dt>
            <dd>{{ summary.teacher }}</dd>
          </div>
          <div>
            <dt>Grade</dt>
            <dd>{{ summary.grade }}</dd>
          </div>
          <div>
            <dt>Academic Year</dt>
            <dd>{{ summary.academicYear }}</dd>
          </div>
        </dl>
      </section>

      <AppCard v-if="loading" title="Loading Class">
        <div class="admin-state">Loading class detail...</div>
      </AppCard>

      <AppCard v-else-if="errorMessage" title="Unable to Load Class">
        <div class="admin-state admin-state--error">
          <p class="error-text">{{ errorMessage }}</p>
          <AppButton variant="secondary" @click="loadPage">Retry</AppButton>
        </div>
      </AppCard>

      <template v-else>
        <ClassExamScoreTrend :class-id="classId" :exam-type-codes="['SHSAT']" />

        <AppCard class="class-exams-card" title="Class Exams" subtitle="Review the exams that students in this class have actually taken.">
          <div class="admin-toolbar class-exams-toolbar">
            <div class="class-exams-toolbar__search">
              <input v-model="examKeyword" class="form-input class-search-input" placeholder="Search by exam name or paper" />
            </div>
            <div class="admin-toolbar__filters">
              <select v-model="examFilters.sortBy" class="form-input form-input--compact" aria-label="Sort class exams">
                <option value="start-desc">Start time: newest first</option>
                <option value="start-asc">Start time: oldest first</option>
              </select>
              <select v-model.number="examFilters.pageSize" class="form-input form-input--compact" aria-label="Class exam rows per page">
                <option :value="5">5 rows</option>
                <option :value="10">10 rows</option>
                <option :value="20">20 rows</option>
              </select>
            </div>
          </div>

          <div v-if="relatedClassExams.length === 0" class="admin-state class-exam-empty-state">
            <strong>No class exams yet</strong>
            <span>No students in this class have started an exam yet. Once they participate, the exam will appear here.</span>
          </div>
          <div v-else class="table-wrap class-exam-table-wrap">
            <table class="admin-table class-exam-table">
              <colgroup>
                <col class="class-exam-table__exam-column" />
                <col class="class-exam-table__time-column" />
                <col class="class-exam-table__time-column" />
                <col class="class-exam-table__status-column" />
                <col class="class-exam-table__actions-column" />
              </colgroup>
              <thead>
                <tr>
                  <th>Exam</th>
                  <th>Opens</th>
                  <th>Closes</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="exam in paginatedClassExams" :key="exam.examId">
                  <td class="class-exam-table__exam-cell">
                    <strong class="class-exam-table__exam-title">{{ getClassExamDisplayTitle(exam) }}</strong>
                    <div class="class-exam-meta">
                      <span
                        v-for="item in formatClassExamMeta(exam)"
                        :key="`${exam.examId}-${item}`"
                        class="class-exam-meta__item"
                      >
                        {{ item }}
                      </span>
                    </div>
                  </td>
                  <td class="class-exam-table__time-cell class-exam-table__meta-cell class-exam-table__opens-cell">{{ formatDateTime(exam.startTime) }}</td>
                  <td class="class-exam-table__time-cell class-exam-table__meta-cell class-exam-table__closes-cell">{{ formatDateTime(exam.endTime) }}</td>
                  <td class="class-exam-table__status-cell">
                    <span class="exam-status-pill" :class="getClassExamStatus(exam).className">
                      {{ getClassExamStatus(exam).label }}
                    </span>
                  </td>
                  <td class="class-exam-table__actions-cell class-exam-table__meta-cell">
                    <div class="class-exam-table__actions">
                      <AppButton class="class-exam-result-button" @click="viewClassExamScores(exam)">View Results</AppButton>
                      <AppButton class="class-exam-monitor-button" variant="secondary" @click="openExamMonitor(exam)">Monitor</AppButton>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <div class="table-pagination">
              <span>
                Showing {{ classExamPageStart }}-{{ classExamPageEnd }} of {{ relatedClassExams.length }}
              </span>
              <div class="table-pagination__actions">
                <button
                  type="button"
                  :disabled="examFilters.page <= 1"
                  @click="goClassExamPage(examFilters.page - 1)"
                >
                  Prev
                </button>
                <span>Page {{ examFilters.page }} / {{ classExamTotalPages }}</span>
                <button
                  type="button"
                  :disabled="examFilters.page >= classExamTotalPages"
                  @click="goClassExamPage(examFilters.page + 1)"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </AppCard>

        <AppCard title="Students" subtitle="Add students from any class, then view their exam history and score trend.">
          <template #actions>
            <AppButton @click="openAddStudentsModal">Add Students</AppButton>
          </template>
          <p v-if="studentRosterNotice" class="success-text student-removal-notice" role="status">{{ studentRosterNotice }}</p>
          <div v-if="students.length === 0" class="admin-state">
            No students assigned yet. Add an existing student account to this class.
          </div>
          <div v-else class="table-wrap student-table-wrap">
            <table class="admin-table student-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Average</th>
                  <th>Exam Count</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="student in students"
                  :key="student.studentId || student.id"
                  class="admin-table__row--clickable"
                  title="View student detail"
                  @click="openStudentDetail(student)"
                >
                  <td>
                    <strong>{{ getStudentName(student) }}</strong>
                    <small>{{ student.studentNumber ? `Student No. ${student.studentNumber}` : 'No student number' }}</small>
                  </td>
                  <td>
                    <span :class="{ 'student-table__empty-value': getStudentExamCount(student) === 0 }">
                      {{ getStudentAverageText(student) }}
                    </span>
                  </td>
                  <td>
                    <span :class="{ 'student-table__empty-value': getStudentExamCount(student) === 0 }">
                      {{ getStudentExamCount(student) || 'No exams' }}
                    </span>
                  </td>
                  <td>
                    <span
                      class="student-status-pill"
                      :class="{ 'student-status-pill--active': getStudentStatus(student).active }"
                    >
                      {{ getStudentStatus(student).label }}
                    </span>
                  </td>
                  <td class="student-table__actions-cell">
                    <div class="row-actions student-row-actions">
                      <AppButton class="student-action-button" variant="secondary" @click.stop="openStudentDetail(student)">View</AppButton>
                      <AppButton class="student-action-button student-action-button--quiet" variant="secondary" @click.stop="openEditStudentModal(student)">Edit</AppButton>
                      <AppButton class="student-action-button student-action-button--danger" variant="secondary" @click.stop="openStudentRemovalModal(student)">Remove</AppButton>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </AppCard>
      </template>

      <Teleport to="body">
        <div v-if="showAddStudentsModal" class="modal-backdrop" @click.self="closeAddStudentsModal">
          <section class="modal-card modal-card--wide add-students-modal" role="dialog" aria-modal="true" aria-labelledby="add-students-title">
            <header class="modal-card__header">
              <div>
                <h3 id="add-students-title">Add Students</h3>
                <p>Select one or more accounts. Current class memberships are shown for reference.</p>
              </div>
              <button class="modal-card__close" type="button" aria-label="Close add students dialog" @click="closeAddStudentsModal">&times;</button>
            </header>

            <label class="form-field add-students-search">
              <span class="form-label">Search students</span>
              <input v-model="studentSearch" class="form-input" placeholder="Search name, username, email, or class" />
            </label>

            <div v-if="loadingAvailableStudents" class="admin-state">Loading student accounts...</div>
            <div v-else-if="addStudentsError && availableStudentAccounts.length === 0" class="admin-state admin-state--error">{{ addStudentsError }}</div>
            <div v-else-if="selectableStudents.length === 0" class="admin-state">No matching students to add.</div>
            <div v-else class="table-wrap add-students-table-wrap">
              <table class="admin-table add-students-table">
                <thead>
                  <tr>
                    <th class="add-students-table__select">
                      <input type="checkbox" aria-label="Select all visible students" :checked="allSelectableStudentsSelected" @change="toggleAllSelectableStudents($event.target.checked)" />
                    </th>
                    <th>Student</th>
                    <th>Username</th>
                    <th>Current Classes</th>
                    <th>Email</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="student in selectableStudents" :key="student.userId">
                    <td class="add-students-table__select">
                      <input type="checkbox" :aria-label="`Select ${student.realName || student.username}`" :checked="selectedStudentIds.includes(String(student.userId))" @change="toggleStudentSelection(student.userId, $event.target.checked)" />
                    </td>
                    <td>{{ student.realName || 'Unnamed student' }}</td>
                    <td>{{ student.username }}</td>
                    <td>{{ student.classNames || 'No classes yet' }}</td>
                    <td>{{ student.email || '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p v-if="addStudentsError && availableStudentAccounts.length" class="error-text">{{ addStudentsError }}</p>
            <footer class="modal-card__footer">
              <span class="add-students-selected">{{ selectedStudentIds.length }} selected</span>
              <AppButton variant="secondary" :disabled="addingStudents" @click="closeAddStudentsModal">Cancel</AppButton>
              <AppButton :disabled="!selectedStudentIds.length || addingStudents" @click="submitAddStudents">
                {{ addingStudents ? 'Adding...' : (selectedStudentIds.length === 1 ? 'Add 1 Student' : `Add ${selectedStudentIds.length} Students`) }}
              </AppButton>
            </footer>
          </section>
        </div>
      </Teleport>

      <Teleport to="body">
        <div v-if="showClassModal" class="modal-backdrop" @click.self="closeClassModal">
          <form class="modal-card modal-card--wide" novalidate @submit.prevent="submitClass">
            <header class="modal-card__header">
              <div>
                <h3>Edit Class</h3>
                <p>Update the class profile shown on the detail page.</p>
              </div>
              <button class="modal-card__close" type="button" aria-label="Close class dialog" @click="closeClassModal">
                &times;
              </button>
            </header>

            <div class="modal-form-grid">
              <label class="form-field">
                <span class="form-label">Class Name</span>
                <input v-model="classForm.className" class="form-input" placeholder="e.g. Grade 8 Class A" />
              </label>
              <label class="form-field">
                <span class="form-label">Teacher</span>
                <input v-model="classForm.teacherName" class="form-input" placeholder="Optional" />
              </label>
              <label class="form-field">
                <span class="form-label">Teacher Email</span>
                <input v-model="classForm.teacherEmail" class="form-input" placeholder="Optional" />
              </label>
              <label class="form-field">
                <span class="form-label">Grade Level</span>
                <input v-model="classForm.gradeLevel" class="form-input" placeholder="Optional" />
              </label>
              <label class="form-field">
                <span class="form-label">Academic Year</span>
                <input v-model="classForm.academicYear" class="form-input" placeholder="Optional" />
              </label>
              <label class="form-field form-field--wide">
                <span class="form-label">Description</span>
                <textarea v-model="classForm.classDescription" class="form-input" rows="3"></textarea>
              </label>
              <label class="check-line"><input v-model="classForm.active" type="checkbox" /> Active class</label>
            </div>

            <p v-if="formError" class="error-text">{{ formError }}</p>

            <footer class="modal-card__footer">
              <AppButton variant="secondary" type="button" @click="closeClassModal">Cancel</AppButton>
              <AppButton type="submit" :disabled="submittingClass">
                {{ submittingClass ? 'Saving...' : 'Save Changes' }}
              </AppButton>
            </footer>
          </form>
        </div>
      </Teleport>

      <Teleport to="body">
        <div v-if="showStudentModal" class="modal-backdrop" @click.self="closeStudentModal">
          <form class="modal-card modal-card--wide" novalidate @submit.prevent="submitStudent">
            <header class="modal-card__header">
              <div>
                <h3>Edit Student</h3>
                <p>Update roster information for {{ classInfo?.className || 'this class' }}.</p>
              </div>
              <button class="modal-card__close" type="button" aria-label="Close student dialog" @click="closeStudentModal">
                &times;
              </button>
            </header>

            <div class="modal-form-grid">
              <label class="form-field">
                <span class="form-label">Student Name</span>
                <input v-model="studentForm.studentName" class="form-input" placeholder="e.g. Alex Johnson" />
              </label>
              <label class="form-field">
                <span class="form-label">Class</span>
                <select v-model="studentForm.classId" class="form-input">
                  <option v-for="item in assignableClasses" :key="item.classId" :value="String(item.classId)">
                    {{ item.className }}
                  </option>
                </select>
              </label>
              <label class="form-field">
                <span class="form-label">Gender</span>
                <select v-model="studentForm.gender" class="form-input">
                  <option v-for="option in genderOptions" :key="option.value || 'empty-gender'" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </label>
              <label class="form-field">
                <span class="form-label">Testing Time</span>
                <select v-model.number="studentForm.timeMultiplier" class="form-input">
                  <option v-for="option in timeMultiplierOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </label>
              <label class="form-field form-field--wide">
                <span class="form-label">Notes</span>
                <textarea v-model="studentForm.notes" class="form-input" rows="3"></textarea>
              </label>
              <label class="check-line"><input v-model="studentForm.active" type="checkbox" /> Active student</label>
            </div>

            <p v-if="studentFormError" class="error-text">{{ studentFormError }}</p>
            <footer class="modal-card__footer">
              <AppButton variant="secondary" type="button" @click="closeStudentModal">Cancel</AppButton>
              <AppButton type="submit" :disabled="submittingStudent">
                {{ submittingStudent ? 'Saving...' : 'Save Changes' }}
              </AppButton>
            </footer>
          </form>
        </div>
      </Teleport>

      <Teleport to="body">
        <div v-if="showStudentRemovalModal" class="modal-backdrop" @click.self="closeStudentRemovalModal">
          <section class="modal-card student-removal-modal" role="dialog" aria-modal="true" aria-labelledby="student-removal-title">
            <header class="modal-card__header">
              <div>
                <h3 id="student-removal-title">Remove Student from This Class?</h3>
                <p>
                  This removes {{ studentPendingRemovalName }} from this class. Their account, exam history,
                  and memberships in other classes will remain unchanged.
                </p>
              </div>
              <button
                class="modal-card__close"
                type="button"
                aria-label="Close remove student dialog"
                :disabled="removingStudent"
                @click="closeStudentRemovalModal"
              >
                &times;
              </button>
            </header>

            <div class="student-removal-warning">
              Only this class membership will be removed.
            </div>

            <p v-if="studentRemovalError" class="error-text">{{ studentRemovalError }}</p>

            <footer class="modal-card__footer">
              <AppButton variant="secondary" type="button" :disabled="removingStudent" @click="closeStudentRemovalModal">Cancel</AppButton>
              <AppButton
                class="student-removal-confirm-button"
                type="button"
                :disabled="!canConfirmStudentRemoval"
                @click="confirmStudentRemoval"
              >
                <template v-if="removingStudent">Removing...</template>
                <template v-else>Remove from Class</template>
              </AppButton>
            </footer>
          </section>
        </div>
      </Teleport>
    </section>
  </AdminLayout>
</template>

<style scoped>
.class-detail-toast {
  position: fixed;
  z-index: 2000;
  right: 24px;
  bottom: 24px;
  top: auto;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  width: min(360px, calc(100vw - 32px));
  border: 1px solid #b8e5d1;
  border-radius: 14px;
  padding: 14px 16px;
  color: #174c3d;
  background: #f5fcf8;
  box-shadow: 0 14px 32px rgba(23, 32, 51, 0.16);
}

.class-detail-toast strong,
.class-detail-toast p {
  margin: 0;
}

.class-detail-toast p {
  margin-top: 4px;
  color: #47685e;
  font-size: 14px;
}

.class-detail-toast button {
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 50%;
  color: #47685e;
  background: transparent;
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
}

.class-detail-toast button:hover {
  background: #e5f5ec;
}

@media (max-width: 600px) {
  .class-detail-toast {
    right: 12px;
    bottom: 12px;
  }
}

.class-detail-page {
  display: grid;
  gap: 22px;
}

.class-detail-hero {
  display: grid;
  gap: 16px;
  border: 1px solid #cfe0ff;
  border-radius: 18px;
  padding: 18px;
  background:
    linear-gradient(135deg, rgba(47, 111, 237, 0.08), rgba(255, 255, 255, 0) 42%),
    #ffffff;
  box-shadow: 0 14px 34px rgba(31, 75, 135, 0.08);
}

.class-detail-hero__top,
.class-detail-hero__main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.class-detail-hero__actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.class-detail-hero__main {
  align-items: center;
}

.class-detail-hero h1,
.class-detail-hero p {
  margin: 0;
}

.class-detail-hero h1 {
  margin-top: 4px;
  color: var(--color-text);
  font-size: 30px;
  line-height: 1.12;
}

.class-detail-hero p:not(.admin-eyebrow) {
  margin-top: 8px;
  max-width: 720px;
  color: var(--color-muted);
  font-size: 14px;
  line-height: 1.45;
}

.admin-eyebrow {
  color: var(--color-primary-strong);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.class-back-button,
.icon-refresh-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #cfe0ff;
  border-radius: 999px;
  color: var(--color-primary-strong);
  background: var(--color-primary-soft);
  cursor: pointer;
}

.class-back-button {
  gap: 8px;
  min-height: 34px;
  padding: 0 12px 0 9px;
  font-size: 13px;
  font-weight: 800;
}

.class-back-button svg,
.icon-refresh-button__icon {
  width: 18px;
  height: 18px;
}

.icon-refresh-button {
  width: 34px;
  height: 34px;
}

.icon-refresh-button--loading .icon-refresh-button__icon {
  animation: spin 900ms linear infinite;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 5px 10px;
  color: var(--color-muted);
  background: #edf2f8;
  font-size: 12px;
  font-weight: 800;
}

.status-pill--on {
  color: var(--color-success);
  background: #e8f7f1;
}

.class-detail-summary {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.class-detail-summary div {
  border: 1px solid var(--color-border);
  border-radius: 13px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.78);
}

.class-detail-summary dt {
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 800;
}

.class-detail-summary dd {
  margin: 3px 0 0;
  color: var(--color-text);
  font-weight: 800;
}

.admin-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.class-exams-toolbar {
  margin-bottom: 14px;
}

.class-exams-toolbar__search {
  flex: 1 1 280px;
}

.admin-toolbar__filters {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.form-input {
  width: min(360px, 100%);
  min-height: 36px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 7px 10px;
}

.form-input--compact {
  width: auto;
  min-width: 150px;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.42);
}

.modal-card {
  width: min(560px, 100%);
  max-height: min(86vh, 760px);
  overflow: auto;
  border-radius: 18px;
  padding: 20px;
  background: #ffffff;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.22);
}

.modal-card--wide {
  width: min(720px, 100%);
}

.modal-card__header,
.modal-card__footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.modal-card__header h3,
.modal-card__header p {
  margin: 0;
}

.modal-card__header p {
  margin-top: 4px;
  color: var(--color-muted);
  font-size: 13px;
}

.modal-card__close {
  border: 0;
  background: transparent;
  color: var(--color-muted);
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}

.modal-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.form-field,
.check-line {
  display: grid;
  gap: 6px;
  color: var(--color-text);
  font-size: 13px;
  font-weight: 700;
}

.form-field--wide {
  grid-column: 1 / -1;
}

.form-label {
  color: var(--color-muted);
  font-size: 12px;
}

.check-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.modal-card__footer {
  align-items: center;
  justify-content: flex-end;
  margin-top: 18px;
}

.error-text {
  color: var(--color-danger);
}

.success-text {
  color: var(--color-success);
}

.admin-state {
  display: grid;
  min-height: 120px;
  place-items: center;
  gap: 12px;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
  padding: 20px;
  color: var(--color-muted);
  background: rgba(247, 250, 255, 0.72);
}

.admin-state--error {
  color: var(--color-danger);
  background: #fff5f6;
}

.class-exam-empty-state {
  min-height: 104px;
  align-content: center;
  justify-items: center;
  text-align: center;
}

.class-exam-empty-state strong {
  color: var(--color-text);
  font-size: 15px;
}

.class-exam-empty-state span {
  max-width: 560px;
  font-size: 13px;
  line-height: 1.45;
}

.table-wrap {
  overflow-x: auto;
}

.admin-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 780px;
}

.admin-table th,
.admin-table td {
  border-bottom: 1px solid var(--color-border);
  padding: 8px 10px;
  text-align: center;
  vertical-align: middle;
  font-size: 13px;
}

.admin-table th:first-child,
.admin-table td:first-child { text-align: left; }

.admin-table th {
  text-align: center;
  color: #24314a;
  background: var(--color-surface-soft);
  font-weight: 800;
}

.admin-table td strong,
.admin-table td small {
  display: block;
}

.admin-table td small {
  margin-top: 2px;
  color: var(--color-muted);
  font-size: 12px;
}

.admin-table__row--clickable {
  cursor: pointer;
}

.admin-table__row--clickable:hover {
  background: var(--color-primary-soft);
}

.class-exam-table {
  min-width: 1040px;
  table-layout: fixed;
}

.class-exam-table__exam-column { width: 40%; }
.class-exam-table__time-column { width: 15%; }
.class-exam-table__status-column { width: 12%; }
.class-exam-table__actions-column { width: 18%; }

.class-exam-table th {
  background: #f6f9ff;
}

.class-exam-table th:first-child,
.class-exam-table td:first-child {
  padding-left: 14px;
}

.class-exam-table td {
  padding-top: 10px;
  padding-bottom: 10px;
}

.class-exam-table__exam-cell {
  min-width: 0;
  text-align: left !important;
}

.class-exam-table td .class-exam-table__exam-title {
  display: block;
  margin: 0;
  color: var(--color-text);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.4;
}

.class-exam-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}

.class-exam-meta__item {
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
}

.class-exam-table tbody tr {
  transition:
    background 150ms ease,
    box-shadow 150ms ease;
}

.class-exam-table tbody tr:hover {
  background: #f8fbff;
  box-shadow: inset 3px 0 0 var(--color-primary);
}

.class-exam-table__time-cell {
  color: #52627a;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.exam-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 4px 9px;
  color: #64748b;
  background: #edf2f8;
  font-size: 12px;
  font-weight: 800;
}

.exam-status-pill::before {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
  content: '';
}

.exam-status-pill--live {
  color: #16794c;
  background: #e8f7f1;
}

.exam-status-pill--scheduled {
  color: var(--color-primary-strong);
  background: var(--color-primary-soft);
}

.exam-status-pill--ended,
.exam-status-pill--hidden,
.exam-status-pill--muted {
  color: #64748b;
  background: #edf2f8;
}

.exam-status-pill--neutral {
  color: #475569;
  background: #f1f5f9;
}

.class-exam-table__actions-cell {
  min-width: 180px;
  text-align: center !important;
}

.class-exam-table__actions {
  display: flex;
  flex-wrap: nowrap;
  justify-content: center;
  gap: 6px;
  white-space: nowrap;
}

.class-exam-result-button {
  min-height: 32px;
  padding: 0 12px;
  font-size: 12px;
}

.class-exam-monitor-button {
  min-height: 32px;
  padding: 0 12px;
  font-size: 12px;
}

.student-table {
  min-width: 820px;
}

.student-table th {
  background: #f6f9ff;
}

.student-table th:first-child,
.student-table td:first-child {
  padding-left: 14px;
}

.add-students-modal {
  width: min(960px, 100%);
}

.add-students-search {
  margin: 18px 0 14px;
}

.add-students-table-wrap {
  max-height: min(48vh, 440px);
  overflow: auto;
}

.add-students-table {
  min-width: 760px;
}

.add-students-table__select {
  width: 42px;
}

.add-students-selected {
  margin-right: auto;
  color: var(--color-muted);
  font-size: 13px;
}

@media (max-width: 640px) {
  .add-students-modal .modal-card__footer {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
  }

  .add-students-modal .add-students-selected {
    grid-column: 1 / -1;
    margin: 0;
    white-space: nowrap;
  }

  .add-students-modal .modal-card__footer > :last-child {
    white-space: nowrap;
  }
}

.student-table td {
  padding-top: 10px;
  padding-bottom: 10px;
}

.student-table td strong {
  color: var(--color-text);
  font-size: 14px;
}

.student-table td small {
  color: #75829a;
}

.student-table tbody tr {
  transition:
    background 150ms ease,
    box-shadow 150ms ease;
}

.student-table tbody tr:hover {
  background: #f8fbff;
  box-shadow: inset 3px 0 0 var(--color-primary);
}

.student-table__empty-value {
  color: #94a3b8;
  font-weight: 700;
}

.student-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 4px 9px;
  color: #64748b;
  background: #edf2f8;
  font-size: 12px;
  font-weight: 800;
}

.student-status-pill::before {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
  content: '';
}

.student-status-pill--active {
  color: #16794c;
  background: #e8f7f1;
}

.student-table__actions-cell {
  width: 240px;
}

.student-row-actions {
  gap: 6px;
}

.student-action-button {
  min-height: 32px;
  padding: 0 13px;
  font-size: 12px;
}

.student-action-button--quiet {
  color: #4b5f7a;
  background: #f8fafc;
  box-shadow: none;
}

.student-action-button--danger {
  color: #b42318;
  background: #fff1f0;
  border-color: #fecaca;
  box-shadow: none;
}

.student-removal-notice {
  margin: 0 0 12px;
  font-weight: 800;
}

.student-removal-warning {
  margin-top: 16px;
  border: 1px solid #fecaca;
  border-radius: 12px;
  padding: 12px;
  color: #991b1b;
  background: #fff7f7;
  font-size: 13px;
  line-height: 1.45;
}

.student-removal-confirm-button {
  background: #b42318;
  box-shadow: 0 12px 24px rgba(180, 35, 24, 0.2);
}

.student-removal-confirm-button:hover:not(:disabled) {
  box-shadow: 0 16px 30px rgba(180, 35, 24, 0.26);
}

.table-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  color: var(--color-muted);
  font-size: 13px;
}

.table-pagination__actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.table-pagination__actions button {
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 6px 12px;
  color: var(--color-text);
  background: #ffffff;
  cursor: pointer;
}

.table-pagination__actions button:disabled {
  color: #a8b2c3;
  background: #f3f6fb;
  cursor: not-allowed;
}

.row-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 780px) {
  .class-detail-hero__top,
  .class-detail-hero__main {
    align-items: stretch;
    flex-direction: column;
  }

  .class-detail-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .class-exams-toolbar,
  .admin-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .class-exams-toolbar__search {
    flex: 0 0 auto;
    width: 100%;
  }

  .admin-toolbar__filters {
    justify-content: flex-start;
  }

  .class-exams-toolbar .admin-toolbar__filters {
    width: 100%;
  }
}

@media (max-width: 640px) {
  .class-exam-table-wrap {
    overflow: visible;
  }

  .class-exam-table {
    display: block;
    min-width: 0;
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
  }

  .class-exam-table colgroup {
    display: none;
  }

  .class-exam-table thead {
    display: none;
  }

  .class-exam-table tbody {
    display: grid;
    width: 100%;
    gap: 10px;
  }

  .class-exam-table tbody tr {
    display: grid;
    box-sizing: border-box;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    overflow: hidden;
    width: 100%;
    border: 1px solid var(--color-border);
    border-radius: 12px;
    background: #fff;
    box-shadow: 0 2px 8px rgba(30, 64, 120, 0.04);
  }

  .class-exam-table tbody tr:hover {
    background: #fff;
    box-shadow: 0 2px 8px rgba(30, 64, 120, 0.04);
  }

  .class-exam-table tbody td {
    min-width: 0;
    padding: 9px 11px;
    border: 0;
    text-align: left !important;
    white-space: normal;
  }

  .class-exam-table__exam-cell,
  .class-exam-table__status-cell,
  .class-exam-table__actions-cell {
    grid-column: 1 / -1;
  }

  .class-exam-table td .class-exam-table__exam-title {
    font-size: 14px;
  }

  .class-exam-table__meta-cell::before {
    display: block;
    margin-bottom: 3px;
    color: var(--color-muted);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .class-exam-table__opens-cell::before { content: 'Opens'; }
  .class-exam-table__closes-cell::before { content: 'Closes'; }
  .class-exam-table__status-cell::before { content: 'Status'; }
  .class-exam-table__actions-cell::before { content: 'Actions'; }

  .class-exam-table__time-cell {
    font-size: 13px;
    white-space: normal;
  }

  .class-exam-table__actions-cell {
    min-width: 0;
    padding-top: 2px !important;
  }

  .class-exam-table__actions {
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .add-students-table {
    min-width: 100%;
    table-layout: fixed;
  }

  .add-students-table th:nth-child(3),
  .add-students-table td:nth-child(3),
  .add-students-table th:nth-child(5),
  .add-students-table td:nth-child(5) {
    display: none;
  }

  .add-students-table th:nth-child(1),
  .add-students-table td:nth-child(1) {
    width: 36px;
    padding-right: 4px;
    padding-left: 4px;
  }

  .add-students-table th:nth-child(2) { width: 44%; }
  .add-students-table th:nth-child(4) { width: 56%; }

  .add-students-table td:nth-child(2),
  .add-students-table td:nth-child(4) {
    overflow-wrap: anywhere;
    text-align: left;
    white-space: normal;
  }
}
</style>
