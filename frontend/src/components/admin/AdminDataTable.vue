<template>
  <table class="admin-data-table"><slot /></table>
</template>

<style scoped>
.admin-data-table { width: 100%; min-width: 780px; border-collapse: collapse; }
.admin-data-table :deep(th),
.admin-data-table :deep(td) {
  border-bottom: 1px solid var(--color-border);
  padding: 10px 12px;
  vertical-align: middle;
  font-size: 16px;
  line-height: 1.45;
}
.admin-data-table :deep(th),
.admin-data-table :deep(td) { text-align: center; }
.admin-data-table :deep(th:first-child),
.admin-data-table :deep(td:first-child) { text-align: left; }
.admin-data-table :deep(th) {
  color: #24314a;
  background: var(--color-surface-soft);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.4;
}
.admin-data-table :deep(th:last-child),
.admin-data-table :deep(td:last-child) { text-align: center; }
.admin-data-table :deep(td strong),
.admin-data-table :deep(td small) { display: block; }
.admin-data-table :deep(td strong) { font-size: 16px; font-weight: 650; line-height: 1.4; }
.admin-data-table :deep(td small) { margin-top: 2px; color: var(--color-muted); font-size: 14px; }
.admin-data-table :deep(.program-badge),
.admin-data-table :deep(.status-pill) { font-size: 13px; }
.admin-data-table.paper-table :deep(.paper-actions-header),
.admin-data-table.paper-table :deep(.paper-actions-cell) { text-align: center; }
.admin-data-table :deep(.action-column-header),
.admin-data-table :deep(.action-column-cell) { text-align: center; }
</style>
