<script setup>
defineProps({
  title: { type: String, required: true },
  statusLabel: { type: String, required: true },
  statusTone: { type: String, default: 'draft' },
  metadata: { type: Array, default: () => [] },
})
</script>

<template>
  <article class="admin-exam-card" :class="`admin-exam-card--${statusTone}`">
    <div class="admin-exam-card__header">
      <h3>{{ title }}</h3>
      <span class="admin-exam-card__status" :class="`admin-exam-card__status--${statusTone}`">{{ statusLabel }}</span>
    </div>
    <dl class="admin-exam-card__meta">
      <div
        v-for="item in metadata"
        :key="item.label"
        class="admin-exam-card__meta-item"
        :class="{ 'admin-exam-card__meta-item--wide': item.wide }"
      >
        <dt>{{ item.label }}</dt>
        <dd>{{ item.value }}</dd>
      </div>
    </dl>
    <div v-if="$slots.actions" class="admin-exam-card__actions"><slot name="actions" /></div>
  </article>
</template>

<style scoped>
.admin-exam-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 286px;
  gap: 12px;
  border: 1px solid rgba(219, 230, 247, 0.95);
  border-radius: 16px;
  padding: 14px;
  background: #fff;
  box-shadow: 0 12px 28px rgba(31, 75, 135, 0.06);
}

.admin-exam-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.admin-exam-card h3,
.admin-exam-card p { margin: 0; }

.admin-exam-card h3 {
  display: -webkit-box;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: 16px;
  line-height: 1.28;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.admin-exam-card__status {
  flex: 0 0 auto;
  max-width: 112px;
  overflow: hidden;
  border-radius: 999px;
  padding: 4px 9px;
  color: var(--color-muted);
  background: #f1f5f9;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.admin-exam-card__status--active { color: #16794c; background: #e8f7f1; }
.admin-exam-card__status--pending { color: var(--color-primary-strong); background: var(--color-primary-soft); }
.admin-exam-card__status--exhausted,
.admin-exam-card__status--completed,
.admin-exam-card__status--ended,
.admin-exam-card__status--draft { color: #64748b; background: #edf2f8; }

.admin-exam-card__meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-content: start; gap: 8px; margin: 0; }
.admin-exam-card__meta-item { min-width: 0; border: 1px solid var(--color-border); border-radius: 12px; padding: 8px 9px; background: #fbfdff; }
.admin-exam-card__meta-item--wide { grid-column: 1 / -1; }
.admin-exam-card__meta dt { color: var(--color-muted); font-size: 11px; font-weight: 800; }
.admin-exam-card__meta dd { margin: 3px 0 0; font-size: 13px; font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; }
.admin-exam-card__actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: auto; }
.admin-exam-card__actions :deep(button) { flex: 1 1 130px; width: auto; }
</style>
