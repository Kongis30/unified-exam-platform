<script setup>
import AppButton from '@/components/AppButton.vue'
import AppModal from '@/components/AppModal.vue'

// 各考试模块共用创建表单，创建与跳转由所属模块负责。
const props = defineProps({
  examType: { type: String, required: true },
  groups: { type: Array, default: () => [] },
  busy: Boolean,
  error: { type: String, default: '' },
})
const name = defineModel('name', { type: String, default: '' })
const description = defineModel('description', { type: String, default: '' })
const groupId = defineModel('groupId', { default: '' })
const duration = defineModel('duration', { default: 0 })
const emit = defineEmits(['close', 'submit', 'clear-error'])
</script>

<template>
  <AppModal
    title="Create Paper"
    :description="`Create ${props.examType === 'PSAT' ? 'a' : 'an'} ${props.examType} paper and continue in the paper editor.`"
    width="620px"
    panel-class="app-modal--paper-create"
    :busy="busy"
    @close="emit('close')"
  >
    <form id="create-paper-form" class="create-paper-form" novalidate @submit.prevent="emit('submit')">
      <div class="paper-structure-note">
        <strong>{{ examType === 'SHSAT' ? 'Official structure included' : 'Start with a draft' }}</strong>
        <span v-if="examType === 'SHSAT'">The paper editor will open with ELA, Math, and official question types ready.</span>
        <span v-else>The paper editor will open so you can add sections, modules, and questions.</span>
      </div>
      <div class="create-paper-grid">
        <label class="create-paper-field create-paper-field--wide">
          <span>Paper Name</span>
          <input v-model.trim="name" class="form-input" maxlength="200" :placeholder="`e.g. ${examType} Practice Test 1`" @input="emit('clear-error')" />
        </label>
        <label class="create-paper-field create-paper-field--wide">
          <span>Description</span>
          <textarea v-model.trim="description" class="form-input" rows="2" maxlength="2000" placeholder="Optional note shown in paper lists" />
        </label>
        <label class="create-paper-field">
          <span>Folder</span>
          <select v-model="groupId" class="form-input">
            <option value="">Default Folder</option>
            <option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option>
          </select>
        </label>
        <label class="create-paper-field">
          <span>Duration (minutes)</span>
          <input v-model.number="duration" class="form-input" type="number" min="1" step="1" />
        </label>
      </div>
      <p class="create-paper-hint">New papers are saved as offline drafts.</p>
      <p v-if="error" class="create-paper-error" role="alert">{{ error }}</p>
    </form>
    <template #footer>
      <AppButton variant="secondary" type="button" :disabled="busy" @click="emit('close')">Cancel</AppButton>
      <AppButton type="submit" form="create-paper-form" :disabled="busy">{{ busy ? 'Creating…' : 'Create and Edit' }}</AppButton>
    </template>
  </AppModal>
</template>

<style scoped>
.create-paper-form { display: grid; gap: 14px; }
.paper-structure-note { display: grid; gap: 4px; border: 1px solid #cfe0ff; border-radius: var(--radius-md); padding: 12px 14px; color: #33415c; background: #f5f8ff; font-size: 13px; line-height: 1.45; }
.paper-structure-note strong { color: var(--color-primary-strong); font-size: 14px; }
.create-paper-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.create-paper-field { display: grid; min-width: 0; gap: 6px; color: #24314a; font-size: 14px; font-weight: 650; }
.create-paper-field--wide { grid-column: 1 / -1; }
.create-paper-field .form-input { box-sizing: border-box; width: 100%; min-height: 40px; border: 1px solid var(--color-border); border-radius: 8px; padding: 8px 10px; color: var(--color-text); background: #fbfdff; font-size: 14px; font-weight: 400; }
.create-paper-field textarea.form-input { min-height: 68px; resize: vertical; }
.create-paper-hint { margin: 0; color: var(--color-muted); font-size: 12px; }
.create-paper-error { margin: 0; color: #b42318; font-size: 13px; }
@media (max-width: 500px) { .create-paper-grid { grid-template-columns: 1fr; } .create-paper-field--wide { grid-column: auto; } }
</style>
