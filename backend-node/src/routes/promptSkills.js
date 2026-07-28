const multer = require('multer');
const response = require('../response');
const promptSkillService = require('../services/promptSkillService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 100, fileSize: 2 * 1024 * 1024, fields: 20 },
}).any();

function skillUpload(req, res, next) {
  upload(req, res, (error) => {
    if (!error) return next();
    const messages = {
      LIMIT_FILE_SIZE: 'Skill 上传文件不能超过 2MB',
      LIMIT_FILE_COUNT: 'Skill 文件数量不能超过 100 个',
      LIMIT_UNEXPECTED_FILE: 'Skill 上传字段无效',
    };
    return response.badRequest(res, messages[error.code] || error.message || 'Skill 上传失败');
  });
}

module.exports = function promptSkillRoutes(db) {
  return {
    list: (_req, res) => response.success(res, { skills: promptSkillService.listSkills(db) }),
    get: (req, res) => {
      const skill = promptSkillService.previewSkill(db, String(req.params.id || ''));
      return skill ? response.success(res, { skill }) : response.notFound(res, 'Skill not found');
    },
    import: [skillUpload, (req, res) => {
      try {
        const archive = (req.files || []).find((file) => file.fieldname === 'archive');
        let files;
        if (archive) {
          if (!/\.zip$/i.test(archive.originalname || '')) return response.badRequest(res, '只支持 ZIP 压缩包');
          files = promptSkillService.packageFromZip(archive.buffer);
        } else {
          let relativePaths;
          try { relativePaths = JSON.parse(req.body?.relative_paths || '[]'); }
          catch (_) { return response.badRequest(res, 'relative_paths 不是有效 JSON'); }
          files = promptSkillService.packageFromUploads((req.files || []).filter((file) => file.fieldname === 'files'), relativePaths);
        }
        const result = promptSkillService.importSkill(db, files);
        if (!result.ok) {
          const message = (result.errors || [result.error]).join('; ');
          return result.code === 'conflict' ? response.conflict(res, message) : response.badRequest(res, message);
        }
        return response.success(res, result);
      } catch (error) {
        return response.badRequest(res, error.message);
      }
    }],
    update: (req, res) => {
      const id = String(req.params.id || '');
      if (typeof req.body?.enabled !== 'boolean') return response.badRequest(res, 'enabled must be boolean');
      const result = promptSkillService.setSkillEnabled(db, id, req.body.enabled);
      if (!result.ok) return result.code === 'not_found' ? response.notFound(res, result.error) : response.badRequest(res, result.error);
      return response.success(res, result);
    },
    delete: (req, res) => {
      const result = promptSkillService.deleteSkill(db, String(req.params.id || ''));
      if (!result.ok) {
        if (result.code === 'not_found') return response.notFound(res, result.error);
        if (result.code === 'forbidden') return response.forbidden(res, result.error);
        return response.badRequest(res, result.error);
      }
      return response.success(res, result);
    },
    projectGet: (req, res) => {
      const ids = promptSkillService.projectSkillIds(db, req.params.drama_id);
      return response.success(res, { mode: ids === undefined ? 'inherit' : ids.length ? 'custom' : 'disabled', skill_ids: ids ?? null });
    },
    projectUpdate: (req, res) => {
      const dramaId = Number(req.params.drama_id);
      const row = db.prepare('SELECT metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId);
      if (!row) return response.notFound(res, 'Drama not found');
      let metadata = {};
      try { metadata = row.metadata ? JSON.parse(row.metadata) : {}; } catch (_) {}
      const mode = req.body?.mode;
      if (mode === 'inherit') delete metadata.prompt_skill_ids;
      else if (mode === 'disabled') metadata.prompt_skill_ids = [];
      else if (mode === 'custom' && Array.isArray(req.body?.skill_ids)) {
        const validIds = new Set(promptSkillService.loadSkills().filter((skill) => skill.valid).map((skill) => skill.id));
        metadata.prompt_skill_ids = [...new Set(req.body.skill_ids.map(String).filter((id) => validIds.has(id)))];
      } else return response.badRequest(res, 'Invalid project Skill mode');
      db.prepare('UPDATE dramas SET metadata = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(metadata), new Date().toISOString(), dramaId);
      return response.success(res, { mode, skill_ids: metadata.prompt_skill_ids ?? null });
    },
  };
};
