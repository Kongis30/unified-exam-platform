<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppModal from '@/components/AppModal.vue'
import { createClass, listClasses, reorderClasses } from '@/api/platform'
import { notifyOperation } from '@/utils/operationNotification'

const props = defineProps({ examTypeCode: { type: String, default: '' } })
const router = useRouter()
const classes = ref([])
const keyword = ref('')
const isLoading = ref(false)
const showCreateDialog = ref(false)
const isSavingClass = ref(false)
const isReorderingClasses = ref(false)
const classCreateError = ref('')
const error = ref('')
const notice = ref('')
const draggingClassId = ref('')
const classDragMoved = ref(false)
let suppressClassClickUntil = 0
const classForm = ref({ name: '', description: '', sortOrder: 0 })
const classExamTypeCodes = computed(() => props.examTypeCode === 'SAT' ? ['SAT', 'PSAT'] : ['SHSAT'])
const canReorderClasses = computed(() => props.examTypeCode === 'SAT'
  && !keyword.value.trim()
  && classes.value.length > 1
  && !isReorderingClasses.value)
const filteredClasses = computed(() => {
  const query = keyword.value.trim().toLocaleLowerCase()
  if (!query) return classes.value
  return classes.value.filter((item) => [item.name, item.description, item.status]
    .some((value) => String(value || '').toLocaleLowerCase().includes(query)))
})

async function loadClasses() {
  isLoading.value = true
  try {
    classes.value = await listClasses(classExamTypeCodes.value)
  } finally {
    isLoading.value = false
  }
}

async function loadPage() {
  isLoading.value = true
  try {
    await loadClasses()
  } catch (requestError) {
    error.value = requestError.message
  } finally {
    isLoading.value = false
  }
}

function openClass(classroom) {
  if (props.examTypeCode === 'SAT') {
    router.push({ name: 'sat-class-detail', params: { classId: classroom.id } })
  } else if (props.examTypeCode === 'SHSAT') {
    router.push({ name: 'admin-class-detail', params: { classId: classroom.id } })
  }
}

function moveClass(sourceId, targetId) {
  const sourceIndex = classes.value.findIndex((item) => String(item.id) === String(sourceId))
  const targetIndex = classes.value.findIndex((item) => String(item.id) === String(targetId))
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return

  const reordered = [...classes.value]
  const [movedClass] = reordered.splice(sourceIndex, 1)
  reordered.splice(targetIndex, 0, movedClass)
  classes.value = reordered
  classDragMoved.value = true
}

// SAT 班级卡片沿用 SHSAT 的拖动排序流程，最终通过共享接口保存完整班级顺序。
function startClassDrag(classroom, event) {
  if (!canReorderClasses.value) {
    event.preventDefault()
    return
  }

  draggingClassId.value = String(classroom.id)
  classDragMoved.value = false
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', draggingClassId.value)
}

function dragOverClass(classroom, event) {
  if (!draggingClassId.value || !canReorderClasses.value) return
  event.preventDefault()
  moveClass(draggingClassId.value, classroom.id)
}

async function finishClassDrag() {
  if (!draggingClassId.value) return

  const shouldSave = classDragMoved.value
  suppressClassClickUntil = shouldSave ? Date.now() + 250 : 0
  draggingClassId.value = ''
  classDragMoved.value = false
  if (!shouldSave) return

  isReorderingClasses.value = true
  error.value = ''
  try {
    classes.value = await reorderClasses(classes.value.map((classroom) => classroom.id), classExamTypeCodes.value)
    notifyOperation('Class order updated.')
  } catch (requestError) {
    notifyOperation(requestError.message || 'Unable to update class order.', 'error')
    try {
      await loadClasses()
    } catch (reloadError) {
      error.value = reloadError.message || 'Unable to reload classes.'
    }
  } finally {
    isReorderingClasses.value = false
  }
}

function openClassCard(classroom) {
  if (Date.now() < suppressClassClickUntil || draggingClassId.value) return
  openClass(classroom)
}

async function saveClass() {
  const name = classForm.value.name.trim()
  if (!name || isSavingClass.value) return
  classCreateError.value = ''
  notice.value = ''
  isSavingClass.value = true
  try {
    await createClass({ ...classForm.value, name }, classExamTypeCodes.value)
    classForm.value = { name: '', description: '', sortOrder: 0 }
    showCreateDialog.value = false
    if (props.examTypeCode === 'SAT') notifyOperation('Class created.')
    else notice.value = 'Class created.'
    try {
      await loadClasses()
    } catch (requestError) {
      error.value = requestError.message
    }
  } catch (requestError) {
    const message = requestError.message || 'Unable to create this class.'
    if (props.examTypeCode === 'SAT') notifyOperation(message, 'error')
    else classCreateError.value = message
  } finally {
    isSavingClass.value = false
  }
}

function openCreateDialog() {
  error.value = ''
  classForm.value = { name: '', description: '', sortOrder: 0 }
  classCreateError.value = ''
  notice.value = ''
  showCreateDialog.value = true
}

function closeCreateDialog() {
  if (isSavingClass.value) return
  showCreateDialog.value = false
}

onMounted(loadPage)
</script>

<template>
  <AppCard class="sat-classes-card" title="Classes" subtitle="Open a class to manage its students and enrollment.">
    <div class="card-top-actions">
      <AppButton class="card-top-actions__primary" @click="openCreateDialog">Create Class</AppButton>
      <button class="admin-refresh-button" :class="{ 'admin-refresh-button--loading': isLoading }" type="button" :disabled="isLoading" aria-label="Refresh classes" title="Refresh classes" @click="loadPage">
        <svg class="admin-refresh-button__icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 5a7 7 0 0 0-6.32 4H3.5A9 9 0 0 1 19 6.64V4h2v6h-6V8h2.7A6.98 6.98 0 0 0 12 5Zm6.32 10H20.5A9 9 0 0 1 5 17.36V20H3v-6h6v2H6.3A6.98 6.98 0 0 0 12 19a7 7 0 0 0 6.32-4Z" /></svg>
      </button>
    </div>

    <div class="admin-toolbar">
      <div class="admin-toolbar__filters">
        <input v-model="keyword" class="form-input class-search-input" placeholder="Search class or description" />
      </div>
    </div>

    <p v-if="error" class="error-text page-message" role="alert">{{ error }}</p>
    <p v-else-if="notice && props.examTypeCode !== 'SAT'" class="success-text page-message" role="status">{{ notice }}</p>
    <div v-if="isLoading && !classes.length" class="admin-state">Loading classes...</div>
    <div v-else-if="!classes.length" class="admin-state">No classes found.</div>
    <div v-else-if="!filteredClasses.length" class="admin-state">No classes match your search.</div>
    <div v-else class="class-grid" :class="{ 'class-grid--reorderable': canReorderClasses }">
      <article
        v-for="classroom in filteredClasses"
        :key="classroom.id"
        class="class-card sat-class-card"
        :class="{
          'class-card--draggable': canReorderClasses,
          'class-card--dragging': draggingClassId === String(classroom.id),
        }"
        role="button"
        tabindex="0"
        :draggable="canReorderClasses"
        @click="openClassCard(classroom)"
        @keydown.enter="openClass(classroom)"
        @keydown.space.prevent="openClass(classroom)"
        @dragstart="startClassDrag(classroom, $event)"
        @dragover="dragOverClass(classroom, $event)"
        @drop.prevent
        @dragend="finishClassDrag"
      >
        <div class="class-card__header">
          <div><span class="class-card__eyebrow">Class #{{ classroom.id }}</span><h3>{{ classroom.name }}</h3></div>
          <span class="status-pill" :class="classroom.status === 'ACTIVE' ? 'status-pill--on' : ''">{{ classroom.status === 'ACTIVE' ? 'Active' : 'Archived' }}</span>
        </div>
        <p>{{ classroom.description || 'No description' }}</p>
        <dl class="class-card__meta">
          <div><dt>Students</dt><dd>{{ classroom.studentCount }}</dd></div>
          <div><dt>Exams</dt><dd>{{ classroom.examCount }}</dd></div>
        </dl>
      </article>
    </div>
  </AppCard>

  <AppModal
    v-if="showCreateDialog"
    title="Create Class"
    description="Set a name and optional description for this class."
    :busy="isSavingClass"
    @close="closeCreateDialog"
  >
    <form id="create-class-form" class="class-create-dialog-form" @submit.prevent="saveClass">
      <label class="form-field">
        <span class="form-label">Name</span>
        <input v-model.trim="classForm.name" class="form-input" maxlength="100" required autofocus placeholder="e.g. Spring Prep" />
      </label>
      <label class="form-field">
        <span class="form-label">Description</span>
        <textarea v-model.trim="classForm.description" class="form-input" rows="3" maxlength="500" placeholder="Optional" />
      </label>
      <p v-if="classCreateError && props.examTypeCode !== 'SAT'" class="error-text" role="alert">{{ classCreateError }}</p>
    </form>
    <template #footer>
      <AppButton type="button" variant="secondary" :disabled="isSavingClass" @click="closeCreateDialog">Cancel</AppButton>
      <AppButton type="submit" form="create-class-form" :disabled="isSavingClass || !classForm.name.trim()">
        {{ isSavingClass ? 'Creating…' : 'Create Class' }}
      </AppButton>
    </template>
  </AppModal>

</template>

<style scoped>
.class-create-dialog-form { display: grid; gap: 16px; }
.class-create-dialog-form .form-field { display: grid; gap: 7px; }
.class-create-dialog-form .form-input { box-sizing: border-box; width: 100%; min-height: 42px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 9px 12px; background: #fbfdff; color: var(--color-text); font: inherit; font-size: 15px; }
.class-create-dialog-form textarea.form-input { min-height: 88px; resize: vertical; }
</style>
