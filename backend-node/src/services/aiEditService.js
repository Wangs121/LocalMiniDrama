const aiClient = require('./aiClient');
const { safeParseAIJSON } = require('../utils/safeJson');
const { loadEntityContext } = require('./aiEditContextService');
const { buildGenerationPrompts, buildRepairPrompts } = require('./aiEditPromptBuilder');
const {
  getAdapter,
  validateCandidate,
  validateEnvelope,
  diffSnapshots,
  snapshotHash,
  mediaImpactForChanges,
} = require('./aiEditSchemas');

const FIELD_LABELS = {
  name: '名称',
  role: '角色定位',
  appearance: '外观',
  personality: '性格',
  description: '描述',
  voice_style: '声音风格',
  polished_prompt: '润色提示词',
  polished_prompt_single: '单图提示词',
  negative_prompt: '负面提示词',
  stages: '阶段形象',
  location: '地点',
  time: '时间',
  prompt: '提示词',
  title: '标题',
  layout_description: '画面布局',
  duration: '时长',
  dialogue: '对白',
  narration: '旁白',
  action: '动作',
  atmosphere: '氛围',
  image_prompt: '图片提示词',
  video_prompt: '视频提示词',
  universal_segment_text: '全能分镜文本',
  shot_type: '景别',
  angle_h: '水平角度',
  angle_v: '垂直角度',
  angle_s: '取景范围',
  movement: '镜头运动',
  lighting_style: '灯光风格',
  depth_of_field: '景深',
  scene_id: '场景',
  character_ids: '角色',
  prop_ids: '道具',
  type: '类型',
};

function serviceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function createAiEditService({ db, log, generateText = aiClient.generateText }) {
  if (!db) throw new Error('db 必填');
  const logger = log || { info() {}, warn() {}, error() {} };

  function loadContext(entityType, entityId, episodeId) {
    try {
      getAdapter(entityType);
      return loadEntityContext(db, entityType, entityId, episodeId);
    } catch (error) {
      if (/不存在/.test(error.message)) throw serviceError('NOT_FOUND', error.message);
      throw error;
    }
  }

  function findConversation(entityType, entityId) {
    return db.prepare(
      'SELECT * FROM ai_edit_conversations WHERE entity_type = ? AND entity_id = ?'
    ).get(entityType, Number(entityId)) || null;
  }

  function ensureConversation(context) {
    const now = nowIso();
    db.prepare(
      `INSERT OR IGNORE INTO ai_edit_conversations
       (entity_type, entity_id, drama_id, episode_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      context.entityType,
      context.entityId,
      context.drama.id,
      context.episode ? context.episode.id : null,
      now,
      now
    );
    const conversation = findConversation(context.entityType, context.entityId);
    if (!conversation) throw new Error('无法创建 AI 修改会话');
    return conversation;
  }

  function messageView(row) {
    return {
      message_id: Number(row.id),
      reply_to_message_id: row.reply_to_message_id == null ? null : Number(row.reply_to_message_id),
      client_request_id: row.client_request_id || null,
      role: row.role,
      content: row.content || '',
      base_snapshot_hash: row.base_snapshot_hash || null,
      candidate: parseJson(row.candidate_json, null),
      changes: parseJson(row.diff_json, []),
      proposal_status: row.proposal_status || null,
      selected_fields: parseJson(row.selected_fields_json, []),
      request_status: row.request_status,
      error_code: row.error_code || null,
      created_at: row.created_at,
    };
  }

  function resultForUserMessage(conversationId, userMessage) {
    if (userMessage.request_status === 'pending') {
      throw serviceError('REQUEST_PENDING', '该请求正在处理');
    }
    const assistant = db.prepare(
      `SELECT * FROM ai_edit_messages
       WHERE conversation_id = ? AND reply_to_message_id = ? AND role = 'assistant'
       ORDER BY id DESC LIMIT 1`
    ).get(conversationId, userMessage.id);
    if (userMessage.request_status === 'failed') {
      const errorCode = (assistant && assistant.error_code) || userMessage.error_code || 'AI_EDIT_FAILED';
      throw serviceError(errorCode, (assistant && assistant.content) || 'AI 修改请求失败');
    }
    if (!assistant) throw new Error('已完成请求缺少助手回复');
    const view = messageView(assistant);
    return {
      message_id: view.message_id,
      reply: view.content,
      content: view.content,
      candidate: view.candidate,
      changes: view.changes,
      base_snapshot_hash: view.base_snapshot_hash,
      proposal_status: view.proposal_status,
      media_impact: mediaImpactForChanges(
        findConversationById(conversationId).entity_type,
        view.changes.map((change) => change.field)
      ),
    };
  }

  function findConversationById(conversationId) {
    return db.prepare('SELECT * FROM ai_edit_conversations WHERE id = ?').get(conversationId);
  }

  function recentMessages(conversationId) {
    return db.prepare(
      `SELECT role, content, request_status FROM (
         SELECT id, role, content, request_status
         FROM ai_edit_messages
         WHERE conversation_id = ? AND request_status = 'completed'
         ORDER BY id DESC LIMIT 12
       ) ORDER BY id ASC`
    ).all(conversationId);
  }

  function previousCandidate(conversationId, messageId) {
    if (messageId === null || messageId === undefined || messageId === '') return null;
    const row = db.prepare(
      `SELECT candidate_json FROM ai_edit_messages
       WHERE id = ? AND conversation_id = ? AND role = 'assistant'
         AND request_status = 'completed' AND proposal_status = 'pending'`
    ).get(Number(messageId), conversationId);
    if (!row) throw serviceError('INVALID_PREVIOUS_CANDIDATE', '上一候选无效或已处理');
    const candidate = parseJson(row.candidate_json, null);
    if (!candidate) throw serviceError('INVALID_PREVIOUS_CANDIDATE', '上一候选内容无效');
    return candidate;
  }

  async function callProvider(userPrompt, systemPrompt, jsonMode = true) {
    const options = {
      scene_key: 'ai_edit',
      json_mode: jsonMode,
      max_tokens: 12000,
      temperature: 0.2,
      redact_content_log: true,
    };
    try {
      return await generateText(db, logger, 'text', userPrompt, systemPrompt, options);
    } catch (error) {
      if (jsonMode && /response_format|json_object|json mode/i.test(error.message || '')) {
        return generateText(db, logger, 'text', userPrompt, systemPrompt, {
          ...options,
          json_mode: false,
        });
      }
      throw error;
    }
  }

  function parseAndValidate(rawText, entityType, dramaId) {
    const parseLogger = {
      warn(message, details = {}) {
        logger.warn('AI edit JSON parse warning', {
          error_category: message,
          text_length: Number(details.text_length) || Number(details.original_len) || 0,
        });
      },
    };
    const parsed = safeParseAIJSON(rawText, {}, parseLogger);
    return validateEnvelope(db, entityType, { dramaId }, parsed);
  }

  function replyText(changes, note) {
    const labels = changes.map((change) => FIELD_LABELS[change.field] || change.field);
    const summary = labels.length > 0
      ? `已生成 ${labels.length} 项修改：${labels.join('、')}`
      : '未发现需要修改的字段';
    return note ? `${summary}\n${note}` : summary;
  }

  function recordFailure(conversationId, userMessageId, error) {
    const code = error.code || 'AI_EDIT_FAILED';
    const message = error.message || 'AI 修改请求失败';
    const now = nowIso();
    db.transaction(() => {
      db.prepare(
        `UPDATE ai_edit_messages SET request_status = 'failed', error_code = ? WHERE id = ?`
      ).run(code, userMessageId);
      db.prepare(
        `INSERT INTO ai_edit_messages
         (conversation_id, reply_to_message_id, role, content, request_status, error_code, created_at)
         VALUES (?, ?, 'assistant', ?, 'failed', ?, ?)`
      ).run(conversationId, userMessageId, message, code, now);
      db.prepare('UPDATE ai_edit_conversations SET updated_at = ? WHERE id = ?').run(now, conversationId);
    })();
  }

  async function sendMessage(entityType, entityId, body = {}) {
    getAdapter(entityType);
    const numericEntityId = Number(entityId);
    if (!Number.isInteger(numericEntityId) || numericEntityId <= 0) throw new Error('对象 ID 必须是正整数');
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message || message.length > 4000) throw new Error('消息长度必须为 1-4000 字符');
    const clientRequestId = typeof body.client_request_id === 'string' ? body.client_request_id.trim() : '';
    if (!clientRequestId || clientRequestId.length > 200) throw new Error('client_request_id 无效');

    const context = loadContext(entityType, numericEntityId, body.episode_id);
    const currentSnapshot = validateCandidate(
      db,
      entityType,
      { dramaId: context.drama.id },
      body.current_snapshot
    );
    const baseHash = snapshotHash(currentSnapshot);
    if (body.base_snapshot_hash !== baseHash) {
      throw serviceError('STALE_SNAPSHOT', '当前表单快照已变化，请重新发送');
    }

    const conversation = ensureConversation(context);
    const duplicate = db.prepare(
      `SELECT * FROM ai_edit_messages
       WHERE conversation_id = ? AND role = 'user' AND client_request_id = ?`
    ).get(conversation.id, clientRequestId);
    if (duplicate) return resultForUserMessage(conversation.id, duplicate);

    const otherPending = db.prepare(
      `SELECT id FROM ai_edit_messages
       WHERE conversation_id = ? AND role = 'user' AND request_status = 'pending' LIMIT 1`
    ).get(conversation.id);
    if (otherPending) throw serviceError('REQUEST_PENDING', '已有 AI 修改请求正在处理');

    const now = nowIso();
    const userInfo = db.prepare(
      `INSERT INTO ai_edit_messages
       (conversation_id, client_request_id, role, content, base_snapshot_hash, request_status, created_at)
       VALUES (?, ?, 'user', ?, ?, 'pending', ?)`
    ).run(conversation.id, clientRequestId, message, baseHash, now);
    const userMessageId = Number(userInfo.lastInsertRowid);

    try {
      const draft = previousCandidate(conversation.id, body.previous_candidate_message_id);
      const history = recentMessages(conversation.id);
      const prompts = buildGenerationPrompts(context, currentSnapshot, draft, history, message);
      const rawText = await callProvider(prompts.userPrompt, prompts.systemPrompt, true);
      let envelope;
      try {
        envelope = parseAndValidate(rawText, entityType, context.drama.id);
      } catch (firstError) {
        const repair = buildRepairPrompts(entityType, rawText, firstError.message, currentSnapshot);
        const repairedText = await callProvider(repair.userPrompt, repair.systemPrompt, true);
        try {
          envelope = parseAndValidate(repairedText, entityType, context.drama.id);
        } catch (repairError) {
          repairError.code = 'INVALID_AI_RESPONSE';
          throw repairError;
        }
      }

      const changes = diffSnapshots(entityType, currentSnapshot, envelope.candidate);
      const content = envelope.reply || replyText(changes, envelope.note);
      const completedAt = nowIso();
      let assistantMessageId;
      db.transaction(() => {
        db.prepare(
          `UPDATE ai_edit_messages SET proposal_status = 'superseded'
           WHERE conversation_id = ? AND role = 'assistant'
             AND request_status = 'completed' AND proposal_status = 'pending'`
        ).run(conversation.id);
        const assistantInfo = db.prepare(
          `INSERT INTO ai_edit_messages
           (conversation_id, reply_to_message_id, role, content, base_snapshot_hash,
            candidate_json, diff_json, proposal_status, request_status, created_at)
           VALUES (?, ?, 'assistant', ?, ?, ?, ?, 'pending', 'completed', ?)`
        ).run(
          conversation.id,
          userMessageId,
          content,
          baseHash,
          JSON.stringify(envelope.candidate),
          JSON.stringify(changes),
          completedAt
        );
        assistantMessageId = Number(assistantInfo.lastInsertRowid);
        db.prepare(
          `UPDATE ai_edit_messages SET request_status = 'completed', error_code = NULL WHERE id = ?`
        ).run(userMessageId);
        db.prepare('UPDATE ai_edit_conversations SET updated_at = ? WHERE id = ?')
          .run(completedAt, conversation.id);
      })();
      return {
        message_id: assistantMessageId,
        reply: content,
        content,
        candidate: envelope.candidate,
        changes,
        base_snapshot_hash: baseHash,
        proposal_status: 'pending',
        media_impact: mediaImpactForChanges(entityType, changes.map((change) => change.field)),
      };
    } catch (error) {
      recordFailure(conversation.id, userMessageId, error);
      throw error;
    }
  }

  function getConversation(entityType, entityId) {
    loadContext(entityType, entityId, null);
    const conversation = findConversation(entityType, entityId);
    if (!conversation) {
      return { conversation_id: null, messages: [], has_pending_request: false, latest_candidate: null };
    }
    const messages = db.prepare(
      'SELECT * FROM ai_edit_messages WHERE conversation_id = ? ORDER BY id ASC'
    ).all(conversation.id).map(messageView);
    const latestCandidate = [...messages].reverse().find((message) => (
      message.role === 'assistant'
      && message.request_status === 'completed'
      && message.proposal_status === 'pending'
    )) || null;
    return {
      conversation_id: Number(conversation.id),
      messages,
      has_pending_request: messages.some((message) => (
        message.role === 'user' && message.request_status === 'pending'
      )),
      latest_candidate: latestCandidate,
    };
  }

  function updateProposal(entityType, entityId, messageId, body = {}) {
    loadContext(entityType, entityId, null);
    const conversation = findConversation(entityType, entityId);
    if (!conversation) throw serviceError('NOT_FOUND', '会话不存在');
    const row = db.prepare(
      `SELECT * FROM ai_edit_messages
       WHERE id = ? AND conversation_id = ? AND role = 'assistant'
         AND request_status = 'completed' AND proposal_status = 'pending'`
    ).get(Number(messageId), conversation.id);
    if (!row) throw serviceError('NOT_FOUND', '待处理候选不存在');
    if (!Array.isArray(body.selected_fields)) throw new Error('selected_fields 必须是数组');
    const selected = [...new Set(body.selected_fields)];
    if (!selected.every((field) => typeof field === 'string')) throw new Error('选择字段无效');
    const changes = parseJson(row.diff_json, []);
    const allowed = new Set(changes.map((change) => change.field));
    if (!selected.every((field) => allowed.has(field))) throw new Error('选择字段不是候选差异的子集');
    const proposalStatus = selected.length === 0
      ? 'discarded'
      : (selected.length === allowed.size ? 'applied_to_form' : 'partially_applied_to_form');
    db.prepare(
      `UPDATE ai_edit_messages SET proposal_status = ?, selected_fields_json = ? WHERE id = ?`
    ).run(proposalStatus, JSON.stringify(selected), row.id);
    return messageView(db.prepare('SELECT * FROM ai_edit_messages WHERE id = ?').get(row.id));
  }

  function clearMessages(entityType, entityId) {
    loadContext(entityType, entityId, null);
    const conversation = findConversation(entityType, entityId);
    if (!conversation) return { cleared: 0 };
    const pending = db.prepare(
      `SELECT id FROM ai_edit_messages
       WHERE conversation_id = ? AND role = 'user' AND request_status = 'pending' LIMIT 1`
    ).get(conversation.id);
    if (pending) throw serviceError('REQUEST_PENDING', '请求正在处理，暂时不能清空会话');
    let cleared = 0;
    db.transaction(() => {
      cleared = db.prepare('DELETE FROM ai_edit_messages WHERE conversation_id = ?')
        .run(conversation.id).changes;
      db.prepare('UPDATE ai_edit_conversations SET updated_at = ? WHERE id = ?')
        .run(nowIso(), conversation.id);
    })();
    return { cleared };
  }

  return { getConversation, sendMessage, updateProposal, clearMessages };
}

module.exports = { createAiEditService };
