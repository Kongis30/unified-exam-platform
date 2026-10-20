import { reactive } from 'vue'

import { getCurrentUser } from './api/platform'

export const authState = reactive({ user: null, loaded: false })

export async function refreshUser() {
  try {
    authState.user = await getCurrentUser()
  } catch {
    authState.user = null
  } finally {
    authState.loaded = true
  }
  return authState.user
}
