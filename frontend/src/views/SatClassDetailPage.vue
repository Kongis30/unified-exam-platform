<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppModal from '@/components/AppModal.vue'
import AdminDataTable from '@/components/admin/AdminDataTable.vue'
import ClassExamScoreTrend from '@/components/admin/ClassExamScoreTrend.vue'
import { notifyOperation } from '@/utils/operationNotification'
import { authState } from '@/auth'
import {
  addClassStudents, deleteClass, getClass, listAvailableStudents, listClassExams, listClassStudents,
  removeClassStudent, setClassStatus, updateClass,
} from '@/api/platform'

const route = useRoute()
const router = useRouter()
const classroom = ref(null)
const students = ref([])
const studentOptions = ref([])
const exams = ref([])
const isLoading = ref(false)
const isSaving = ref(false)
const error = ref('')
const editOpen = ref(false)
const addStudentOpen = ref(false)
const removeStudentTarget = ref(null)
const deleteClassOpen = ref(false)
const classForm = reactive({ name: '', description: '' })
const addStudentSearch = ref('')
const selectedStudentIds = ref([])

const classId = computed(() => route.params.classId)
const studentsToAdd = computed(() => {
  const memberIds = new Set(students.value.map((student) => student.id))
  return studentOptions.value.filter((student) => !memberIds.has(student.id))
})
const availableStudents = computed(() => {
  const keyword = addStudentSearch.value.trim().toLowerCase()
  return studentsToAdd.value.filter((student) => !keyword
    || [student.realName, student.username].some((value) => String(value || '').toLowerCase().includes(keyword)))
})
const allVisibleStudentsSelected = computed(() => availableStudents.value.length > 0
  && availableStudents.value.every((student) => selectedStudentIds.value.includes(student.id)))

async function loadPage() {
  isLoading.value = true
  error.value = ''
  try {
    const [classRow, studentRows, availableRows, examRows] = await Promise.all([
      getClass(classId.value, ['SAT', 'PSAT']), listClassStudents(classId.value), listAvailableStudents(), listClassExams(classId.value, ['SAT', 'PSAT']),
    ])
    classroom.value = classRow
    students.value = studentRows
    studentOptions.value = availableRows
    exams.value = examRows
  } catch (requestError) {
    error.value = requestError.message || 'Unable to load class details.'
  } finally {
    isLoading.value = false
  }
}

function goBack() {
  const returnTo = route.query.returnTo
  if (typeof returnTo === 'string' && returnTo.startsWith('/exam-types/SAT/admin')) {
    router.push(returnTo)
    return
  }
  router.push({ name: 'exam-type', params: { code: 'SAT' }, query: { tab: 'classes' } })
}

function openEditDialog() {
  Object.assign(classForm, { name: classroom.value.name, description: classroom.value.description || '' })
  editOpen.value = true
}

async function saveClass() {
  if (!classForm.name.trim() || isSaving.value) return
  isSaving.value = true
  try {
    await updateClass(classId.value, {
      name: classForm.name.trim(),
      description: classForm.description.trim(),
      sortOrder: classroom.value.sortOrder,
    }, ['SAT', 'PSAT'])
    editOpen.value = false
    notifyOperation('Class details updated.')
    await loadPage()
  } catch (requestError) {
    notifyOperation(requestError.message || 'Unable to update this class.', 'error')
  } finally {
    isSaving.value = false
  }
}

async function toggleClassStatus() {
  try {
    const status = classroom.value.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE'
    await setClassStatus(classId.value, status)
    notifyOperation(status === 'ACTIVE' ? 'Class reopened.' : 'Class archived.')
    await loadPage()
  } catch (requestError) {
    notifyOperation(requestError.message || 'Unable to update the class status.', 'error')
  }
}

async function permanentlyDeleteClass() {
  if (!classroom.value || isSaving.value) return
  isSaving.value = true
  try {
    await deleteClass(classId.value)
    notifyOperation('Class permanently deleted. Student accounts, exams, attempts, and results were kept.')
    deleteClassOpen.value = false
    goBack()
  } catch (requestError) {
    notifyOperation(requestError.message || 'Unable to delete this class.', 'error')
  } finally {
    isSaving.value = false
  }
}

async function addStudent() {
  if (!selectedStudentIds.value.length || isSaving.value) return
  isSaving.value = true
  try {
    const count = selectedStudentIds.value.length
    await addClassStudents(classId.value, selectedStudentIds.value)
    selectedStudentIds.value = []
    addStudentOpen.value = false
    notifyOperation(`${count} ${count === 1 ? 'student' : 'students'} added to class.`)
    await loadPage()
  } catch (requestError) {
    notifyOperation(requestError.message || 'Unable to add students to this class.', 'error')
  } finally {
    isSaving.value = false
  }
}

function openAddStudents() {
  addStudentSearch.value = ''
  selectedStudentIds.value = []
  addStudentOpen.value = true
}

function toggleVisibleStudents(checked) {
  const visibleIds = availableStudents.value.map((student) => student.id)
  selectedStudentIds.value = checked
    ? [...new Set([...selectedStudentIds.value, ...visibleIds])]
    : selectedStudentIds.value.filter((studentId) => !visibleIds.includes(studentId))
}

function toggleStudentSelection(studentId, checked) {
  selectedStudentIds.value = checked
    ? [...new Set([...selectedStudentIds.value, studentId])]
    : selectedStudentIds.value.filter((id) => id !== studentId)
}

function openStudentScores(student) {
  router.push({
    name: 'sat-student-scores',
    params: { classId: classId.value, studentId: student.id },
    query: {
      className: classroom.value?.name || '',
      returnTo: route.query.returnTo,
    },
  })
}

async function removeStudent() {
  if (!removeStudentTarget.value || isSaving.value) return
  isSaving.value = true
  try {
    await removeClassStudent(classId.value, removeStudentTarget.value.id)
    notifyOperation('Student removed from class.')
    removeStudentTarget.value = null
    await loadPage()
  } catch (requestError) {
    notifyOperation(requestError.message || 'Unable to remove this student.', 'error')
  } finally {
    isSaving.value = false
  }
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date)
}

watch(classId, loadPage)
onMounted(loadPage)
</script>

<template>
  <main class="sat-class-detail-page">
    <div class="sat-class-detail-page__topbar">
      <button type="button" class="text-button" @click="goBack">← Back to classes</button>
      <div v-if="classroom" class="sat-class-detail-page__actions">
        <AppButton variant="secondary" @click="openEditDialog">Edit class</AppButton>
        <AppButton variant="secondary" @click="toggleClassStatus">{{ classroom.status === 'ACTIVE' ? 'Archive class' : 'Reopen class' }}</AppButton>
        <AppButton v-if="authState.user?.roleCode === 'ADMIN'" variant="danger" @click="deleteClassOpen = true">Delete class</AppButton>
      </div>
    </div>

    <p v-if="error" class="error-text page-message" role="alert">{{ error }}</p>
    <div v-if="isLoading && !classroom" class="admin-state">Loading class details...</div>

    <template v-else-if="classroom">
      <AppCard class="sat-class-info-card" :title="classroom.name" :subtitle="classroom.description || 'Class details and enrollment.'">
        <dl class="sat-class-summary">
          <div><dt>Status</dt><dd><span class="status-pill" :class="classroom.status === 'ACTIVE' ? 'status-pill--on' : ''">{{ classroom.status === 'ACTIVE' ? 'Active' : 'Archived' }}</span></dd></div>
          <div><dt>Students</dt><dd>{{ students.length }}</dd></div>
          <div><dt>Exam releases</dt><dd>{{ exams.length }}</dd></div>
        </dl>
      </AppCard>

      <ClassExamScoreTrend :class-id="classId" :exam-type-codes="['SAT', 'PSAT']" />

      <AppCard class="sat-class-detail-section" title="Exam Releases" subtitle="Review releases targeted to this class, including drafts and published exams.">
        <div v-if="isLoading" class="admin-state">Loading exam records...</div>
        <p v-else-if="!exams.length" class="table-empty">No exam records for this class yet.</p>
        <p v-else class="mobile-table-scroll-hint">Swipe horizontally to see all columns.</p>
        <div v-if="!isLoading && exams.length" class="admin-table-scroll" tabindex="0" aria-label="Exam releases table. Scroll horizontally to see all columns.">
          <AdminDataTable>
            <thead><tr><th>Exam</th><th>Paper</th><th>Exam Window</th><th>Status</th><th>Duration</th></tr></thead>
            <tbody>
              <tr v-for="exam in exams" :key="exam.examId">
                <td><strong>{{ exam.examTitle }}</strong></td>
                <td>{{ exam.paperName }}</td>
                <td class="class-exam-window">
                  <span><small>Opens</small>{{ formatDate(exam.startTime) }}</span>
                  <span><small>Closes</small>{{ formatDate(exam.endTime) }}</span>
                </td>
                <td>{{ exam.status === 'PUBLISHED' ? 'Published' : 'Draft' }}</td>
                <td>{{ exam.duration ? `${Math.round(exam.duration / 60)} min` : '—' }}</td>
              </tr>
            </tbody>
          </AdminDataTable>
        </div>
      </AppCard>

      <AppCard class="sat-class-detail-section" title="Students" subtitle="Students enrolled in this class.">
        <template #default>
          <div class="sat-class-students-toolbar">
            <span>{{ students.length }} {{ students.length === 1 ? 'student' : 'students' }}</span>
            <AppButton @click="openAddStudents">Add student</AppButton>
          </div>
          <p v-if="isLoading" class="admin-state">Loading students...</p>
          <p v-else-if="!students.length" class="table-empty">No students in this class yet.</p>
          <p v-else class="mobile-table-scroll-hint">Swipe horizontally to see all columns.</p>
          <div v-if="!isLoading && students.length" class="admin-table-scroll" tabindex="0" aria-label="Students table. Scroll horizontally to see all columns.">
            <AdminDataTable>
              <thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Joined</th><th>Actions</th></tr></thead>
              <tbody>
                <tr v-for="student in students" :key="student.id">
                  <td><strong>{{ student.realName }}</strong></td>
                  <td>{{ student.username }}</td>
                  <td>{{ student.email || '—' }}</td>
                  <td>{{ formatDate(student.joinedAt) }}</td>
                  <td class="sat-student-actions">
                    <button type="button" class="text-button" @click="openStudentScores(student)">View scores</button>
                    <button type="button" class="text-button sat-student-actions__remove" @click="removeStudentTarget = student">Remove</button>
                  </td>
                </tr>
              </tbody>
            </AdminDataTable>
          </div>
        </template>
      </AppCard>
    </template>

    <AppModal v-if="editOpen" title="Edit class" description="Update this class's name and description." :busy="isSaving" @close="editOpen = false">
      <form id="sat-edit-class-form" class="sat-class-form" @submit.prevent="saveClass">
        <label class="form-field"><span class="form-label">Class name</span><input v-model.trim="classForm.name" class="form-input" maxlength="100" required /></label>
        <label class="form-field"><span class="form-label">Description</span><textarea v-model.trim="classForm.description" class="form-input" rows="3" maxlength="500" /></label>
      </form>
      <template #footer><AppButton variant="secondary" :disabled="isSaving" @click="editOpen = false">Cancel</AppButton><AppButton type="submit" form="sat-edit-class-form" :disabled="isSaving">Save changes</AppButton></template>
    </AppModal>

    <AppModal v-if="addStudentOpen" title="Add students" description="Search and select student accounts to add to this class. Students may belong to multiple classes." width="860px" panel-class="sat-add-students-modal" :busy="isSaving" @close="addStudentOpen = false">
      <form id="sat-add-student-form" class="sat-class-form" @submit.prevent="addStudent">
        <div class="sat-add-students-toolbar">
          <label class="form-field sat-add-students-search">
            <span class="form-label">Search students</span>
            <input v-model="addStudentSearch" class="form-input" type="search" placeholder="Search by name or username" />
          </label>
          <span class="sat-add-students-selection" aria-live="polite">{{ selectedStudentIds.length }} selected</span>
        </div>
        <div v-if="availableStudents.length" class="sat-add-students-table-wrap">
          <AdminDataTable class="sat-add-students-table">
            <thead>
              <tr>
                <th class="sat-add-students-table__select-column"><input type="checkbox" :checked="allVisibleStudentsSelected" aria-label="Select all visible students" @change="toggleVisibleStudents($event.target.checked)" /></th>
                <th>Student</th>
                <th>Username</th>
                <th>Current classes</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="student in availableStudents" :key="student.id" :class="{ 'is-selected': selectedStudentIds.includes(student.id) }" @click="toggleStudentSelection(student.id, !selectedStudentIds.includes(student.id))">
                <td class="sat-add-students-table__select-column"><input type="checkbox" :checked="selectedStudentIds.includes(student.id)" :aria-label="`Select ${student.realName}`" @click.stop @change="toggleStudentSelection(student.id, $event.target.checked)" /></td>
                <td><strong>{{ student.realName || 'Unnamed student' }}</strong></td>
                <td>{{ student.username }}</td>
                <td><span v-if="student.classNames" class="sat-student-class-list">{{ student.classNames }}</span><span v-else class="sat-student-class-list sat-student-class-list--empty">No classes yet</span></td>
              </tr>
            </tbody>
          </AdminDataTable>
        </div>
        <p v-else class="sat-add-students-empty">{{ studentsToAdd.length ? 'No students match your search.' : 'All available student accounts are already in this class.' }}</p>
      </form>
      <template #footer><AppButton variant="secondary" :disabled="isSaving" @click="addStudentOpen = false">Cancel</AppButton><AppButton type="submit" form="sat-add-student-form" :disabled="!selectedStudentIds.length || isSaving">{{ isSaving ? 'Adding…' : selectedStudentIds.length ? `Add ${selectedStudentIds.length} ${selectedStudentIds.length === 1 ? 'student' : 'students'}` : 'Add students' }}</AppButton></template>
    </AppModal>

    <AppModal v-if="removeStudentTarget" title="Remove student" description="This student will no longer be a member of this class." :busy="isSaving" @close="removeStudentTarget = null">
      <p>Remove <strong>{{ removeStudentTarget.realName }}</strong> from {{ classroom?.name }}?</p>
      <template #footer><AppButton variant="secondary" :disabled="isSaving" @click="removeStudentTarget = null">Cancel</AppButton><AppButton :disabled="isSaving" @click="removeStudent">Remove student</AppButton></template>
    </AppModal>

    <AppModal v-if="deleteClassOpen && classroom" title="Delete class permanently?" :busy="isSaving" @close="deleteClassOpen = false">
      <div class="sat-class-delete-confirm">
        <p>You are about to permanently delete the shared platform class <strong>{{ classroom.name }}</strong> and remove its enrollments and exam targets across SAT, PSAT, and SHSAT.</p>
        <p>Student accounts, exams, exam attempts, and results will remain. Students who already have exam access will keep it.</p>
        <p>Any SHSAT review tasks must be reassigned or removed before this class can be deleted.</p>
      </div>
      <template #footer>
        <AppButton variant="secondary" :disabled="isSaving" @click="deleteClassOpen = false">Cancel</AppButton>
        <AppButton variant="danger" :disabled="isSaving" @click="permanentlyDeleteClass">{{ isSaving ? 'Deleting…' : 'Delete class' }}</AppButton>
      </template>
    </AppModal>
  </main>
</template>

<style scoped>
.sat-class-detail-page { display: grid; gap: 18px; width: min(100% - 40px, 1180px); margin: 0 auto; padding: 32px 0 56px; }
.sat-class-detail-page__topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.sat-class-detail-page__actions { display: flex; flex-wrap: wrap; gap: 8px; }
.sat-class-info-card, .sat-class-detail-section { min-width: 0; }
.sat-class-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin: 0; }
.sat-class-summary > div { display: grid; align-content: center; gap: 8px; min-height: 78px; border: 1px solid var(--color-border); border-radius: 12px; padding: 12px 16px; background: #fbfdff; }
.sat-class-summary dt { color: var(--color-muted); font-size: 13px; }
.sat-class-summary dd { margin: 0; color: var(--color-text); font-size: 17px; font-weight: 700; }
.sat-class-students-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: -4px 0 14px; color: var(--color-muted); font-size: 14px; }
.sat-student-actions { white-space: nowrap; }
.sat-student-actions .text-button { margin: 0 6px; }
.sat-student-actions__remove { color: #a23d47; }
.sat-class-form { display: grid; gap: 16px; }
.sat-class-delete-confirm { display: grid; gap: 12px; color: var(--color-muted); line-height: 1.55; }
.sat-class-delete-confirm p { margin: 0; }
.sat-class-delete-confirm strong { color: var(--color-text); }
.sat-class-form .app-modal__footer { margin-top: 0; }
.sat-add-students-toolbar { display: flex; align-items: end; justify-content: space-between; gap: 16px; }
.sat-add-students-search { flex: 1; max-width: 420px; }
.sat-add-students-selection { padding-bottom: 10px; color: var(--color-muted); font-size: 14px; font-weight: 650; white-space: nowrap; }
.sat-add-students-table-wrap { max-height: min(52vh, 440px); overflow: auto; border: 1px solid var(--color-border); border-radius: 12px; }
.sat-add-students-table { min-width: 680px; }
.sat-add-students-table :deep(th), .sat-add-students-table :deep(td) { padding: 10px 12px; }
.sat-add-students-table :deep(th:first-child), .sat-add-students-table :deep(td:first-child) { width: 44px; text-align: center; }
.sat-add-students-table :deep(tbody tr) { cursor: pointer; transition: background-color 120ms ease; }
.sat-add-students-table :deep(tbody tr:hover), .sat-add-students-table :deep(tbody tr.is-selected) { background: #f2f6ff; }
.sat-add-students-table :deep(input[type='checkbox']) { width: 16px; height: 16px; accent-color: var(--color-primary); cursor: pointer; }
.sat-student-class-list { color: #405473; font-size: 14px; }
.sat-student-class-list--empty { color: #8795aa; }
.sat-add-students-empty { margin: 0; padding: 28px 16px; border: 1px dashed var(--color-border); border-radius: 12px; color: var(--color-muted); text-align: center; }
.admin-table-scroll { overflow-x: auto; }
.mobile-table-scroll-hint { display: none; }
.class-exam-window { min-width: 250px; white-space: nowrap; }
.class-exam-window span { display: flex; align-items: baseline; gap: 8px; }
.class-exam-window small { min-width: 42px; color: #71819a; font-size: 11px; font-weight: 650; }
@media (max-width: 640px) {
  .sat-class-detail-page { width: min(100% - 24px, 1180px); padding-top: 20px; }
  .sat-class-detail-page__topbar { align-items: flex-start; flex-direction: column; }
  .sat-class-summary { grid-template-columns: 1fr; }
  .mobile-table-scroll-hint { display: block; margin: -4px 0 8px; color: var(--color-muted); font-size: 12px; }
  .admin-table-scroll { overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch; }
}
</style>
