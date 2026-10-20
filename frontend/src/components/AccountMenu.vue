<script setup>
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'

import AppButton from '@/components/AppButton.vue'
import AppModal from '@/components/AppModal.vue'
import { changeOwnPassword, updateOwnProfile } from '@/api/platform'
import { authState } from '@/auth'

const emit = defineEmits(['sign-out'])
const menu = ref(null)
const menuOpen = ref(false)
const profileOpen = ref(false)
const passwordOpen = ref(false)
const isSaving = ref(false)
const error = ref('')
const notice = ref('')
const fieldErrors = reactive({ realName: '', email: '', currentPassword: '', newPassword: '', confirmPassword: '' })
const profile = reactive({ realName: '', email: '', phone: '' })
const passwordForm = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' })

function closeMenuOnOutsideClick(event) {
  if (menu.value && !menu.value.contains(event.target)) menuOpen.value = false
}

function clearErrors() {
  error.value = ''
  for (const key of Object.keys(fieldErrors)) fieldErrors[key] = ''
}

function openProfile() {
  const user = authState.user
  profile.realName = user?.realName || ''
  profile.email = user?.email || ''
  profile.phone = user?.phone || ''
  clearErrors()
  notice.value = ''
  menuOpen.value = false
  profileOpen.value = true
}

function openPasswordChange() {
  Object.assign(passwordForm, { currentPassword: '', newPassword: '', confirmPassword: '' })
  clearErrors()
  notice.value = ''
  menuOpen.value = false
  passwordOpen.value = true
}

async function saveProfile() {
  clearErrors()
  const realName = profile.realName.trim()
  const email = profile.email.trim()
  if (!realName) fieldErrors.realName = 'Enter your full name.'
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fieldErrors.email = 'Enter a valid email address.'
  if (Object.values(fieldErrors).some(Boolean)) return

  isSaving.value = true
  try {
    authState.user = await updateOwnProfile({ realName, email: email || null, phone: profile.phone.trim() || null })
    profileOpen.value = false
    notice.value = 'Account information updated.'
  } catch (requestError) {
    error.value = requestError.message || 'Unable to update your account information.'
  } finally {
    isSaving.value = false
  }
}

async function savePassword() {
  clearErrors()
  const { currentPassword, newPassword, confirmPassword } = passwordForm
  if (!currentPassword) fieldErrors.currentPassword = 'Enter your current password.'
  if (!newPassword.trim() || newPassword.length < 6 || newPassword.length > 100) {
    fieldErrors.newPassword = 'Use a password between 6 and 100 characters.'
  }
  if (confirmPassword !== newPassword) fieldErrors.confirmPassword = 'The passwords do not match.'
  if (!fieldErrors.newPassword && newPassword === currentPassword) {
    fieldErrors.newPassword = 'Choose a new password that differs from your current password.'
  }
  if (Object.values(fieldErrors).some(Boolean)) return

  isSaving.value = true
  try {
    await changeOwnPassword(currentPassword, newPassword)
    passwordOpen.value = false
    notice.value = 'Password updated.'
  } catch (requestError) {
    error.value = requestError.message || 'Unable to update your password.'
  } finally {
    isSaving.value = false
  }
}

onMounted(() => document.addEventListener('pointerdown', closeMenuOnOutsideClick))
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeMenuOnOutsideClick))
</script>

<template>
  <div ref="menu" class="account-menu" @keydown.esc.stop="menuOpen = false">
    <button
      class="account-menu__trigger"
      type="button"
      aria-haspopup="menu"
      :aria-expanded="menuOpen"
      @click="menuOpen = !menuOpen"
    >
      <strong>{{ authState.user?.username }}</strong>
    </button>
    <div v-if="menuOpen" class="account-menu__dropdown" role="menu">
      <div class="account-menu__identity">
        <strong>{{ authState.user?.realName || authState.user?.username }}</strong>
        <span>{{ authState.user?.roleCode }}</span>
      </div>
      <button type="button" role="menuitem" @click="openProfile">Edit account information</button>
      <button type="button" role="menuitem" @click="openPasswordChange">Change password</button>
      <div class="account-menu__divider"></div>
      <button type="button" role="menuitem" @click="emit('sign-out')">Sign out</button>
    </div>
    <span v-if="notice" class="account-menu__notice" role="status">{{ notice }}</span>

    <AppModal v-if="profileOpen" title="Edit account information" description="Update your name and contact details." :busy="isSaving" @close="profileOpen = false">
      <form id="account-profile-form" class="account-settings-form" novalidate @submit.prevent="saveProfile">
        <label class="form-field">
          <span class="form-label">Username</span>
          <input class="form-input" :value="authState.user?.username" readonly aria-describedby="account-username-hint" />
          <small id="account-username-hint" class="form-hint">Your username is used to sign in and cannot be changed here.</small>
        </label>
        <label class="form-field">
          <span class="form-label">Full name</span>
          <input v-model="profile.realName" class="form-input" maxlength="80" autocomplete="name" autofocus :aria-invalid="Boolean(fieldErrors.realName)" @input="fieldErrors.realName = ''" />
          <small v-if="fieldErrors.realName" class="field-error" role="alert">{{ fieldErrors.realName }}</small>
        </label>
        <label class="form-field">
          <span class="form-label">Email</span>
          <input v-model="profile.email" class="form-input" type="email" maxlength="160" autocomplete="email" :aria-invalid="Boolean(fieldErrors.email)" @input="fieldErrors.email = ''" />
          <small v-if="fieldErrors.email" class="field-error" role="alert">{{ fieldErrors.email }}</small>
        </label>
        <label class="form-field">
          <span class="form-label">Phone</span>
          <input v-model="profile.phone" class="form-input" maxlength="30" autocomplete="tel" />
        </label>
        <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      </form>
      <template #footer>
        <AppButton type="button" variant="secondary" :disabled="isSaving" @click="profileOpen = false">Cancel</AppButton>
        <AppButton type="submit" form="account-profile-form" :disabled="isSaving">{{ isSaving ? 'Saving…' : 'Save changes' }}</AppButton>
      </template>
    </AppModal>

    <AppModal v-if="passwordOpen" title="Change password" description="Enter your current password, then choose and confirm a new password." :busy="isSaving" @close="passwordOpen = false">
      <form id="account-password-form" class="account-settings-form" novalidate @submit.prevent="savePassword">
        <label class="form-field">
          <span class="form-label">Current password</span>
          <input v-model="passwordForm.currentPassword" class="form-input" type="password" autocomplete="current-password" autofocus :aria-invalid="Boolean(fieldErrors.currentPassword)" @input="fieldErrors.currentPassword = ''" />
          <small v-if="fieldErrors.currentPassword" class="field-error" role="alert">{{ fieldErrors.currentPassword }}</small>
        </label>
        <label class="form-field">
          <span class="form-label">New password</span>
          <input v-model="passwordForm.newPassword" class="form-input" type="password" minlength="6" maxlength="100" autocomplete="new-password" aria-describedby="account-new-password-hint" :aria-invalid="Boolean(fieldErrors.newPassword)" @input="fieldErrors.newPassword = ''" />
          <small id="account-new-password-hint" class="form-hint">Minimum 6 characters.</small>
          <small v-if="fieldErrors.newPassword" class="field-error" role="alert">{{ fieldErrors.newPassword }}</small>
        </label>
        <label class="form-field">
          <span class="form-label">Confirm new password</span>
          <input v-model="passwordForm.confirmPassword" class="form-input" type="password" autocomplete="new-password" :aria-invalid="Boolean(fieldErrors.confirmPassword)" @input="fieldErrors.confirmPassword = ''" />
          <small v-if="fieldErrors.confirmPassword" class="field-error" role="alert">{{ fieldErrors.confirmPassword }}</small>
        </label>
        <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      </form>
      <template #footer>
        <AppButton type="button" variant="secondary" :disabled="isSaving" @click="passwordOpen = false">Cancel</AppButton>
        <AppButton type="submit" form="account-password-form" :disabled="isSaving">{{ isSaving ? 'Updating…' : 'Update password' }}</AppButton>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.account-menu { position: relative; display: inline-flex; align-items: center; }
.account-menu__trigger { display: inline-flex; align-items: center; gap: 8px; border: 0; border-radius: 10px; padding: 8px 10px; color: var(--color-text); background: transparent; cursor: pointer; }
.account-menu__trigger:hover, .account-menu__trigger[aria-expanded="true"] { background: var(--color-primary-soft); }
.account-menu__trigger strong { font-size: 14px; font-weight: 750; }
.account-menu__dropdown { position: absolute; z-index: 30; top: calc(100% + 8px); right: 0; display: grid; width: 248px; padding: 8px; border: 1px solid var(--color-border); border-radius: 14px; background: var(--color-surface); box-shadow: 0 16px 40px rgba(23, 32, 51, .16); }
.account-menu__identity { display: grid; gap: 3px; padding: 10px 11px 12px; }
.account-menu__identity strong { overflow: hidden; color: var(--color-text); font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
.account-menu__identity span { color: var(--color-muted); font-size: 12px; }
.account-menu__dropdown button { border: 0; border-radius: 8px; padding: 10px 11px; color: var(--color-text); background: transparent; cursor: pointer; font-size: 13px; text-align: left; }
.account-menu__dropdown button:hover { color: var(--color-primary-strong); background: var(--color-primary-soft); }
.account-menu__divider { height: 1px; margin: 5px 4px; background: var(--color-border); }
.account-menu__notice { position: absolute; top: calc(100% + 6px); right: 0; z-index: 20; white-space: nowrap; border: 1px solid #c5eadc; border-radius: 8px; padding: 7px 10px; color: #12694f; background: #f0fbf6; box-shadow: 0 8px 20px rgba(23, 32, 51, .08); font-size: 12px; }
.account-settings-form { display: grid; gap: 15px; }
.account-settings-form .form-hint { color: var(--color-muted); font-size: 12px; line-height: 1.4; }
.account-settings-form .field-error { color: var(--color-danger); font-size: 12px; line-height: 1.4; }
.account-settings-form .form-input[readonly] { color: var(--color-muted); background: #f2f5fa; }
@media (max-width: 760px) { .account-menu__dropdown { right: 0; } .account-menu__notice { max-width: 250px; white-space: normal; } }
</style>
