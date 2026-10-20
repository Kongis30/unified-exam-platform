<script setup>
import { useSlots } from 'vue';

const slots = useSlots();

defineProps({
  title: {
    type: String,
    default: '',
  },
  subtitle: {
    type: String,
    default: '',
  },
});
</script>

<template>
  <section class="app-card">
    <header v-if="title || subtitle || slots.actions" class="app-card__header" :class="{ 'app-card__header--actions': slots.actions }">
      <div class="app-card__heading">
        <h2 v-if="title" class="app-card__title">{{ title }}</h2>
        <p v-if="subtitle" class="app-card__subtitle">{{ subtitle }}</p>
      </div>
      <div v-if="slots.actions" class="app-card__actions">
        <slot name="actions" />
      </div>
    </header>
    <slot />
  </section>
</template>

<style scoped>
.app-card {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  border: 1px solid rgba(219, 230, 247, 0.9);
  border-radius: var(--radius-lg);
  padding: clamp(20px, 3vw, 28px);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(255, 255, 255, 0.9)),
    var(--color-surface);
  box-shadow: var(--shadow-card);
}

.app-card__header {
  margin-bottom: 20px;
}

.app-card__header--actions {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.app-card__heading {
  min-width: 0;
}

.app-card__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
}

.app-card__title {
  margin: 0;
  font-size: 20px;
  line-height: 1.2;
  letter-spacing: -0.02em;
}

.app-card__subtitle {
  margin: 8px 0 0;
  color: var(--color-muted);
  font-size: 14px;
}

@media (max-width: 640px) {
  .app-card__header--actions {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .app-card__actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
