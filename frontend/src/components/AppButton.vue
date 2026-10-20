<script setup>
defineProps({
  variant: {
    type: String,
    default: 'primary',
    validator: (value) => ['primary', 'secondary', 'ghost', 'danger'].includes(value),
  },
  type: {
    type: String,
    default: 'button',
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});
</script>

<template>
  <button
    class="app-button"
    :class="`app-button--${variant}`"
    :type="type"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>

<style scoped>
.app-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 0 18px;
  font-weight: 700;
  cursor: pointer;
  transition:
    transform 160ms ease,
    box-shadow 160ms ease,
    background 160ms ease,
    border-color 160ms ease;
}

.app-button:hover:not(:disabled) {
  transform: translateY(-1px);
}

.app-button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.app-button--primary {
  color: #ffffff;
  background: linear-gradient(135deg, var(--color-primary), #5f8ff5);
  box-shadow: 0 12px 24px rgba(47, 111, 237, 0.22);
}

.app-button--primary:hover:not(:disabled) {
  box-shadow: 0 16px 30px rgba(47, 111, 237, 0.28);
}

.app-button--secondary {
  color: var(--color-primary-strong);
  background: var(--color-primary-soft);
  border-color: #cfe0ff;
}

.app-button--ghost {
  color: var(--color-muted);
  background: transparent;
}

.app-button--danger {
  color: #ffffff;
  background: #c93636;
  box-shadow: 0 10px 20px rgba(201, 54, 54, 0.18);
}

.app-button--danger:hover:not(:disabled) {
  background: #ad2929;
  box-shadow: 0 14px 24px rgba(201, 54, 54, 0.24);
}
</style>
