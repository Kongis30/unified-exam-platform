<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';

import AppButton from '@/components/AppButton.vue';
import { authApi } from '@/services/authApi';
import { getEnglishErrorMessage } from '@shsat/admin/services/http';
import { authState, clearSession, isAdmin, isStudent } from '@shsat/admin/authBridge';

const route = useRoute();
const router = useRouter();
const showUserMenu = ref(false);
const showLogoutConfirm = ref(false);
const showPasswordModal = ref(false);
const changingPassword = ref(false);
const passwordError = ref('');
const passwordNotice = ref('');
const userMenuRef = ref(null);

const passwordForm = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
});

function containsCjkCharacters(value) {
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(String(value || ''));
}

const userLabel = computed(() => {
  const candidate = authState.user?.realName || authState.user?.username || '';
  if (candidate && !containsCjkCharacters(candidate)) {
    return candidate;
  }
  if (isAdmin()) {
    return 'Admin User';
  }
  if (isStudent()) {
    return 'Student User';
  }
  return 'Signed-in User';
});

const showSystemSelectLink = computed(() => {
  return route.name === 'admin' || route.name === 'student';
});

function resetPasswordForm() {
  passwordForm.currentPassword = '';
  passwordForm.newPassword = '';
  passwordForm.confirmPassword = '';
  passwordError.value = '';
}

function toggleUserMenu() {
  showUserMenu.value = !showUserMenu.value;
}

function handleDocumentClick(event) {
  if (!showUserMenu.value) {
    return;
  }

  if (!userMenuRef.value?.contains(event.target)) {
    showUserMenu.value = false;
  }
}

function requestLogout() {
  showUserMenu.value = false;
  showLogoutConfirm.value = true;
}

function handleLogout() {
  clearSession();
  router.replace({ name: 'login' });
}

function openPasswordModal() {
  showUserMenu.value = false;
  passwordNotice.value = '';
  resetPasswordForm();
  showPasswordModal.value = true;
}

function closePasswordModal() {
  if (changingPassword.value) {
    return;
  }

  showPasswordModal.value = false;
  resetPasswordForm();
}

async function submitPasswordChange() {
  passwordError.value = '';
  passwordNotice.value = '';

  if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
    passwordError.value = 'All password fields are required.';
    return;
  }

  if (passwordForm.newPassword.length < 6) {
    passwordError.value = 'New password must be at least 6 characters.';
    return;
  }

  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    passwordError.value = 'New passwords do not match.';
    return;
  }

  changingPassword.value = true;
  try {
    await authApi.changePassword({
      currentPassword: passwordForm.currentPassword,
      newPassword: passwordForm.newPassword,
    });
    passwordNotice.value = 'Password changed successfully.';
    showPasswordModal.value = false;
    resetPasswordForm();
  } catch (error) {
    passwordError.value = getEnglishErrorMessage(error, 'Failed to change password. Please check your current password and try again.');
  } finally {
    changingPassword.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', handleDocumentClick);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick);
});
</script>

<template>
  <div class="main-layout">
    <header class="main-layout__header">
      <RouterLink class="main-layout__brand" to="/student">
        <span class="main-layout__mark">
          <img src="/logo.png" alt="SHSAT logo" />
        </span>
        <span>
          <strong>Jin SHSAT</strong>
          <small>System</small>
        </span>
      </RouterLink>

      <nav class="main-layout__nav" aria-label="Main Navigation">
        <RouterLink v-if="showSystemSelectLink" to="/system-select">System Select</RouterLink>
        <RouterLink v-if="isStudent()" to="/student">Student Portal</RouterLink>
        <RouterLink v-if="isAdmin()" to="/admin">Admin Portal</RouterLink>
      </nav>

      <div class="main-layout__user">
        <div ref="userMenuRef" class="main-layout__user-menu">
          <button
            class="main-layout__user-trigger"
            type="button"
            :aria-expanded="showUserMenu"
            @click.stop="toggleUserMenu"
          >
            {{ userLabel }}
          </button>
          <div v-if="showUserMenu" class="main-layout__user-dropdown">
            <button type="button" @click="openPasswordModal">Reset Password</button>
          </div>
        </div>
        <AppButton variant="ghost" @click="requestLogout">Sign Out</AppButton>
      </div>
    </header>

    <main class="main-layout__content">
      <slot />
    </main>

    <Teleport to="body">
      <div v-if="showLogoutConfirm" class="layout-modal-backdrop" @click.self="showLogoutConfirm = false">
        <section class="layout-modal-card layout-modal-card--narrow">
          <header class="layout-modal-card__header">
            <div>
              <h3>Confirm Sign Out</h3>
              <p>You will need to sign in again to continue.</p>
            </div>
          </header>
          <footer class="layout-modal-card__footer">
            <AppButton variant="secondary" type="button" @click="showLogoutConfirm = false">Cancel</AppButton>
            <AppButton type="button" @click="handleLogout">Sign Out</AppButton>
          </footer>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showPasswordModal" class="layout-modal-backdrop" @click.self="closePasswordModal">
        <form class="layout-modal-card" novalidate @submit.prevent="submitPasswordChange">
          <header class="layout-modal-card__header">
            <div>
              <h3>Reset Password</h3>
              <p>Enter your current password before setting a new one.</p>
            </div>
            <button
              class="layout-modal-card__close"
              type="button"
              aria-label="Close password dialog"
              @click="closePasswordModal"
            >
              &times;
            </button>
          </header>

          <label class="layout-form-field">
            <span>Current Password</span>
            <input v-model="passwordForm.currentPassword" type="password" autocomplete="current-password" />
          </label>
          <label class="layout-form-field">
            <span>New Password</span>
            <input v-model="passwordForm.newPassword" type="password" autocomplete="new-password" />
            <small>Password must be at least 6 characters.</small>
          </label>
          <label class="layout-form-field">
            <span>Confirm New Password</span>
            <input v-model="passwordForm.confirmPassword" type="password" autocomplete="new-password" />
          </label>

          <p v-if="passwordError" class="layout-error-text">{{ passwordError }}</p>
          <p v-if="passwordNotice" class="layout-success-text">{{ passwordNotice }}</p>

          <footer class="layout-modal-card__footer">
            <AppButton variant="secondary" type="button" @click="closePasswordModal">Cancel</AppButton>
            <AppButton type="submit" :disabled="changingPassword">
              {{ changingPassword ? 'Saving...' : 'Save Password' }}
            </AppButton>
          </footer>
        </form>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.main-layout {
  min-height: 100vh;
}

.main-layout__header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 24px;
  border-bottom: 1px solid rgba(219, 230, 247, 0.86);
  padding: 14px var(--space-page);
  background: rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(16px);
}

.main-layout__brand {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}

.main-layout__brand strong,
.main-layout__brand small {
  display: block;
}

.main-layout__brand small {
  color: var(--color-muted);
  font-size: 12px;
}

.main-layout__mark {
  display: inline-grid;
  width: 42px;
  height: 42px;
  place-items: center;
  overflow: hidden;
  border: 1px solid rgba(219, 230, 247, 0.9);
  border-radius: 14px;
  background: #ffffff;
  box-shadow: 0 12px 24px rgba(47, 111, 237, 0.22);
}

.main-layout__mark img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.main-layout__nav {
  display: flex;
  gap: 8px;
}

.main-layout__nav a {
  border-radius: 999px;
  padding: 8px 14px;
  color: var(--color-muted);
  font-weight: 700;
}

.main-layout__nav a.router-link-active {
  color: var(--color-primary-strong);
  background: var(--color-primary-soft);
}

.main-layout__user {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--color-muted);
  font-size: 14px;
}

.main-layout__user-menu {
  position: relative;
}

.main-layout__user-trigger {
  border: 0;
  border-radius: 999px;
  padding: 8px 12px;
  color: var(--color-primary-strong);
  font-weight: 700;
  background: var(--color-primary-soft);
  cursor: pointer;
}

.main-layout__user-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 20;
  min-width: 160px;
  border: 1px solid rgba(219, 230, 247, 0.9);
  border-radius: 14px;
  padding: 8px;
  background: #ffffff;
  box-shadow: 0 18px 40px rgba(31, 75, 135, 0.14);
}

.main-layout__user-dropdown button {
  width: 100%;
  border: 0;
  border-radius: 10px;
  padding: 9px 10px;
  color: var(--color-text);
  text-align: left;
  background: transparent;
  cursor: pointer;
}

.main-layout__user-dropdown button:hover {
  color: var(--color-primary-strong);
  background: var(--color-primary-soft);
}

.main-layout__content {
  min-width: 0;
  overflow-x: clip;
  padding: var(--space-page);
}

@media print {
  .main-layout__content {
    overflow: visible;
  }
}

.layout-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(12, 24, 44, 0.45);
}

.layout-modal-card {
  display: grid;
  gap: 16px;
  width: min(460px, 100%);
  border: 1px solid rgba(219, 230, 247, 0.9);
  border-radius: 22px;
  padding: 24px;
  background: #ffffff;
  box-shadow: 0 24px 60px rgba(12, 24, 44, 0.22);
}

.layout-modal-card--narrow {
  width: min(380px, 100%);
}

.layout-modal-card__header,
.layout-modal-card__footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.layout-modal-card__header h3,
.layout-modal-card__header p {
  margin: 0;
}

.layout-modal-card__header p {
  margin-top: 6px;
  color: var(--color-muted);
  font-size: 14px;
}

.layout-modal-card__footer {
  align-items: center;
  justify-content: flex-end;
}

.layout-modal-card__close {
  border: 0;
  color: var(--color-muted);
  font-size: 26px;
  line-height: 1;
  background: transparent;
  cursor: pointer;
}

.layout-form-field {
  display: grid;
  gap: 8px;
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 700;
}

.layout-form-field input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 11px 13px;
  color: var(--color-text);
  background: #ffffff;
}

.layout-error-text,
.layout-success-text {
  margin: 0;
  font-size: 13px;
}

.layout-error-text {
  color: var(--color-danger);
}

.layout-success-text {
  color: #13795b;
}

@media (max-width: 760px) {
  .main-layout__header {
    grid-template-columns: 1fr;
  }

  .main-layout__user {
    justify-content: space-between;
  }
}
</style>
