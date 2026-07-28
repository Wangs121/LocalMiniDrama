import request from '@/utils/request'

export const promptSkillsAPI = {
  list() {
    return request.get('/prompt-skills')
  },
  get(id) {
    return request.get(`/prompt-skills/${encodeURIComponent(id)}`)
  },
  import(formData) {
    return request.post('/prompt-skills/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  setEnabled(id, enabled) {
    return request.put(`/prompt-skills/${encodeURIComponent(id)}`, { enabled })
  },
  remove(id) {
    return request.delete(`/prompt-skills/${encodeURIComponent(id)}`)
  },
  getProject(dramaId) {
    return request.get(`/dramas/${dramaId}/prompt-skills`)
  },
  updateProject(dramaId, body) {
    return request.put(`/dramas/${dramaId}/prompt-skills`, body)
  }
}
