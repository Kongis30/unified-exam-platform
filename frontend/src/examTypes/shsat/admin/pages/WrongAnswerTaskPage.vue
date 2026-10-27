<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import AppButton from '@/components/AppButton.vue';
import AppCard from '@/components/AppCard.vue';
import AdminLayout from '@/components/admin/AdminLayout.vue';
import { adminApi } from '@shsat/admin/services/adminApi';

const route = useRoute();
const router = useRouter();

const loading = ref(false);
const errorMessage = ref('');
const task = ref(null);
const assignments = ref([]);
const returnTo = computed(() => typeof route.query.returnTo === 'string' ? route.query.returnTo : '');
const returnLabel = computed(() => typeof route.query.returnLabel === 'string'
  ? route.query.returnLabel
  : 'Back to Class Results');

function unwrapResponse(response, fallbackMessage) {
  if (response?.success === false) {
    throw new Error(response.message || fallbackMessage);
  }

  return response?.data ?? response;
}

function formatDateTime(value) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function getStatusMeta(status) {
  const normalizedStatus = String(status || '').toUpperCase();
  const labels = {
    COMPLETED: 'Completed',
    IN_PROGRESS: 'In Progress',
    NOT_STARTED: 'Not Started',
    RETRY_REQUIRED: 'More Practice Needed',
    ENDED: 'Ended',
    NO_SOURCE_ATTEMPT: 'No source attempt',
    NO_WRONG_ANSWERS: 'No review questions',
  };

  return {
    label: labels[normalizedStatus] || 'Not Started',
    className: `task-status--${normalizedStatus.toLowerCase() || 'muted'}`,
  };
}

function formatAccuracy(value) {
  return value === null || value === undefined ? '-' : `${Number(value).toFixed(2)}%`;
}

function formatProgress(assignment) {
  return `${assignment.answeredQuestions || 0} / ${assignment.roundQuestionCount ?? assignment.totalQuestions ?? 0}`;
}

function goBack() {
  if (returnTo.value) {
    router.push(returnTo.value);
    return;
  }

  router.push({
    name: 'admin-class-exam-results',
    params: {
      classId: route.params.classId,
      examId: route.params.examId,
    },
  });
}

function openPracticeReport(assignment) {
  if (!assignment.practiceAttemptId) {
    return;
  }

  router.push({
    name: 'student-attempt-report',
    params: { attemptId: assignment.practiceAttemptId },
    query: { returnTo: route.fullPath, returnLabel: 'Back to Review Assignment' },
  });
}

async function loadTask() {
  loading.value = true;
  errorMessage.value = '';

  try {
    const response = unwrapResponse(
      await adminApi.getWrongAnswerTask(route.params.taskId),
      'Failed to load wrong-answer task'
    );
    task.value = response?.task || null;
    assignments.value = response?.assignments || [];
  } catch (error) {
    errorMessage.value = error.message || 'Failed to load wrong-answer task. Please try again later.';
  } finally {
    loading.value = false;
  }
}

onMounted(loadTask);
</script>

<template>
  <AdminLayout>
    <section class="page-shell wrong-answer-task-page">
      <button class="wrong-answer-task-page__back" type="button" @click="goBack">
        <span aria-hidden="true">←</span>
        <span>{{ returnLabel }}</span>
      </button>

      <section class="wrong-answer-task-page__hero">
        <div>
          <p class="page-subtitle">Review Assignment</p>
          <h1 class="page-title">{{ task?.title || (loading ? 'Loading task details…' : 'Task details unavailable') }}</h1>
          <div v-if="task" class="wrong-answer-task-page__context">
            <p><span>Exam</span><strong>{{ task?.examTitle || `Exam #${route.params.examId}` }}</strong></p>
            <p><span>Paper</span><strong>{{ task?.paperName || 'Unavailable' }}</strong></p>
            <p><span>Class</span><strong>{{ task?.className || `Class #${route.params.classId}` }}</strong></p>
          </div>
        </div>
        <div v-if="task" class="wrong-answer-task-page__hero-stats">
          <div>
            <strong>{{ task?.completedCount || 0 }}</strong>
            <span>Completed</span>
          </div>
          <div>
            <strong>{{ task?.eligibleCount || 0 }}</strong>
            <span>Eligible</span>
          </div>
          <div>
            <strong>{{ task?.assignedCount || 0 }}</strong>
            <span>Assigned</span>
          </div>
        </div>
      </section>

      <AppCard v-if="task?.description || task?.startAt || task?.endAt" title="Task information">
        <div class="wrong-answer-task-page__info">
          <p v-if="task?.description">{{ task.description }}</p>
          <span v-if="task?.startAt || task?.endAt">
            Available {{ task?.startAt ? formatDateTime(task.startAt) : 'now' }}
            <template v-if="task?.endAt"> – {{ formatDateTime(task.endAt) }}</template>
          </span>
        </div>
      </AppCard>

      <AppCard title="Student progress" subtitle="Students can repeat the assignment during its availability window until every assigned question is answered correctly.">
        <div v-if="loading" class="task-state">Loading task progress...</div>
        <div v-else-if="errorMessage" class="task-state task-state--error">
          <p>{{ errorMessage }}</p>
          <AppButton variant="secondary" @click="loadTask">Retry</AppButton>
        </div>
        <div v-else-if="assignments.length === 0" class="task-state">No student assignments found.</div>
        <div v-else class="task-table-wrap">
          <table class="admin-table task-table">
            <colgroup>
              <col style="width: 22%">
              <col style="width: 13%">
              <col style="width: 13%">
              <col style="width: 17%">
              <col style="width: 21%">
              <col style="width: 14%">
            </colgroup>
            <thead>
              <tr>
                <th>Student</th>
                <th>Progress</th>
                <th>Accuracy</th>
                <th>Status</th>
                <th>Completed</th>
                <th aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="assignment in assignments" :key="assignment.assignmentId">
                <td data-label="Student">
                  <strong>{{ assignment.studentName }}</strong>
                  <small v-if="assignment.studentNumber">{{ assignment.studentNumber }}</small>
                </td>
                <td data-label="Progress">
                  {{ formatProgress(assignment) }}
                  <small>{{ assignment.remainingQuestionCount ?? assignment.totalQuestions ?? 0 }} questions left</small>
                </td>
                <td data-label="Accuracy">{{ formatAccuracy(assignment.accuracy) }}</td>
                <td data-label="Status">
                  <span class="task-status" :class="getStatusMeta(assignment.status).className">
                    {{ getStatusMeta(assignment.status).label }}
                  </span>
                </td>
                <td data-label="Completed">{{ formatDateTime(assignment.completedAt) }}</td>
                <td class="task-table__actions" :class="{ 'task-table__actions--empty': !assignment.practiceAttemptId }" data-label="Actions">
                  <AppButton
                    v-if="assignment.practiceAttemptId"
                    variant="secondary"
                    @click="openPracticeReport(assignment)"
                  >
                    View Report
                  </AppButton>
                  <span v-else class="muted-text">-</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </AppCard>
    </section>
  </AdminLayout>
</template>

<style scoped>
.wrong-answer-task-page {
  display: grid;
  gap: 20px;
}

.wrong-answer-task-page__back {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  gap: 8px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 9px 14px;
  color: var(--color-primary-strong);
  background: #ffffff;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.wrong-answer-task-page__hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  border: 1px solid rgba(219, 230, 247, 0.9);
  border-radius: var(--radius-lg);
  padding: clamp(22px, 3vw, 32px);
  background: #ffffff;
  box-shadow: var(--shadow-card);
}

.wrong-answer-task-page__context {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}

.wrong-answer-task-page__context p {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 0;
}

.wrong-answer-task-page__context span {
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
}

.wrong-answer-task-page__context strong {
  color: var(--color-text);
  font-size: 15px;
}

.wrong-answer-task-page__hero-stats {
  display: flex;
  gap: 28px;
  flex: 0 0 auto;
}

.wrong-answer-task-page__hero-stats div {
  display: grid;
  gap: 4px;
  text-align: right;
}

.wrong-answer-task-page__hero-stats strong {
  font-size: 28px;
}

.wrong-answer-task-page__hero-stats span,
.wrong-answer-task-page__info span,
.task-table small {
  color: var(--color-muted);
  font-size: 12px;
}

.wrong-answer-task-page__info p {
  margin: 0 0 8px;
  color: var(--color-text);
  line-height: 1.55;
}

.task-state {
  display: grid;
  min-height: 150px;
  place-items: center;
  gap: 12px;
  color: var(--color-muted);
  text-align: center;
}

.task-state p {
  margin: 0;
}

.task-state--error {
  color: #b42332;
}

.task-table-wrap {
  overflow-x: auto;
}

.task-table {
  width: 100%;
  min-width: 1000px;
  table-layout: fixed;
  border-collapse: collapse;
}

.task-table th,
.task-table td {
  border-bottom: 1px solid var(--color-border);
  padding: 12px 14px;
  text-align: center;
  vertical-align: middle;
  font-size: 13px;
}

.task-table th {
  color: #24314a;
  background: var(--color-surface-soft);
  font-weight: 800;
}

.task-table td strong,
.task-table td small {
  display: block;
}

.task-table td small {
  margin-top: 4px;
}

.task-table__actions {
  white-space: nowrap;
}

.task-table td:nth-child(6) {
  white-space: nowrap;
}

.task-status {
  display: inline-flex;
  border-radius: 999px;
  padding: 5px 9px;
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}

.task-status--completed {
  color: #13795b;
  background: #e4f6ee;
}

.task-status--in_progress {
  color: #9b5b00;
  background: #fff3d6;
}

.task-status--retry_required {
  color: #2459bf;
  background: #eaf1ff;
}

.task-status--ended {
  color: #8a4b08;
  background: #fff0df;
}

.task-status--not_started,
.task-status--no_source_attempt,
.task-status--no_wrong_answers {
  color: #52627a;
  background: #edf2f8;
}

.muted-text {
  color: var(--color-muted);
}

@media (max-width: 760px) {
  .wrong-answer-task-page__hero {
    align-items: flex-start;
    flex-direction: column;
  }

  .wrong-answer-task-page__hero-stats {
    width: 100%;
    justify-content: space-between;
  }

  .wrong-answer-task-page__hero-stats div {
    text-align: left;
  }

  .task-table-wrap {
    overflow: visible;
  }

  .task-table {
    display: block;
    min-width: 0;
  }

  .task-table thead {
    display: none;
  }

  .task-table tbody {
    display: grid;
    gap: 12px;
  }

  .task-table tbody tr {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: 12px;
    background: #fff;
  }

  .task-table th,
  .task-table td {
    min-width: 0;
    border-bottom: 0;
    padding: 12px;
    text-align: left;
    overflow-wrap: anywhere;
  }

  .task-table td {
    display: grid;
    align-content: start;
    gap: 5px;
  }

  .task-table td::before {
    content: attr(data-label);
    color: var(--color-muted);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .task-table td:first-child {
    grid-column: 1 / -1;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface-soft);
  }

  .task-table td:last-child {
    grid-column: 1 / -1;
    border-top: 1px solid var(--color-border);
  }

  .task-table td.task-table__actions--empty {
    display: none;
  }

  .task-table__actions {
    justify-items: start;
  }
}
</style>
