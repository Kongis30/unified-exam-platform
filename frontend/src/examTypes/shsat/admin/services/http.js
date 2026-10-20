import { apiRequest } from '@/api/platform'

const errorFallbacks = {
  400: 'The request could not be processed. Please check your input and try again.',
  401: 'Authentication failed or your session has expired.',
  403: 'You do not have permission to perform this action.',
  404: 'The requested resource was not found.',
  409: 'The request conflicts with existing data.',
  500: 'Internal server error. Please try again later.',
}

export function getEnglishErrorMessage(error, fallback = 'Request failed. Please try again later.') {
  const message = String(error?.message || '')
  return !message || /[\u3400-\u9fff\uf900-\ufaff]/u.test(message) ? fallback : message
}

function request(path, options = {}) {
  const { query, ...fetchOptions } = options
  const url = new URL(`/api${path.startsWith('/') ? path : `/${path}`}`, window.location.origin)
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value)
  })
  return apiRequest(`${url.pathname}${url.search}`, fetchOptions).catch((error) => {
    if (!error.message || error.message.startsWith('Request failed (')) {
      error.message = errorFallbacks[error.status] || `Request failed: ${error.status || 'unknown error'}`
    }
    throw error
  })
}

export const http = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, {
    ...options, method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
  }),
  put: (path, body, options) => request(path, {
    ...options, method: 'PUT', body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
  }),
  patch: (path, body, options) => request(path, {
    ...options, method: 'PATCH', body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
  }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
}
