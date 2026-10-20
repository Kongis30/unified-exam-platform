<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppModal from '@/components/AppModal.vue'
import { createUser, listUsers, resetUserPassword, setUserStatus } from '@/api/platform'

const DEFAULT_STUDENT_PASSWORD = '9297019872'

const users = ref([])
const filters = ref({ name: '', role: '', contact: '', status: '' })
const error = ref('')
const notice = ref('')
const showCreateDialog = ref(false)
const creating = ref(false)
const realName = ref('')
const username = ref('')
const password = ref(DEFAULT_STUDENT_PASSWORD)
const roleCode = ref('STUDENT')
const email = ref('')
const phone = ref('')
const usernameCustomized = ref(false)
const fieldErrors = ref({ realName: '', username: '', password: '', email: '' })

const filteredUsers = computed(() => {
  const nameFilter = filters.value.name.trim().toLocaleLowerCase()
  const contactFilter = filters.value.contact.trim().toLocaleLowerCase()
  return users.value
    .filter((user) => {
      const nameAndUsername = `${user.realName || ''} ${user.username || ''}`.toLocaleLowerCase()
      const contact = `${user.email || ''} ${user.phone || ''}`.toLocaleLowerCase()
      return (!nameFilter || nameAndUsername.includes(nameFilter))
        && (!filters.value.role || user.roleCode === filters.value.role)
        && (!contactFilter || contact.includes(contactFilter))
        && (!filters.value.status || user.status === filters.value.status)
    })
    .sort((left, right) => (left.realName || left.username || '').localeCompare(
      right.realName || right.username || '',
      undefined,
      { sensitivity: 'base' },
    ) || (left.username || '').localeCompare(right.username || '', undefined, { sensitivity: 'base' }))
})

const generatedUsername = computed(() => {
  const parts = realName.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const firstName = parts[0]?.replace(/[^a-z0-9]/g, '')
  if (!firstName) return ''

  const surnameInitial = parts.length > 1 ? parts.at(-1).replace(/[^a-z0-9]/g, '').charAt(0) : ''
  const base = `${firstName.slice(0, 75 - surnameInitial.length)}${surnameInitial}@jin`
  const existingUsernames = new Set(users.value.map((user) => user.username.toLowerCase()))
  if (!existingUsernames.has(base)) return base

  let suffix = 2
  while (existingUsernames.has(`${base.slice(0, -4)}${suffix}@jin`)) suffix += 1
  return `${base.slice(0, -4)}${suffix}@jin`
})

watch(generatedUsername, (value) => {
  if (!usernameCustomized.value) username.value = value
})

async function loadUsers() {
  try { users.value = await listUsers() } catch (requestError) { error.value = requestError.message }
}

function clearFilters() {
  filters.value = { name: '', role: '', contact: '', status: '' }
}

function formatRole(roleCode) {
  return ({ ADMIN: 'Administrator', TEACHER: 'Teacher', STUDENT: 'Student' })[roleCode] || roleCode || '—'
}

function openCreateDialog() {
  realName.value = ''
  usernameCustomized.value = false
  username.value = ''
  password.value = DEFAULT_STUDENT_PASSWORD
  roleCode.value = 'STUDENT'
  email.value = ''
  phone.value = ''
  error.value = ''
  notice.value = ''
  fieldErrors.value = { realName: '', username: '', password: '', email: '' }
  showCreateDialog.value = true
}

function closeCreateDialog() {
  if (creating.value) return
  showCreateDialog.value = false
}

async function createAccount() {
  fieldErrors.value = { realName: '', username: '', password: '', email: '' }
  const fullName = realName.value.trim()
  const accountUsername = username.value.trim()
  const accountPassword = password.value
  if (!fullName) {
    fieldErrors.value.realName = 'Enter the account holder’s full name.'
  }
  if (!accountUsername) {
    fieldErrors.value.username = 'Enter a username for this account.'
  }
  if (!accountPassword.trim() || accountPassword.length < 6 || accountPassword.length > 100) {
    fieldErrors.value.password = 'Password must be between 6 and 100 characters.'
  }
  if (email.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
    fieldErrors.value.email = 'Enter a valid email address.'
  }
  if (Object.values(fieldErrors.value).some(Boolean)) {
    error.value = ''
    return
  }

  error.value = ''; notice.value = ''; creating.value = true
  try {
    await createUser({
      username: accountUsername,
      password: accountPassword,
      realName: fullName,
      roleCode: roleCode.value,
      email: email.value.trim() || null,
      phone: phone.value.trim() || null,
    })
    showCreateDialog.value = false
    realName.value = ''
    notice.value = `Account created: ${accountUsername}. Password: ${accountPassword}.`
    await loadUsers()
  } catch (requestError) {
    if (requestError.status === 409) {
      fieldErrors.value.username = requestError.message || 'That username is already in use.'
    } else if (requestError.field && requestError.field in fieldErrors.value) {
      fieldErrors.value[requestError.field] = requestError.message
    } else {
      error.value = requestError.message
    }
  } finally {
    creating.value = false
  }
}

async function toggleStatus(user) {
  error.value = ''
  try { await setUserStatus(user.id, user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'); await loadUsers() }
  catch (requestError) { error.value = requestError.message }
}

async function changePassword(user) {
  const password = window.prompt(`Set a new password for ${user.username} (at least 6 characters).`)
  if (!password) return
  error.value = ''
  try { await resetUserPassword(user.id, password); notice.value = `Password reset for ${user.username}.` }
  catch (requestError) { error.value = requestError.message }
}

onMounted(loadUsers)
</script>

<template>
  <main class="page-shell management-page">
    <header class="management-heading">
      <div>
        <span class="eyebrow">PLATFORM IDENTITY</span>
        <h1>Account management</h1>
        <p>Administrators, teachers, and students share one account directory. Usernames are unique across the platform.</p>
      </div>
      <div class="management-heading__actions">
        <span class="section-counter">{{ users.length }} ACCOUNTS</span>
        <AppButton type="button" @click="openCreateDialog">Create account <span aria-hidden="true">＋</span></AppButton>
      </div>
    </header>

    <p v-if="error && !showCreateDialog" class="error-text page-message" role="alert">{{ error }}</p>
    <p v-else-if="notice" class="success-text page-message" role="status">{{ notice }}</p>

    <AppCard title="Platform accounts" subtitle="All roles use one account directory across SAT, PSAT, and SHSAT.">
      <div class="accounts-toolbar">
        <label class="accounts-search">
          <span>Name / username</span>
          <input v-model="filters.name" type="search" aria-label="Search by name or username" placeholder="Search accounts" />
        </label>
        <label class="accounts-select-filter">
          <span>Role</span>
          <select v-model="filters.role" aria-label="Filter accounts by role">
            <option value="">All roles</option>
            <option value="STUDENT">Student</option>
            <option value="TEACHER">Teacher</option>
            <option value="ADMIN">Administrator</option>
          </select>
        </label>
        <label class="accounts-contact-filter">
          <span>Contact</span>
          <input v-model="filters.contact" type="search" aria-label="Search by email or phone" placeholder="Email or phone" />
        </label>
        <label class="accounts-select-filter">
          <span>Status</span>
          <select v-model="filters.status" aria-label="Filter accounts by status">
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="DISABLED">Disabled</option>
          </select>
        </label>
        <div class="accounts-toolbar__meta">
          <span>{{ filteredUsers.length }} of {{ users.length }} accounts</span>
          <button v-if="filters.name || filters.role || filters.contact || filters.status" type="button" @click="clearFilters">Clear filters</button>
        </div>
      </div>
      <div class="table-scroll">
        <table class="admin-table accounts-table">
          <colgroup>
            <col class="accounts-column-name" />
            <col class="accounts-column-role" />
            <col class="accounts-column-contact" />
            <col class="accounts-column-status" />
            <col class="accounts-column-actions" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Name / username</th>
              <th scope="col">Role</th>
              <th scope="col">Contact</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in filteredUsers" :key="user.id">
              <td class="accounts-cell-name">
                <strong>{{ user.realName || user.username || 'Unnamed account' }}</strong>
                <small v-if="user.username && user.username.toLocaleLowerCase() !== (user.realName || '').trim().toLocaleLowerCase()">{{ user.username }}</small>
              </td>
              <td class="accounts-cell-role"><span class="role-pill">{{ formatRole(user.roleCode) }}</span></td>
              <td class="accounts-cell-contact">
                <span>{{ user.email || user.phone || '—' }}</span>
                <small v-if="user.email && user.phone">{{ user.phone }}</small>
              </td>
              <td class="accounts-cell-status"><span class="status-pill" :class="user.status === 'ACTIVE' ? 'is-active' : 'is-disabled'">{{ user.status === 'ACTIVE' ? 'Active' : 'Disabled' }}</span></td>
              <td class="accounts-cell-actions">
                <div class="table-actions">
                  <button class="account-action account-action--password" type="button" @click="changePassword(user)">Reset password</button>
                  <button
                    class="account-action"
                    :class="user.status === 'ACTIVE' ? 'account-action--disable' : 'account-action--enable'"
                    type="button"
                    @click="toggleStatus(user)"
                  >{{ user.status === 'ACTIVE' ? 'Disable' : 'Enable' }}</button>
                </div>
              </td>
            </tr>
            <tr v-if="!filteredUsers.length">
              <td colspan="5" class="table-empty">
                <template v-if="!users.length">No accounts yet.</template>
                <template v-else>No accounts match these filters. <button type="button" class="clear-account-filters" @click="clearFilters">Clear filters</button></template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </AppCard>

    <AppModal
      v-if="showCreateDialog"
      title="Create an account"
      description="Enter a name. The username and default password are prefilled and editable. Role, email, and phone are optional; the default role is Student."
      :busy="creating"
      @close="closeCreateDialog"
    >
      <form id="create-account-form" class="account-create-form" novalidate @submit.prevent="createAccount">
        <label class="form-field">
          <span class="form-label">Full name</span>
          <input v-model.trim="realName" class="form-input" maxlength="80" autocomplete="name" autofocus required :aria-invalid="Boolean(fieldErrors.realName)" aria-describedby="create-account-name-error" @input="fieldErrors.realName = ''" />
          <small v-if="fieldErrors.realName" id="create-account-name-error" class="field-error" role="alert">{{ fieldErrors.realName }}</small>
        </label>
        <label class="form-field">
          <span class="form-label">Username</span>
          <input v-model.trim="username" class="form-input" maxlength="80" autocomplete="username" required :aria-invalid="Boolean(fieldErrors.username)" aria-describedby="create-account-username-error" @input="usernameCustomized = true; fieldErrors.username = ''" />
          <small v-if="fieldErrors.username" id="create-account-username-error" class="field-error" role="alert">{{ fieldErrors.username }}</small>
        </label>
        <label class="form-field">
          <span class="form-label">Password</span>
          <input v-model="password" class="form-input" type="text" maxlength="100" autocomplete="new-password" required :aria-invalid="Boolean(fieldErrors.password)" aria-describedby="create-account-password-hint create-account-password-error" @input="fieldErrors.password = ''" />
          <small id="create-account-password-hint" class="form-hint">Minimum 6 characters.</small>
          <small v-if="fieldErrors.password" id="create-account-password-error" class="field-error" role="alert">{{ fieldErrors.password }}</small>
        </label>
        <details class="account-optional-details">
          <summary>Additional details <span>Optional</span></summary>
          <div class="account-optional-fields">
            <label class="form-field">
              <span class="form-label">Role</span>
              <select v-model="roleCode" class="form-input">
                <option value="STUDENT">Student</option>
                <option value="TEACHER">Teacher</option>
                <option value="ADMIN">Administrator</option>
              </select>
            </label>
            <label class="form-field">
              <span class="form-label">Email</span>
              <input v-model.trim="email" class="form-input" type="email" autocomplete="email" :aria-invalid="Boolean(fieldErrors.email)" aria-describedby="create-account-email-error" @input="fieldErrors.email = ''" />
              <small v-if="fieldErrors.email" id="create-account-email-error" class="field-error" role="alert">{{ fieldErrors.email }}</small>
            </label>
            <label class="form-field">
              <span class="form-label">Phone</span>
              <input v-model.trim="phone" class="form-input" maxlength="30" autocomplete="tel" />
            </label>
          </div>
        </details>
        <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      </form>
      <template #footer>
        <AppButton type="button" variant="secondary" :disabled="creating" @click="closeCreateDialog">Cancel</AppButton>
        <AppButton type="submit" form="create-account-form" :disabled="creating">{{ creating ? 'Creating…' : 'Create account' }}</AppButton>
      </template>
    </AppModal>
  </main>
</template>

<style scoped>
.accounts-toolbar { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; margin: 0 0 14px; padding: 10px 12px; border: 1px solid #e8edf5; border-radius: 8px; background: #fbfcfe; }
.accounts-search { display: grid; width: min(300px, 100%); gap: 6px; color: #65748b; font-size: 12px; font-weight: 600; }
.accounts-select-filter,
.accounts-contact-filter { display: grid; width: 145px; gap: 6px; color: #65748b; font-size: 12px; font-weight: 600; }
.accounts-contact-filter { width: 170px; }
.accounts-search input,
.accounts-select-filter select,
.accounts-contact-filter input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: 36px;
  border: 1px solid #d9e2ec;
  border-radius: 7px;
  padding: 0 9px;
  color: #243653;
  background: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 400;
  letter-spacing: normal;
}
.accounts-select-filter select { appearance: none; padding-right: 32px; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2366758d' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 10px center; background-size: 14px; }
.accounts-search input:focus,
.accounts-select-filter select:focus,
.accounts-contact-filter input:focus { border-color: var(--color-primary); outline: 3px solid rgba(47, 111, 237, .12); }
.accounts-toolbar__meta { display: flex; align-items: center; gap: 12px; margin-left: auto; color: #66758d; font-size: 13px; white-space: nowrap; }
.accounts-toolbar__meta button { border: 0; padding: 4px; color: var(--color-primary-strong); background: transparent; font: inherit; font-weight: 650; cursor: pointer; }
.accounts-table { width: 100%; min-width: 820px; table-layout: fixed; }
.accounts-column-name { width: 25%; }
.accounts-column-role { width: 14%; }
.accounts-column-contact { width: 24%; }
.accounts-column-status { width: 14%; }
.accounts-column-actions { width: 23%; }
.accounts-table th,
.accounts-table td { vertical-align: middle; }
.accounts-table th:first-child,
.accounts-table td.accounts-cell-name { text-align: left; }
.accounts-table th:not(:first-child),
.accounts-table td:not(.accounts-cell-name) { text-align: center; }
.accounts-table th:nth-child(3),
.accounts-table td.accounts-cell-contact { text-align: left; }
.accounts-table th { min-width: 0; border-bottom: 1px solid #d7e2f0; padding: 13px 16px; color: #4f607a; background: #f1f5fb; font-size: 13px; letter-spacing: .045em; }
.accounts-table th + th { border-left: 1px solid #e2e9f3; }
.accounts-table th:first-child { border-top-left-radius: 6px; }
.accounts-table th:last-child { border-top-right-radius: 6px; }
.accounts-table td { padding: 15px 16px; color: #53627a; font-size: 14px; line-height: 1.45; }
.accounts-table tbody td { border-bottom-color: #e7edf6; }
.accounts-table tbody tr:nth-child(even) { background: #fcfdff; }
.accounts-table tbody tr:hover { background: #f5f9ff; }
.accounts-table .accounts-cell-name strong { color: #1f2d43; font-size: 15px; font-weight: 650; }
.accounts-table .accounts-cell-name small,
.accounts-table .accounts-cell-contact small { margin-top: 4px; color: #71819a; font-size: 13px; }
.accounts-cell-contact { overflow-wrap: anywhere; }
.accounts-table .role-pill,
.accounts-table .status-pill { align-items: center; border: 1px solid transparent; border-radius: 999px; padding: 5px 10px; font-size: 12px; font-weight: 650; letter-spacing: 0; line-height: 1.2; }
.accounts-table .role-pill { border-color: #dce6f4; color: #536b8a; background: #f3f7fc; }
.accounts-table .status-pill.is-active { border-color: #c5ead9; color: #13764f; background: #edf9f3; }
.accounts-table .status-pill.is-disabled { border-color: #f1d0d0; color: #a84b4b; background: #fff4f3; }
.accounts-cell-actions .table-actions { justify-content: center; gap: 8px; }
.account-action { min-height: 34px; border: 1px solid #d8e3f0; border-radius: 7px; padding: 0 10px; color: #53627a; background: #fff; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease; }
.account-action:hover { border-color: #b8cbe3; background: #f7faff; }
.account-action--password { color: #2459b8; border-color: #cfddf4; }
.account-action--password:hover { border-color: #a9c2eb; background: #eff5ff; }
.account-action--disable { color: #68778d; border-color: #dfe5ee; }
.account-action--disable:hover { color: #a94343; border-color: #e9b5b5; background: #fff4f3; }
.account-action--enable { color: #13764f; border-color: #c5ead9; }
.account-action--enable:hover { border-color: #9ed8bc; background: #edf9f3; }
.clear-account-filters { margin-left: 5px; border: 0; padding: 0; color: var(--color-primary-strong); background: transparent; font: inherit; font-weight: 700; cursor: pointer; }
@media (max-width: 720px) {
  .accounts-toolbar { align-items: stretch; }
  .accounts-search,
  .accounts-select-filter,
  .accounts-contact-filter { width: 100%; }
  .accounts-toolbar__meta { justify-content: space-between; }
  .accounts-table { min-width: 820px; }
}
</style>
