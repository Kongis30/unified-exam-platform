<template>
  <section class="admin-workspace-section"><slot /></section>
</template>

<style scoped>
.admin-workspace-section {
  display: grid;
  gap: 20px;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
  padding: 20px;
  background: rgba(255, 255, 255, 0.86);
}
</style>
