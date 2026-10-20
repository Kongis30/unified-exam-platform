import { apiRequest } from '@/api/platform'

let activePaperId

function editorPath(paperId, suffix) {
  if (!paperId) throw new Error('Open a SAT paper before editing its content.')
  return `/api/admin/sat/papers/${paperId}/editor${suffix ? `/${suffix}` : ''}`
}

function success(data) {
  return { success: true, data, message: 'Success' }
}

function jsonBody(value) {
  return { method: 'POST', body: JSON.stringify(value) }
}

export const paperApi = {
  async getInfo(paperId) {
    activePaperId = Number(paperId)
    const [paper, settings] = await Promise.all([
      apiRequest(`/api/admin/papers/${paperId}`),
      apiRequest(`/api/admin/papers/${paperId}/sat-settings`),
    ])
    return success({
      ...paper.summary,
      totalScore: settings.scoringTableCode === 'PSAT' ? 1520 : 1600,
      settings,
    })
  },
  async update(paperId, payload) {
    activePaperId = Number(paperId)
    const settings = await apiRequest(`/api/admin/papers/${paperId}/sat-settings`, {
      method: 'PUT', body: JSON.stringify({
        scoringTableCode: payload.scoringType, adaptiveMode: true, restTimeSeconds: 600,
      }),
    })
    return success(settings)
  },
}

export const paperEditApi = {
  async getStructure(paperId) {
    activePaperId = Number(paperId)
    return success(await apiRequest(editorPath(activePaperId, 'structure')))
  },
  async getQuestionDetail(questionId) {
    return success(await apiRequest(editorPath(activePaperId, `questions/${questionId}`)))
  },
  async createQuestion(data) {
    return success(await apiRequest(editorPath(activePaperId, 'questions'), jsonBody(data)))
  },
  async updateQuestion(data) {
    const { id, ...request } = data
    return success(await apiRequest(editorPath(activePaperId, `questions/${data.id}`), {
      method: 'PUT', body: JSON.stringify(request),
    }))
  },
  async deleteQuestion(questionId) {
    await apiRequest(editorPath(activePaperId, `questions/${questionId}`), { method: 'DELETE' })
    return success(null)
  },
  async createModule(data) {
    const { paperId, ...request } = data
    return success(await apiRequest(editorPath(paperId, 'modules'), jsonBody(request)))
  },
  async updateQuestionOrder(moduleId, questionIds) {
    await apiRequest(editorPath(activePaperId, `modules/${moduleId}/question-order`), {
      method: 'PUT', body: JSON.stringify(questionIds),
    })
    return success(null)
  },
  async copyQuestionToModule(questionId, targetModuleId) {
    return success(await apiRequest(editorPath(activePaperId, `questions/${questionId}/copy/${targetModuleId}`), {
      method: 'POST',
    }))
  },
  async createMaterial(data) {
    const response = await apiRequest(editorPath(activePaperId, 'materials'), jsonBody(data))
    return success(response.id)
  },
  async updateMaterial(materialId, data) {
    await apiRequest(editorPath(activePaperId, `materials/${materialId}`), {
      method: 'PUT', body: JSON.stringify(data),
    })
    return success(materialId)
  },
  async deleteMaterial(materialId) {
    await apiRequest(editorPath(activePaperId, `materials/${materialId}`), { method: 'DELETE' })
    return success(null)
  },
  async getAvailableMaterials(subject) {
    const query = subject ? `?subject=${encodeURIComponent(subject)}` : ''
    return success(await apiRequest(`${editorPath(activePaperId, 'materials')}${query}`))
  },
  async uploadMaterialImage(file) {
    const form = new FormData()
    form.append('file', file)
    const response = await apiRequest(`/api/admin/papers/${activePaperId}/question-images`, {
      method: 'POST', body: form,
    })
    return success({ url: response.assetUrl })
  },
}
