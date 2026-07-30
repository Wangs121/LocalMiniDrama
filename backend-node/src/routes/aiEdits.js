const response = require('../response');
const { createAiEditService } = require('../services/aiEditService');

const ENTITY_TYPES = new Set(['character', 'scene', 'prop', 'storyboard']);

function routeParams(req, requireMessageId = false) {
  const entityType = req.params && req.params.entity_type;
  const entityId = Number(req.params && req.params.entity_id);
  if (!ENTITY_TYPES.has(entityType)) throw Object.assign(new Error('无效的对象类型'), { code: 'BAD_REQUEST' });
  if (!Number.isInteger(entityId) || entityId <= 0) {
    throw Object.assign(new Error('对象 ID 必须是正整数'), { code: 'BAD_REQUEST' });
  }
  if (!requireMessageId) return { entityType, entityId };
  const messageId = Number(req.params && req.params.message_id);
  if (!Number.isInteger(messageId) || messageId <= 0) {
    throw Object.assign(new Error('消息 ID 必须是正整数'), { code: 'BAD_REQUEST' });
  }
  return { entityType, entityId, messageId };
}

function isValidationError(error) {
  return /必填|必须|无效|未知字段|缺少字段|不能为空|最大长度|消息长度|选择字段|candidate|schema_version|note/i
    .test(error.message || '');
}

function sendError(res, log, error) {
  const code = error.code || (isValidationError(error) ? 'BAD_REQUEST' : 'INTERNAL_ERROR');
  if (code === 'NOT_FOUND') return response.error(res, 404, code, error.message || '对象不存在');
  if (code === 'STALE_SNAPSHOT' || code === 'REQUEST_PENDING') {
    return response.error(res, 409, code, error.message || '请求状态冲突');
  }
  if (code === 'BAD_REQUEST' || /未配置文本模型/.test(error.message || '')) {
    return response.error(res, 400, code === 'BAD_REQUEST' ? code : 'BAD_REQUEST', error.message || '请求无效');
  }
  log.error('AI edit route failed', { error_code: code });
  return response.error(res, 500, 'INTERNAL_ERROR', 'AI 修改服务暂时不可用');
}

module.exports = function aiEditRoutes(db, _cfg, log, serviceOverride) {
  const logger = log || { info() {}, warn() {}, error() {} };
  const service = serviceOverride || createAiEditService({ db, log: logger });

  function get(req, res) {
    try {
      const { entityType, entityId } = routeParams(req);
      response.success(res, service.getConversation(entityType, entityId));
    } catch (error) {
      sendError(res, logger, error);
    }
  }

  async function send(req, res) {
    try {
      const { entityType, entityId } = routeParams(req);
      const result = await service.sendMessage(entityType, entityId, req.body || {});
      response.success(res, result);
    } catch (error) {
      sendError(res, logger, error);
    }
  }

  function updateProposal(req, res) {
    try {
      const { entityType, entityId, messageId } = routeParams(req, true);
      response.success(res, service.updateProposal(entityType, entityId, messageId, req.body || {}));
    } catch (error) {
      sendError(res, logger, error);
    }
  }

  function clear(req, res) {
    try {
      const { entityType, entityId } = routeParams(req);
      response.success(res, service.clearMessages(entityType, entityId));
    } catch (error) {
      sendError(res, logger, error);
    }
  }

  return { get, send, updateProposal, clear };
};
