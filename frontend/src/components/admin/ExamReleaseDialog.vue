<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import AppModal from '@/components/AppModal.vue'
import { listAvailableStudents, listClassStudents } from '@/api/platform'

// 三个考试模块共用表单和目标选择器；字段映射保留各模块现有保存流程。
const props = defineProps({
  form: { type: Object, required: true },
  fields: { type: Object, required: true },
  paperGroups: { type: Array, required: true },
  classes: { type: Array, required: true },
  examType: { type: String, required: true },
  title: { type: String, default: 'Create Exam' },
  busy: Boolean,
  error: { type: String, default: '' },
  paperLocked: Boolean,
  allowAllStudents: { type: Boolean, default: true },
  allowIndividualDirectory: { type: Boolean, default: true },
  selectedScope: { type: String, default: 'SELECTED' },
  descriptionMaxLength: { type: Number, default: 2000 },
})
const classIds = defineModel('classIds', { type: Array, required: true })
const studentIds = defineModel('studentIds', { type: Array, required: true })
const studentTargets = defineModel('studentTargets', { type: Array, default: () => [] })
const emit = defineEmits(['close', 'submit'])
const studentSearch = ref('')
const expandedClasses = ref(new Set())
const cache = ref({})
const directory = ref(null)
const loadingClasses = ref({})
const classErrors = ref({})
const searching = ref(false)
const pendingRequests = new Map()
let searchTimer
let searchVersion = 0
const selected = (values, id) => values.some((value) => String(value) === String(id))
const activeClasses = computed(() => props.classes
  .filter((item) => (item.status ? item.status === 'ACTIVE' : (item.isActive ?? item.active ?? true)))
  .map((item) => ({ id: item.id ?? item.classId, name: item.name ?? item.className, count: item.studentCount || 0 }))
  .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }) || Number(a.id) - Number(b.id)))
const searchQuery = computed(() => studentSearch.value.trim().toLocaleLowerCase())
const matchesStudent = (item) => !searchQuery.value || [item.realName, item.username]
  .some((value) => String(value || '').toLocaleLowerCase().includes(searchQuery.value))
const visibleClasses = computed(() => !searchQuery.value ? activeClasses.value : activeClasses.value
  .filter((item) => (cache.value[String(item.id)] || []).some(matchesStudent)))
const allClassesSelected = computed(() => activeClasses.value.length > 0 && activeClasses.value.every((item) => selected(classIds.value, item.id)))
const visibleStudents = (classId) => (cache.value[String(classId)] || []).filter(matchesStudent)
  .sort((a, b) => String(a.realName || a.username || '').localeCompare(String(b.realName || b.username || ''), 'en', { sensitivity: 'base', numeric: true }) || Number(a.id) - Number(b.id))
const isExpanded = (classId) => searchQuery.value ? !expandedClasses.value.has(String(classId)) : expandedClasses.value.has(String(classId))
const knownStudents = computed(() => {
  const rows = [...(directory.value || []), ...Object.values(cache.value).flat()]
  return new Map(rows.map((item) => [String(item.id), item]))
})

// 班级成员按需缓存；搜索时加载当前模块的全部班级并按学生姓名筛选。
async function loadClassStudents(classId) {
  const key = String(classId)
  if (cache.value[key]) return
  if (pendingRequests.has(key)) return pendingRequests.get(key)
  loadingClasses.value = { ...loadingClasses.value, [key]: true }
  classErrors.value = { ...classErrors.value, [key]: '' }
  const request = listClassStudents(key, [props.examType]).then((rows) => {
    cache.value = { ...cache.value, [key]: rows.filter((item) => item.active !== false) }
  }).catch((error) => {
    classErrors.value = { ...classErrors.value, [key]: error.message || 'Unable to load students.' }
  }).finally(() => {
    loadingClasses.value = { ...loadingClasses.value, [key]: false }
    pendingRequests.delete(key)
  })
  pendingRequests.set(key, request)
  return request
}
async function searchClassStudents() {
  const version = ++searchVersion
  searching.value = true
  const queue = [...activeClasses.value]
  await Promise.all(Array.from({ length: Math.min(5, queue.length) }, async () => {
    while (queue.length && version === searchVersion) {
      await loadClassStudents(queue.shift().id)
    }
  }))
  if (version === searchVersion) searching.value = false
}
watch(studentSearch, (value) => {
  clearTimeout(searchTimer)
  expandedClasses.value = new Set()
  ++searchVersion
  searching.value = Boolean(value.trim())
  if (value.trim()) searchTimer = setTimeout(searchClassStudents, 250)
})
onBeforeUnmount(() => clearTimeout(searchTimer))
onMounted(async () => {
  // 旧草稿可能含班外个人目标；保留名称以便查看和移除。
  if (studentIds.value.length && props.allowIndividualDirectory) {
    try { directory.value = await listAvailableStudents({ examTypeCode: props.examType }) } catch { /* 仍可用学生 ID 管理已有目标。 */ }
  }
})
function toggle(values, id, checked) {
  return checked ? [...values.filter((value) => String(value) !== String(id)), id]
    : values.filter((value) => String(value) !== String(id))
}
// 同一学生可以从多个班级分别选中，班级来源不能按学生 ID 去重。
function toggleStudent(classId, studentId, checked) {
  const previousIds = new Set(studentTargets.value.map((target) => String(target.studentId)))
  const legacyIds = studentIds.value.filter((id) => !previousIds.has(String(id)))
  const remaining = studentTargets.value.filter((target) => String(target.classId) !== String(classId) || String(target.studentId) !== String(studentId))
  const nextTargets = checked ? [...remaining, { classId, studentId }] : remaining
  studentTargets.value = nextTargets
  studentIds.value = [...new Set([...legacyIds.map(String), ...nextTargets.map((target) => String(target.studentId))])].map(Number)
}
const selectedStudent = (classId, studentId) => studentTargets.value.some((target) => String(target.classId) === String(classId) && String(target.studentId) === String(studentId))
function removeStudent(studentId) {
  studentTargets.value = studentTargets.value.filter((target) => String(target.studentId) !== String(studentId))
  studentIds.value = studentIds.value.filter((id) => String(id) !== String(studentId))
}
function setScope(value) {
  props.form[props.fields.scope] = value
}
function toggleAllClasses() {
  const activeIds = new Set(activeClasses.value.map((item) => String(item.id)))
  const otherIds = classIds.value.filter((id) => !activeIds.has(String(id)))
  classIds.value = allClassesSelected.value ? otherIds : [...otherIds, ...activeClasses.value.map((item) => item.id)]
}
function toggleClassDetails(classId) {
  const key = String(classId)
  const next = new Set(expandedClasses.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedClasses.value = next
  if (isExpanded(key)) loadClassStudents(key)
}

</script>

<template>
  <AppModal :title="title" description="Choose the paper, schedule and who can take this exam." width="820px" panel-class="app-modal--exam-release" :busy="busy" @close="emit('close')">
    <form id="create-exam-release-form" class="release-form" novalidate @submit.prevent="emit('submit')">
      <section class="release-section">
        <h3>Exam details</h3>
        <div class="release-grid">
          <label class="release-field release-wide"><span>Title</span><input v-model.trim="form[fields.title]" class="form-input" maxlength="200" placeholder="Exam title" required /></label>
          <label class="release-field release-wide"><span>Paper</span>
            <select v-model="form[fields.paper]" class="form-input" :disabled="paperLocked" required>
              <option value="" disabled>Select a paper</option>
              <optgroup v-for="group in paperGroups" :key="group.label" :label="group.label">
                <option v-for="paper in group.papers" :key="paper.id" :value="paper.id">{{ paper.title }}</option>
              </optgroup>
            </select>
            <small v-if="paperLocked">The paper is fixed after an exam draft is created.</small>
          </label>
          <label class="release-field"><span>Duration (minutes)</span><input v-model.number="form[fields.duration]" class="form-input" type="number" min="1" step="1" /></label>
          <label v-if="fields.attemptLimit" class="release-field"><span>Attempt limit</span><input v-model.number="form[fields.attemptLimit]" class="form-input" type="number" min="1" step="1" required /></label>
          <label class="release-field release-wide"><span>Description</span><textarea v-model.trim="form[fields.description]" class="form-input" rows="2" :maxlength="descriptionMaxLength" placeholder="Optional description" /></label>
        </div>
      </section>
      <section class="release-section"><h3>Schedule</h3><div class="release-grid">
        <label class="release-field"><span>Start time</span><input v-model="form[fields.start]" class="form-input" type="datetime-local" required /></label>
        <label class="release-field"><span>End time</span><input v-model="form[fields.end]" class="form-input" type="datetime-local" required /></label>
      </div></section>
      <section class="release-section"><h3>Who can take this exam?</h3>
        <div class="release-scope">
          <label><input :checked="form[fields.scope] === selectedScope" type="radio" name="exam-audience" @change="setScope(selectedScope)" /><span><strong>Selected classes and students</strong><small>Choose whole classes or individual students.</small></span></label>
          <label v-if="allowAllStudents || form[fields.scope] === 'ALL_STUDENTS'"><input :checked="form[fields.scope] === 'ALL_STUDENTS'" type="radio" name="exam-audience" :disabled="!allowAllStudents" @change="setScope('ALL_STUDENTS')" /><span><strong>All active students (existing draft)</strong><small>Choose classes and students to change this legacy audience.</small></span></label>
        </div>
        <template v-if="form[fields.scope] === selectedScope">
          <div class="selection-summary"><strong>{{ classIds.length }} whole classes · {{ studentIds.length }} individual students selected</strong><button v-if="classIds.length || studentIds.length" type="button" @click="classIds = []; studentIds = []; studentTargets = []">Clear all</button></div>
          <div v-if="classIds.length || studentIds.length" class="selected-targets">
            <details v-if="classIds.length" class="selected-students"><summary>View selected classes ({{ classIds.length }})</summary><div v-for="id in classIds" :key="id"><span>{{ activeClasses.find((item) => String(item.id) === String(id))?.name || `Class #${id} (unavailable)` }}</span><button type="button" :aria-label="`Remove class ${id}`" @click="classIds = toggle(classIds, id, false)">Remove</button></div></details>
            <details v-if="studentIds.length" class="selected-students"><summary>View selected students ({{ studentIds.length }})</summary><div v-for="id in studentIds" :key="id"><span>{{ knownStudents.get(String(id))?.realName || knownStudents.get(String(id))?.username || `Student #${id}` }} <small>{{ studentTargets.filter(target => String(target.studentId) === String(id)).map(target => activeClasses.find(item => String(item.id) === String(target.classId))?.name || `Class #${target.classId}`).join(', ') || 'Class not recorded' }}</small></span><button type="button" :aria-label="`Remove student ${id}`" @click="removeStudent(id)">Remove</button></div></details>
          </div>
          <div class="release-picker-header"><strong>Classes</strong><span>Check a class to assign everyone, or expand it to choose individual students.</span></div>
          <input v-model="studentSearch" class="form-input release-search" type="search" placeholder="Search student name or username" aria-label="Search students" />
          <label v-if="activeClasses.length" class="select-all-classes"><input type="checkbox" :checked="allClassesSelected" :indeterminate="classIds.some((id) => activeClasses.some((item) => String(item.id) === String(id))) && !allClassesSelected" @change="toggleAllClasses" /><span>Select all active classes<small v-if="searchQuery"> Includes classes hidden by the search.</small></span></label>
          <p v-if="searching" class="release-hint" role="status">Searching students in all classes…</p>
          <p v-if="searchQuery && Object.values(classErrors).some(Boolean)" class="release-hint" role="alert">Some classes could not be searched. <button type="button" @click="searchClassStudents">Retry</button></p>
          <div v-if="visibleClasses.length && !searching" class="release-list class-list">
            <div v-for="classroom in visibleClasses" :key="classroom.id" class="class-item">
              <div class="class-row">
                <input type="checkbox" :aria-label="`Select whole class ${classroom.name}`" :checked="selected(classIds, classroom.id)" @change="classIds = toggle(classIds, classroom.id, $event.target.checked)" />
                <button type="button" class="class-expand" :aria-expanded="isExpanded(classroom.id)" @click="toggleClassDetails(classroom.id)">
                  <span><strong>{{ classroom.name }}</strong><small>{{ classroom.count }} students · {{ selected(classIds, classroom.id) ? 'Whole class selected' : 'Select students or whole class' }}</small></span>
                  <span aria-hidden="true">{{ isExpanded(classroom.id) ? '▴' : '▾' }}</span>
                </button>
              </div>
              <div v-if="isExpanded(classroom.id)" class="class-students">
                <p v-if="selected(classIds, classroom.id)" class="release-hint">The whole class is selected. Individual selections remain separate.</p>
                <p v-if="loadingClasses[String(classroom.id)]" class="release-hint">Loading students…</p>
                <p v-else-if="classErrors[String(classroom.id)]" class="release-hint" role="alert">{{ classErrors[String(classroom.id)] }} <button type="button" @click="loadClassStudents(classroom.id)">Retry</button></p>
                <div v-else-if="visibleStudents(classroom.id).length" class="release-list student-list">
                  <label v-for="student in visibleStudents(classroom.id)" :key="student.id" class="student-row"><input type="checkbox" :checked="selectedStudent(classroom.id, student.id)" @change="toggleStudent(classroom.id, student.id, $event.target.checked)" /><span><strong>{{ student.realName || student.username }}</strong><small>{{ student.username }}</small></span></label>
                </div>
                <p v-else class="release-hint">No students match your search.</p>
              </div>
            </div>
          </div>
          <p v-else-if="!searching" class="release-hint">{{ activeClasses.length ? 'No students match your search in active classes.' : 'No active classes are available.' }}</p>
          <p class="release-hint">Students who join a selected whole class while the exam is open will be added automatically.</p>
        </template>
      </section>
      <slot name="options" />
    </form>
    <template #footer><p v-if="error" class="release-error" role="alert">{{ error }}</p><slot name="footer" /></template>
  </AppModal>
</template>

<style scoped>
.release-form { display: grid; gap: 20px; }
.release-section { display: grid; gap: 12px; padding-bottom: 18px; border-bottom: 1px solid var(--color-border); }
.release-section h3 { margin: 0; color: var(--color-text); font-size: 16px; }
.release-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 16px; }
.release-wide { grid-column: 1 / -1; }
.release-field { display: grid; gap: 7px; font-size: 14px; font-weight: 650; }
.release-field small, .release-hint, .release-picker-header span, .class-row small, .student-row small, .release-scope small { color: var(--color-muted); font-size: 12px; font-weight: 400; line-height: 1.4; }
.release-form .form-input { box-sizing: border-box; width: 100%; min-height: 42px; padding: 9px 12px; font-weight: 400; }
.release-scope { display: flex; flex-wrap: wrap; gap: 10px; }
.release-scope label { display: flex; flex: 1 1 220px; gap: 9px; border: 1px solid var(--color-border); border-radius: 10px; padding: 12px; cursor: pointer; }
.release-scope label:has(input:checked) { border-color: #a9c2eb; background: #f3f7ff; }
.release-scope span, .class-expand span:first-child, .student-row span { display: grid; gap: 3px; }
.release-scope input, .select-all-classes input, .class-row input, .student-row input { accent-color: var(--color-primary); }
.selection-summary, .release-picker-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.selection-summary { background: #eff5ff; border-radius: 9px; padding: 10px 12px; font-size: 13px; }
.release-picker-header { align-items: baseline; flex-wrap: wrap; }
.release-form button { border: 0; background: transparent; color: var(--color-primary-strong); cursor: pointer; font-weight: 650; }
.release-form button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 3px; border-radius: 4px; }
.release-search { max-width: 100%; }
.select-all-classes { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border: 1px solid var(--color-border); border-radius: 10px; background: #f5f9ff; cursor: pointer; font-size: 14px; font-weight: 650; }
.select-all-classes small { display: block; color: var(--color-muted); font-size: 12px; font-weight: 400; }
.release-list { overflow: auto; border: 1px solid var(--color-border); border-radius: 10px; padding: 5px; background: #fbfdff; }
.class-list { max-height: min(55vh, 480px); }
.student-list { overflow: visible; }
.class-row, .student-row { display: flex; align-items: center; gap: 10px; border-radius: 8px; padding: 9px; }
.class-row:hover, .student-row:hover { background: #f1f6ff; }
.release-form .class-expand { display: flex; flex: 1 1 0; width: 100%; min-width: 0; align-items: center; justify-content: space-between; gap: 10px; padding: 0; color: var(--color-text); text-align: left; }
.release-form .class-expand > span:first-child { display: flex; flex: 1; min-width: 0; flex-direction: column; align-items: flex-start; }
.release-form .class-expand strong { color: var(--color-text); font-size: 14px; }
.class-students { display: grid; gap: 9px; padding: 5px 9px 12px 32px; }
.student-row { cursor: pointer; } .release-hint { margin: 0; }
.selected-targets { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 10px; align-items: start; }
.selected-students { min-width: 0; border: 1px solid var(--color-border); border-radius: 9px; padding: 10px 12px; background: #fbfdff; }
.selected-students summary { cursor: pointer; color: var(--color-primary-strong); font-size: 13px; font-weight: 650; }
.selected-students div { display: flex; justify-content: space-between; gap: 10px; padding: 6px 0; font-size: 13px; }
.release-error { margin: 0 auto 0 0; color: #b42318; font-size: 13px; }
@media (max-width: 600px) { .release-grid { grid-template-columns: 1fr; } .release-wide { grid-column: auto; } .class-row { align-items: flex-start; } }
</style>
