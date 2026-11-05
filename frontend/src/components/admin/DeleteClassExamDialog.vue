<script setup>
import { onBeforeUnmount, ref } from 'vue'
import AppModal from '@/components/AppModal.vue'
import AppButton from '@/components/AppButton.vue'
import { deleteClassExam } from '@/api/platform'

const props = defineProps({ classId: { type: [String, Number], required: true }, examId: { type: [String, Number], required: true }, title: { type: String, required: true } })
const emit = defineEmits(['close', 'deleted'])
const remaining = ref(5)
const busy = ref(false)
const error = ref('')
const timer = window.setInterval(() => { remaining.value = Math.max(0, remaining.value - 1); if (!remaining.value) window.clearInterval(timer) }, 1000)
onBeforeUnmount(() => window.clearInterval(timer))

async function confirm() {
  if (busy.value || remaining.value) return
  busy.value = true
  try {
    await deleteClassExam(props.classId, props.examId)
    emit('deleted')
  } catch (requestError) {
    error.value = requestError.message || 'Unable to delete this class exam.'
  } finally { busy.value = false }
}
</script>

<template>
  <AppModal title="Delete this class exam?" :busy="busy" @close="emit('close')">
    <p>Delete “{{ title }}” from this class? Its class-specific student attempts, answers, scores, reports, and review assignments will be permanently deleted. Records shared with other classes are retained.</p>
    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    <template #footer>
      <AppButton variant="secondary" :disabled="busy" @click="emit('close')">Cancel</AppButton>
      <AppButton variant="danger" :disabled="busy || remaining > 0" @click="confirm">{{ busy ? 'Deleting…' : remaining ? `Delete (${remaining})` : 'Delete class exam' }}</AppButton>
    </template>
  </AppModal>
</template>
