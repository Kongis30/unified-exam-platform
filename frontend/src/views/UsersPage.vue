<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppModal from '@/components/AppModal.vue'
import ResponsiveActionGroup from '@/components/admin/ResponsiveActionGroup.vue'
import { createUser, deleteUser, listAccountWorkspaces, listUsers, resetUserPassword, setUserStatus, updateUser, updateUserRole, updateUserWorkspaces } from '@/api/platform'
import { authState } from '@/auth'

const DEFAULT_STUDENT_PASSWORD = '9297019872'

const users = ref([])
const filters = ref({ name: '', contact: '', status: '' })
const roleTabs = [
  { code: 'STUDENT', label: 'Students' },
  { code: 'TEACHER', label: 'Teachers' },
  { code: 'ADMIN', label: 'Admins' },
]
const activeRole = ref('STUDENT')
const workspaces = ref([])
const activeWorkspace = ref('')
const selectedWorkspaces = ref([])
const workspaceEditorUser = ref(null)
const savingWorkspaces = ref(false)
const editUser = ref(null)
const editForm = ref({ username: '', realName: '', email: '', phone: '' })
const editError = ref('')
const savingUser = ref(false)
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
const roleEditorUser = ref(null)
const selectedRole = ref('STUDENT')
const savingRole = ref(false)
const deleteTargetUser = ref(null)
const deleteCountdown = ref(5)
const deletingUser = ref(false)
let deleteTimer

const filteredUsers = computed(() => {
  const nameFilter = filters.value.name.trim().toLocaleLowerCase()
  const contactFilter = filters.value.contact.trim().toLocaleLowerCase()
  return users.value
    .filter((user) => {
      const nameAndUsername = `${user.realName || ''} ${user.username || ''}`.toLocaleLowerCase()
      const contact = `${user.email || ''} ${user.phone || ''}`.toLocaleLowerCase()
      return (!nameFilter || nameAndUsername.includes(nameFilter))
        && user.roleCode === activeRole.value
        && (user.roleCode === 'ADMIN' || user.workspaceCodes?.includes(activeWorkspace.value))
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

async function loadWorkspaces() {
  try {
    workspaces.value = (await listAccountWorkspaces()).filter((workspace) => workspace.active)
    if (!workspaces.value.some((workspace) => workspace.code === activeWorkspace.value)) {
      activeWorkspace.value = workspaces.value[0]?.code || ''
    }
  } catch (requestError) { error.value = requestError.message || 'Unable to load exam systems.' }
}

function clearFilters() {
  filters.value = { name: '', contact: '', status: '' }
}

function formatRole(roleCode) {
  return ({ ADMIN: 'Administrator', TEACHER: 'Teacher', STUDENT: 'Student' })[roleCode] || roleCode || '—'
}

function userWorkspaces(user) {
  const codes = user.roleCode === 'ADMIN' ? workspaces.value.map((item) => item.code) : (user.workspaceCodes || [])
  return workspaces.value.filter((workspace) => codes.includes(workspace.code))
}

function accountActions(user) {
  return [
    { key: 'edit', label: 'Edit', onSelect: () => openUserEditor(user) },
    ...(user.roleCode === 'ADMIN' ? [] : [{ key: 'workspaces', label: 'Manage workspaces', onSelect: () => openWorkspaceEditor(user) }]),
    { key: 'password', label: 'Reset password', onSelect: () => changePassword(user) },
    { key: 'status', label: user.status === 'ACTIVE' ? 'Disable' : 'Enable', onSelect: () => toggleStatus(user) },
    { key: 'delete', label: 'Delete permanently', danger: true, onSelect: () => openDeleteDialog(user) },
  ]
}

function openUserEditor(user) {
  editUser.value = user
  editForm.value = { username: user.username, realName: user.realName || '', email: user.email || '', phone: user.phone || '' }
  editError.value = ''
}

// 保存基本资料；当前账号更改用户名后由服务端注销旧会话。
async function saveUser() {
  if (!editUser.value || savingUser.value) return
  const details = Object.fromEntries(Object.entries(editForm.value).map(([key, value]) => [key, value.trim()]))
  if (!details.username || !details.realName) {
    editError.value = 'Name and username are required.'
    return
  }
  savingUser.value = true
  editError.value = ''
  try {
    const renamedSelf = editUser.value.username === authState.user?.username && details.username !== editUser.value.username
    await updateUser(editUser.value.id, { ...details, email: details.email || null, phone: details.phone || null })
    if (renamedSelf) {
      window.location.assign('/login')
      return
    }
    editUser.value = null
    notice.value = 'Account details updated.'
    await loadUsers()
  } catch (requestError) {
    editError.value = requestError.message || 'Unable to update account details.'
  } finally { savingUser.value = false }
}

function openCreateDialog() {
  realName.value = ''
  usernameCustomized.value = false
  username.value = ''
  password.value = DEFAULT_STUDENT_PASSWORD
  roleCode.value = activeRole.value
  selectedWorkspaces.value = activeWorkspace.value ? [activeWorkspace.value] : []
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
  if (roleCode.value !== 'ADMIN' && !selectedWorkspaces.value.length) {
    error.value = 'Select at least one exam system.'
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
      workspaceCodes: selectedWorkspaces.value,
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

function openWorkspaceEditor(user) {
  workspaceEditorUser.value = user
  selectedWorkspaces.value = [...(user.workspaceCodes || [])]
  error.value = ''
}

function closeWorkspaceEditor() {
  if (savingWorkspaces.value) return
  workspaceEditorUser.value = null
  error.value = ''
}

async function saveWorkspaces() {
  if (!workspaceEditorUser.value || savingWorkspaces.value) return
  if (!selectedWorkspaces.value.length) {
    error.value = 'Select at least one exam system.'
    return
  }
  savingWorkspaces.value = true
  error.value = ''
  try {
    await updateUserWorkspaces(workspaceEditorUser.value.id, selectedWorkspaces.value)
    notice.value = 'Workspace access updated.'
    workspaceEditorUser.value = null
    await loadUsers()
  } catch (requestError) { error.value = requestError.message || 'Unable to update workspace access.' }
  finally { savingWorkspaces.value = false }
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

function openRoleEditor(user) {
  roleEditorUser.value = user
  selectedRole.value = user.roleCode
  error.value = ''
}

async function saveRole() {
  if (!roleEditorUser.value || selectedRole.value === roleEditorUser.value.roleCode) {
    roleEditorUser.value = null
    return
  }
  savingRole.value = true
  error.value = ''
  notice.value = ''
  try {
    await updateUserRole(roleEditorUser.value.id, selectedRole.value)
    notice.value = `${roleEditorUser.value.realName || roleEditorUser.value.username} is now a ${formatRole(selectedRole.value)}.`
    roleEditorUser.value = null
    await loadUsers()
  } catch (requestError) {
    error.value = requestError.message
  } finally {
    savingRole.value = false
  }
}

function openDeleteDialog(user) {
  error.value = ''
  deleteTargetUser.value = user
  deleteCountdown.value = 5
  window.clearInterval(deleteTimer)
  deleteTimer = window.setInterval(() => {
    if (deleteCountdown.value <= 1) {
      deleteCountdown.value = 0
      window.clearInterval(deleteTimer)
      deleteTimer = undefined
    } else {
      deleteCountdown.value -= 1
    }
  }, 1000)
}

function closeDeleteDialog(force = false) {
  if (deletingUser.value && !force) return
  window.clearInterval(deleteTimer)
  deleteTimer = undefined
  deleteTargetUser.value = null
}

async function confirmDeleteUser() {
  if (!deleteTargetUser.value || deleteCountdown.value > 0) return
  deletingUser.value = true
  error.value = ''
  notice.value = ''
  try {
    const removedName = deleteTargetUser.value.realName || deleteTargetUser.value.username
    await deleteUser(deleteTargetUser.value.id)
    closeDeleteDialog(true)
    notice.value = `${removedName} and their linked exam records were deleted.`
    await loadUsers()
  } catch (requestError) {
    error.value = requestError.message
  } finally {
    deletingUser.value = false
  }
}

onBeforeUnmount(() => window.clearInterval(deleteTimer))

onMounted(() => { loadUsers(); loadWorkspaces() })
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

    <p v-if="error && !showCreateDialog && !roleEditorUser && !deleteTargetUser && !workspaceEditorUser" class="error-text page-message" role="alert">{{ error }}</p>
    <p v-else-if="notice" class="success-text page-message" role="status">{{ notice }}</p>

    <div class="account-role-tabs account-workspace-tabs" role="tablist" aria-label="Exam systems">
      <button v-for="workspace in workspaces" :key="workspace.code" type="button" role="tab"
        :aria-selected="activeWorkspace === workspace.code" :class="{ 'is-active': activeWorkspace === workspace.code }"
        @click="activeWorkspace = workspace.code">{{ workspace.name }}</button>
    </div>
    <div class="account-role-tabs" role="tablist" aria-label="Account roles">
      <button v-for="tab in roleTabs" :key="tab.code" type="button" role="tab"
        :aria-selected="activeRole === tab.code" :class="{ 'is-active': activeRole === tab.code }"
        @click="activeRole = tab.code">{{ tab.label }}</button>
    </div>

    <AppCard title="Platform accounts" subtitle="Accounts are shared across the exam systems assigned to each user.">
      <div class="accounts-toolbar">
        <label class="accounts-search">
          <span>Name / username</span>
          <input v-model="filters.name" type="search" aria-label="Search by name or username" placeholder="Search accounts" />
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
          <span>{{ filteredUsers.length }} {{ filteredUsers.length === 1 ? 'account' : 'accounts' }}</span>
          <button v-if="filters.name || filters.contact || filters.status" type="button" @click="clearFilters">Clear filters</button>
        </div>
      </div>
      <p class="accounts-mobile-scroll-hint">Swipe horizontally to view all columns.</p>
      <div class="table-scroll" role="region" aria-label="Account list" tabindex="0">
        <table class="admin-table accounts-table">
          <colgroup>
            <col class="accounts-column-name" />
            <col class="accounts-column-role" />
            <col class="accounts-column-contact" />
            <col class="accounts-column-status" />
            <col class="accounts-column-workspaces" />
            <col class="accounts-column-actions" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Name / username</th>
              <th scope="col">Role</th>
              <th scope="col">Contact</th>
              <th scope="col">Status</th>
              <th scope="col">Exam systems</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in filteredUsers" :key="user.id">
              <td class="accounts-cell-name">
                <strong>{{ user.realName || user.username || 'Unnamed account' }}</strong>
                <small v-if="user.username && user.username.toLocaleLowerCase() !== (user.realName || '').trim().toLocaleLowerCase()">{{ user.username }}</small>
              </td>
              <td class="accounts-cell-role">
                <button class="role-edit" type="button" :aria-label="`Change ${user.username} role`" @click="openRoleEditor(user)">
                  <span class="role-pill">{{ formatRole(user.roleCode) }}</span><span class="role-edit__icon" aria-hidden="true">⌄</span>
                </button>
              </td>
              <td class="accounts-cell-contact">
                <span>{{ user.email || user.phone || '—' }}</span>
                <small v-if="user.email && user.phone">{{ user.phone }}</small>
              </td>
              <td class="accounts-cell-status"><span class="status-pill" :class="user.status === 'ACTIVE' ? 'is-active' : 'is-disabled'">{{ user.status === 'ACTIVE' ? 'Active' : 'Disabled' }}</span></td>
              <td class="accounts-cell-workspaces">
                <div class="account-workspace-tags">
                  <span v-for="workspace in userWorkspaces(user)" :key="workspace.code" class="account-workspace-tag">{{ workspace.name }}</span>
                  <span v-if="!userWorkspaces(user).length" class="account-workspace-empty">—</span>
                </div>
              </td>
              <td class="accounts-cell-actions">
                <ResponsiveActionGroup :actions="accountActions(user)" label="Account actions" align="center" />
              </td>
            </tr>
            <tr v-if="!filteredUsers.length">
              <td colspan="6" class="table-empty">
                <template v-if="!filters.name && !filters.contact && !filters.status">No accounts in this role yet.</template>
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
      description="Enter a name. The username and default password are prefilled and editable. Choose the exam systems this account can access."
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
        <fieldset v-if="roleCode !== 'ADMIN'" class="account-workspace-options">
          <legend>Exam systems</legend>
          <label v-for="workspace in workspaces" :key="workspace.code">
            <input v-model="selectedWorkspaces" type="checkbox" :value="workspace.code" /> {{ workspace.name }}
          </label>
          <small>Select the exam systems this account can access.</small>
        </fieldset>
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

    <AppModal v-if="editUser" title="Edit account" description="Update the account's basic information." :busy="savingUser" @close="editUser = null">
      <form id="edit-account-form" class="account-create-form" @submit.prevent="saveUser">
        <label class="form-label">Full name<input v-model="editForm.realName" class="form-input" maxlength="80" required /></label>
        <label class="form-label">Username<input v-model="editForm.username" class="form-input" maxlength="80" required /></label>
        <label class="form-label">Email<input v-model="editForm.email" class="form-input" type="email" maxlength="160" /></label>
        <label class="form-label">Phone<input v-model="editForm.phone" class="form-input" type="tel" maxlength="30" /></label>
        <p v-if="editUser.username === authState.user?.username" class="form-hint">Changing your username will require you to sign in again.</p>
        <p v-if="editError" class="error-text" role="alert">{{ editError }}</p>
      </form>
      <template #footer>
        <AppButton variant="secondary" :disabled="savingUser" @click="editUser = null">Cancel</AppButton>
        <AppButton type="submit" form="edit-account-form" :disabled="savingUser">{{ savingUser ? 'Saving…' : 'Save changes' }}</AppButton>
      </template>
    </AppModal>

    <AppModal v-if="workspaceEditorUser" title="Manage workspaces" panel-class="workspace-access-modal"
      :description="`Choose the exam systems available to ${workspaceEditorUser.realName || workspaceEditorUser.username}.`"
      :busy="savingWorkspaces" @close="closeWorkspaceEditor">
      <form id="account-workspaces-form" @submit.prevent="saveWorkspaces">
        <fieldset class="account-workspace-options">
          <legend>Exam systems</legend>
          <label v-for="workspace in workspaces" :key="workspace.code">
            <input v-model="selectedWorkspaces" type="checkbox" :value="workspace.code" /> {{ workspace.name }}
          </label>
        </fieldset>
        <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      </form>
      <template #footer>
        <AppButton type="button" variant="secondary" :disabled="savingWorkspaces" @click="closeWorkspaceEditor">Cancel</AppButton>
        <AppButton type="submit" form="account-workspaces-form" :disabled="savingWorkspaces">{{ savingWorkspaces ? 'Saving…' : 'Save' }}</AppButton>
      </template>
    </AppModal>

    <AppModal
      v-if="roleEditorUser"
      title="Change account role"
      :description="`Changing ${roleEditorUser.realName || roleEditorUser.username}’s role affects access across every exam module.`"
      :busy="savingRole"
      @close="roleEditorUser = null"
    >
      <form id="change-account-role-form" class="role-editor-form" @submit.prevent="saveRole">
        <p class="role-editor-account">{{ roleEditorUser.realName || roleEditorUser.username }} <span>{{ roleEditorUser.username }}</span></p>
        <label class="form-field">
          <span class="form-label">Role</span>
          <select v-model="selectedRole" class="form-input">
            <option value="STUDENT">Student</option>
            <option value="TEACHER">Teacher</option>
            <option value="ADMIN">Administrator</option>
          </select>
        </label>
        <p class="role-editor-note">Administrators can manage accounts and all exam modules. Teachers and students have different access.</p>
        <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      </form>
      <template #footer>
        <AppButton type="button" variant="secondary" :disabled="savingRole" @click="roleEditorUser = null">Cancel</AppButton>
        <AppButton type="submit" form="change-account-role-form" :disabled="savingRole">{{ savingRole ? 'Saving…' : 'Save role' }}</AppButton>
      </template>
    </AppModal>

    <AppModal
      v-if="deleteTargetUser"
      title="Permanently delete account?"
      :description="`This removes ${deleteTargetUser.realName || deleteTargetUser.username} and their linked exam attempts, answers, scores, and class memberships from every exam module. Shared papers and exams will remain.`"
      :busy="deletingUser"
      @close="closeDeleteDialog"
    >
      <p class="delete-account-confirmation">This action cannot be undone. The delete button will be available in {{ deleteCountdown }} seconds.</p>
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <template #footer>
        <AppButton type="button" variant="secondary" :disabled="deletingUser" @click="closeDeleteDialog">Cancel</AppButton>
        <AppButton type="button" variant="danger" :disabled="deletingUser || deleteCountdown > 0" @click="confirmDeleteUser">
          {{ deletingUser ? 'Deleting…' : deleteCountdown > 0 ? `Delete (${deleteCountdown}s)` : 'Delete permanently' }}
        </AppButton>
      </template>
    </AppModal>
  </main>
</template>

<style scoped>
.account-role-tabs { display: flex; gap: 28px; border-bottom: 1px solid #e1e7ef; margin-bottom: 18px; overflow-x: auto; }
.account-role-tabs button { flex: none; position: relative; border: 0; padding: 13px 2px; color: #65748b; background: transparent; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.account-role-tabs button.is-active { color: var(--color-primary-strong); }
.account-role-tabs button.is-active::after { position: absolute; right: 0; bottom: -1px; left: 0; height: 2px; background: var(--color-primary); content: ''; }
.account-role-tabs button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; }
.account-workspace-tabs { margin-bottom: 4px; }
.account-workspace-options { display: flex; flex-wrap: wrap; gap: 12px 20px; margin: 0; padding: 12px; border: 1px solid #dce6f4; border-radius: 8px; }
.account-workspace-options legend { padding: 0 4px; color: #243653; font-size: 13px; font-weight: 650; }
.account-workspace-options label { display: inline-flex; align-items: center; gap: 6px; color: #243653; font-size: 14px; }
.account-workspace-options small { flex-basis: 100%; color: #65748b; }
#account-workspaces-form .account-workspace-options { gap: 14px 24px; padding: 16px; }
#account-workspaces-form .account-workspace-options legend { font-size: 14px; }
#account-workspaces-form .account-workspace-options label { min-height: 28px; gap: 9px; font-size: 16px; cursor: pointer; }
#account-workspaces-form .account-workspace-options input { width: 18px; height: 18px; margin: 0; accent-color: var(--color-primary); cursor: pointer; }
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
.accounts-table { width: 100%; min-width: 980px; table-layout: fixed; }
.accounts-mobile-scroll-hint { display: none; }
.accounts-column-name { width: 23%; }
.accounts-column-role { width: 12%; }
.accounts-column-contact { width: 18%; }
.accounts-column-status { width: 11%; }
.accounts-column-workspaces { width: 23%; }
.accounts-column-actions { width: 13%; }
.account-workspace-tags { display: flex; flex-wrap: wrap; justify-content: center; gap: 5px; }
.account-workspace-tag { border: 1px solid #d8e5fa; border-radius: 999px; padding: 4px 8px; color: #315a9a; background: #f2f7ff; font-size: 12px; font-weight: 650; line-height: 1.25; }
.account-workspace-empty { color: #8291a8; }
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
.role-edit { display: inline-flex; align-items: center; gap: 5px; border: 0; border-radius: 999px; padding: 2px; color: inherit; background: transparent; cursor: pointer; }
.role-edit:hover { background: #eef4fd; }
.role-edit:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.role-edit__icon { color: #8291a8; font-size: 12px; }
.role-editor-form { display: grid; gap: 16px; }
.role-editor-account { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0; color: #23334d; font-weight: 650; }
.role-editor-account span { color: #71819a; font-size: 13px; font-weight: 450; }
.role-editor-note { margin: -6px 0 0; color: #66758d; font-size: 13px; line-height: 1.5; }
.accounts-table .status-pill.is-active { border-color: #c5ead9; color: #13764f; background: #edf9f3; }
.accounts-table .status-pill.is-disabled { border-color: #f1d0d0; color: #a84b4b; background: #fff4f3; }
.delete-account-confirmation { margin: 0; color: #5b6b82; font-size: 14px; line-height: 1.55; }
.clear-account-filters { margin-left: 5px; border: 0; padding: 0; color: var(--color-primary-strong); background: transparent; font: inherit; font-weight: 700; cursor: pointer; }
@media (max-width: 720px) {
  .accounts-toolbar { align-items: stretch; }
  .accounts-search,
  .accounts-select-filter,
  .accounts-contact-filter { width: 100%; }
  .accounts-toolbar__meta { justify-content: space-between; }
  .accounts-mobile-scroll-hint { display: block; margin: -2px 0 8px; color: #66758d; font-size: 12px; }
  .accounts-table { min-width: 980px; }
}
</style>

<style>
.workspace-access-modal .app-modal__heading h2 { font-size: 19px; }
</style>
