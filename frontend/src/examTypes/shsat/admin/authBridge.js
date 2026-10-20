import { authState } from '@/auth'

export function getUserRole() {
  return String(authState.user?.roleCode || '').toLowerCase()
}

export function isAdmin() {
  return getUserRole() === 'admin'
}

export function isStudent() {
  return getUserRole() === 'student'
}
