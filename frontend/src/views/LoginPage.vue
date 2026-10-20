<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import { login } from '@/api/platform'
import { authState } from '@/auth'

const route = useRoute()
const router = useRouter()
const username = ref('admin')
const password = ref('1')
const loading = ref(false)
const errorMessage = ref('')
const fieldErrors = ref({})
const submitted = ref(false)
const canSubmit = computed(() => !loading.value)

function validateForm() {
  const errors = {}
  if (!username.value.trim()) errors.username = 'Please enter your username.'
  if (!password.value) errors.password = 'Please enter your password.'
  fieldErrors.value = errors
  return Object.keys(errors).length === 0
}

async function handleLogin() {
  submitted.value = true
  errorMessage.value = ''
  if (!validateForm() || loading.value) return

  loading.value = true
  try {
    authState.user = await login({ username: username.value.trim(), password: password.value })
    authState.loaded = true
    const redirect = route.query.redirect
    router.replace(typeof redirect === 'string' && redirect ? redirect : '/')
  } catch (error) {
    errorMessage.value = error.message || 'Login failed. Please try again later.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-page__intro">
      <div class="login-page__brand">
        <img class="login-page__logo" src="/logo.png" alt="Unified Exam Platform" />
        <div class="login-page__brand-copy">
          <span>Online Assessment Platform</span>
          <strong>Unified Exam Platform</strong>
        </div>
      </div>
      <div class="login-page__art" aria-hidden="true">
        <div class="login-page__art-card login-page__art-card--primary"></div>
        <div class="login-page__art-card login-page__art-card--secondary"></div>
        <span class="login-page__art-orb login-page__art-orb--large"></span>
        <span class="login-page__art-orb login-page__art-orb--small"></span>
      </div>
    </section>

    <AppCard title="Account Sign In" subtitle="Use your platform account to enter the SAT system or SHSAT.">
      <form class="login-page__form" novalidate @submit.prevent="handleLogin">
        <label class="form-field">
          <span class="form-label">Username</span>
          <input
            v-model="username"
            class="form-input"
            autocomplete="username"
            placeholder="Please enter your username"
            :class="{ 'form-input--error': submitted && fieldErrors.username }"
            @blur="submitted && validateForm()"
            @input="submitted && validateForm()"
          />
          <span v-if="submitted && fieldErrors.username" class="field-error">
            {{ fieldErrors.username }}
          </span>
        </label>

        <label class="form-field">
          <span class="form-label">Password</span>
          <input
            v-model="password"
            class="form-input"
            type="password"
            autocomplete="current-password"
            placeholder="Please enter your password"
            :class="{ 'form-input--error': submitted && fieldErrors.password }"
            @blur="submitted && validateForm()"
            @input="submitted && validateForm()"
          />
          <span v-if="submitted && fieldErrors.password" class="field-error">
            {{ fieldErrors.password }}
          </span>
        </label>

        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>

        <AppButton class="login-page__submit" type="submit" :disabled="!canSubmit">
          {{ loading ? 'Signing in...' : 'Sign In' }}
        </AppButton>
      </form>
    </AppCard>
  </main>
</template>

<style scoped>
.login-page {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
  gap: clamp(28px, 7vw, 96px);
  align-items: center;
  width: min(1040px, calc(100% - 32px));
  min-height: 100vh;
  margin: 0 auto;
  padding: var(--space-page) 0;
}

.login-page__intro {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  min-height: 540px;
  padding: 20px 0;
  overflow: hidden;
}

.login-page__intro::before {
  position: absolute;
  inset: 88px 28px 28px 0;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 36px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.74), rgba(244, 247, 252, 0.92)),
    repeating-linear-gradient(
      90deg,
      transparent 0,
      transparent 72px,
      rgba(148, 163, 184, 0.08) 72px,
      rgba(148, 163, 184, 0.08) 73px
    ),
    repeating-linear-gradient(
      180deg,
      transparent 0,
      transparent 72px,
      rgba(148, 163, 184, 0.08) 72px,
      rgba(148, 163, 184, 0.08) 73px
    );
  content: "";
  z-index: -1;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.06);
}

.login-page__logo {
  width: min(100%, 156px);
  height: auto;
  object-fit: contain;
  filter: drop-shadow(0 14px 28px rgba(31, 41, 55, 0.08));
}

.login-page__brand {
  position: relative;
  z-index: 2;
  display: grid;
  gap: 18px;
}

.login-page__brand-copy {
  display: grid;
  gap: 8px;
  color: var(--color-text);
}

.login-page__brand-copy span {
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.login-page__brand-copy strong {
  max-width: 280px;
  font-size: clamp(32px, 5vw, 52px);
  line-height: 0.95;
  font-weight: 850;
  letter-spacing: -0.06em;
}

.login-page__art {
  position: absolute;
  inset: 0;
}

.login-page__art-card {
  position: absolute;
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 28px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0.18));
  backdrop-filter: blur(14px);
  box-shadow: 0 24px 48px rgba(148, 163, 184, 0.18);
}

.login-page__art-card--primary {
  right: 72px;
  bottom: 68px;
  width: min(44vw, 320px);
  height: 200px;
  transform: rotate(-6deg);
}

.login-page__art-card--secondary {
  left: 76px;
  bottom: 112px;
  width: min(30vw, 190px);
  height: 140px;
  border-color: rgba(47, 111, 237, 0.12);
  background: linear-gradient(180deg, rgba(246, 249, 255, 0.82), rgba(233, 240, 255, 0.36));
}

.login-page__art-orb {
  position: absolute;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(47, 111, 237, 0.16), rgba(47, 111, 237, 0));
  pointer-events: none;
}

.login-page__art-orb--large {
  right: 56px;
  top: 104px;
  width: 220px;
  height: 220px;
}

.login-page__art-orb--small {
  left: 84px;
  bottom: 72px;
  width: 128px;
  height: 128px;
  background: radial-gradient(circle, rgba(15, 23, 42, 0.08), rgba(15, 23, 42, 0));
}

.login-page__form {
  display: grid;
  gap: 18px;
}

.login-page__submit {
  width: 100%;
}

.form-input--error {
  border-color: rgba(199, 55, 71, 0.72);
  background: #fffafb;
}

.field-error {
  color: var(--color-danger);
  font-size: 13px;
}

@media (max-width: 820px) {
  .login-page {
    grid-template-columns: 1fr;
  }

  .login-page__intro {
    min-height: 260px;
  }

  .login-page__intro::before {
    inset: 72px 0 0 0;
  }

  .login-page__art-card--primary {
    right: 24px;
    bottom: 32px;
    width: 220px;
    height: 136px;
  }

  .login-page__art-card--secondary {
    left: 28px;
    bottom: 64px;
    width: 132px;
    height: 96px;
  }

  .login-page__art-orb--large {
    right: 8px;
    top: 88px;
    width: 160px;
    height: 160px;
  }

  .login-page__art-orb--small {
    left: 8px;
    bottom: 28px;
    width: 96px;
    height: 96px;
  }
}
</style>
