/** 统一前端 API 入口；错误信息在边界处归一化，页面无需处理 fetch 细节。 */
async function getJson(path) {
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`请求失败：${response.status}`)
  }

  return response.json()
}

export function getPlatformHealth() {
  return getJson('/api/health')
}

export function getExamTypes() {
  return getJson('/api/exam-types')
}
