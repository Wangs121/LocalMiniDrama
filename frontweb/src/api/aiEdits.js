import request from '@/utils/request'

export const aiEditsAPI = {
  get(entityType, entityId) {
    return request.get('/ai-edits/' + entityType + '/' + entityId)
  },
  send(entityType, entityId, body, options = {}) {
    return request.post('/ai-edits/' + entityType + '/' + entityId + '/messages', body, {
      signal: options.signal,
    })
  },
  updateProposal(entityType, entityId, messageId, body) {
    return request.patch('/ai-edits/' + entityType + '/' + entityId + '/proposals/' + messageId, body)
  },
  clear(entityType, entityId) {
    return request.delete('/ai-edits/' + entityType + '/' + entityId + '/messages')
  },
}
