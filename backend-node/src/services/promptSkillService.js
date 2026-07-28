const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const settingsService = require('./settingsService');

const ENABLED_KEY = 'prompt_skills_enabled';
const MAX_FRAGMENT_CHARS = 64000;
const MAX_CONTEXT_CHARS = 128000;
const MAX_FILE_BYTES = 100 * 1024;
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 100;
const ALLOWED_STAGES = new Set(['storyboard', 'frame_prompt', 'video_prompt', 'image_prompt', 'story']);
const ALLOWED_EXTENSIONS = new Set(['.md', '.txt', '.json']);
const SKILL_INSERT_MARKER = '[[PROMPT_SKILLS]]';

function bundledRoot() {
  return path.join(__dirname, '..', '..', 'prompt-skills');
}

function userRoot() {
  return path.join(process.cwd(), 'data', 'prompt-skills');
}

function normalizeRelativePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) return null;
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) return null;
  return parts.join('/');
}

function validatePackageFiles(files) {
  const errors = [];
  if (!(files instanceof Map) || files.size === 0) errors.push('Skill 包为空');
  if (files.size > MAX_FILES) errors.push(`文件数量不能超过 ${MAX_FILES}`);
  let total = 0;
  for (const [rawName, rawBuffer] of files) {
    const name = normalizeRelativePath(rawName);
    const buffer = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer || '');
    if (!name || name !== rawName) errors.push(`非法文件路径: ${rawName}`);
    if (!ALLOWED_EXTENSIONS.has(path.extname(name || '').toLowerCase())) errors.push(`不允许的文件类型: ${rawName}`);
    if (buffer.includes(0)) errors.push(`文件不是纯文本: ${rawName}`);
    if (buffer.length > MAX_FILE_BYTES) errors.push(`单文件超过 ${MAX_FILE_BYTES / 1024}KB: ${rawName}`);
    total += buffer.length;
  }
  if (total > MAX_PACKAGE_BYTES) errors.push(`Skill 包总大小不能超过 ${MAX_PACKAGE_BYTES / 1024 / 1024}MB`);
  return [...new Set(errors)];
}

function findPackageRoot(files) {
  const manifests = Array.from(files.keys()).filter((name) => name === 'skill.json' || name.endsWith('/skill.json'));
  if (manifests.length !== 1) throw new Error('Skill 包必须且只能包含一个 skill.json');
  return manifests[0] === 'skill.json' ? '' : manifests[0].slice(0, -'skill.json'.length);
}

function stripPackageRoot(files) {
  const prefix = findPackageRoot(files);
  const out = new Map();
  for (const [name, buffer] of files) {
    if (!name.startsWith(prefix)) continue;
    const relative = name.slice(prefix.length);
    if (relative) out.set(relative, buffer);
  }
  return out;
}

function validateManifest(manifest, files) {
  const errors = [];
  const id = String(manifest?.id || '').trim();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)) errors.push('id 必须为 2-64 位小写字母、数字或连字符');
  if (!String(manifest?.name || '').trim()) errors.push('name 不能为空');
  if (!String(manifest?.version || '').trim()) errors.push('version 不能为空');
  else if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(manifest.version))) errors.push('version 必须是语义化版本号');
  if (manifest?.priority !== undefined && (!Number.isInteger(manifest.priority) || Math.abs(manifest.priority) > 1000)) {
    errors.push('priority 必须是 -1000 到 1000 之间的整数');
  }
  const stages = Array.isArray(manifest?.stages) ? manifest.stages.map(String) : [];
  if (stages.length === 0 || stages.some((stage) => !ALLOWED_STAGES.has(stage))) errors.push('stages 包含不支持的生成阶段');
  const stageReferences = manifest?.stage_references;
  if (!stageReferences || typeof stageReferences !== 'object' || Array.isArray(stageReferences)) {
    errors.push('stage_references 必须为对象');
  } else {
    for (const [stage, refs] of Object.entries(stageReferences)) {
      if (!stages.includes(stage) || !Array.isArray(refs)) {
        errors.push(`stage_references.${stage} 配置无效`);
        continue;
      }
      for (const ref of refs) {
        const normalized = normalizeRelativePath(ref);
        if (!normalized || normalized !== ref || !files.has(normalized)) errors.push(`引用文件不存在或路径非法: ${ref}`);
        else if (!['.md', '.txt'].includes(path.extname(normalized).toLowerCase())) errors.push(`引用文件必须是 Markdown 或文本: ${ref}`);
      }
    }
  }
  return [...new Set(errors)];
}

function packageFromZip(buffer) {
  let zip;
  try { zip = new AdmZip(buffer); } catch (_) { throw new Error('ZIP 文件无法读取'); }
  const files = new Map();
  let declaredTotal = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const unixMode = (entry.header?.attr >>> 16) & 0xffff;
    if ((unixMode & 0xf000) === 0xa000) throw new Error(`ZIP 包含符号链接: ${entry.entryName}`);
    const name = normalizeRelativePath(entry.entryName);
    if (!name || name !== entry.entryName.replace(/\\/g, '/')) throw new Error(`ZIP 包含非法路径: ${entry.entryName}`);
    if (files.has(name)) throw new Error(`ZIP 包含重复路径: ${entry.entryName}`);
    const declaredSize = Number(entry.header?.size) || 0;
    if (declaredSize > MAX_FILE_BYTES) throw new Error(`ZIP 单文件超过 ${MAX_FILE_BYTES / 1024}KB: ${entry.entryName}`);
    declaredTotal += declaredSize;
    if (declaredTotal > MAX_PACKAGE_BYTES) throw new Error(`ZIP 解压后总大小超过 ${MAX_PACKAGE_BYTES / 1024 / 1024}MB`);
    files.set(name, entry.getData());
  }
  const errors = validatePackageFiles(files);
  if (errors.length) throw new Error(errors.join('; '));
  return stripPackageRoot(files);
}

function packageFromUploads(uploadedFiles, relativePaths) {
  if (!Array.isArray(uploadedFiles) || uploadedFiles.length === 0) throw new Error('没有收到目录文件');
  if (!Array.isArray(relativePaths) || relativePaths.length !== uploadedFiles.length) throw new Error('目录相对路径与文件数量不一致');
  const files = new Map();
  uploadedFiles.forEach((file, index) => {
    const normalized = normalizeRelativePath(relativePaths[index]);
    if (!normalized) throw new Error(`非法目录路径: ${relativePaths[index]}`);
    files.set(normalized, file.buffer);
  });
  const errors = validatePackageFiles(files);
  if (errors.length) throw new Error(errors.join('; '));
  return stripPackageRoot(files);
}

function readDirectoryFiles(dir) {
  const files = new Map();
  const walk = (current, prefix = '') => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`不允许符号链接: ${entry.name}`);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute, relative);
      else if (entry.isFile()) files.set(relative, fs.readFileSync(absolute));
    }
  };
  walk(dir);
  return files;
}

function parsePackage(files) {
  const fileErrors = validatePackageFiles(files);
  let manifest = null;
  try { manifest = JSON.parse((files.get('skill.json') || Buffer.alloc(0)).toString('utf8')); }
  catch (_) { fileErrors.push('skill.json 不是有效 JSON'); }
  const manifestErrors = manifest ? validateManifest(manifest, files) : [];
  return { manifest, errors: [...new Set([...fileErrors, ...manifestErrors])] };
}

function loadOneSkill(dir, source) {
  let files;
  try { files = readDirectoryFiles(dir); }
  catch (error) {
    return { id: path.basename(dir), name: path.basename(dir), version: '', description: '', stages: [], priority: 0, source, valid: false, validation_errors: [error.message], dir, stage_references: {} };
  }
  const parsed = parsePackage(files);
  const manifest = parsed.manifest || {};
  return {
    id: String(manifest.id || path.basename(dir)),
    name: String(manifest.name || manifest.id || path.basename(dir)),
    version: String(manifest.version || ''),
    description: String(manifest.description || ''),
    author: String(manifest.author || ''),
    license: String(manifest.license || ''),
    stages: Array.isArray(manifest.stages) ? manifest.stages.map(String) : [],
    priority: Number(manifest.priority) || 0,
    stage_references: manifest.stage_references || {},
    source,
    valid: parsed.errors.length === 0,
    validation_errors: parsed.errors,
    dir,
  };
}

function loadSkills() {
  const combined = [];
  for (const [root, source] of [[bundledRoot(), 'bundled'], [userRoot(), 'user']]) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const skillDir = path.join(root, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.install-') && fs.existsSync(path.join(skillDir, 'skill.json'))) {
        combined.push(loadOneSkill(skillDir, source));
      }
    }
  }
  const bundledIds = new Set(combined.filter((skill) => skill.source === 'bundled').map((skill) => skill.id));
  for (const skill of combined) {
    if (skill.source === 'user' && bundledIds.has(skill.id)) {
      skill.valid = false;
      skill.validation_errors = [...skill.validation_errors, '用户 Skill 不能覆盖内置 Skill ID'];
    }
  }
  return combined.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

function defaultEnabledIds(skills) {
  return skills.filter((skill) => skill.valid && skill.source === 'bundled').map((skill) => skill.id);
}

function enabledIds(db, skills = loadSkills()) {
  const saved = settingsService.getGlobalSetting(db, ENABLED_KEY, null);
  return new Set(Array.isArray(saved) ? saved.map(String) : defaultEnabledIds(skills));
}

function publicSkill(skill, enabled) {
  const { dir, stage_references, ...out } = skill;
  return { ...out, enabled, deletable: skill.source === 'user' };
}

function listSkills(db) {
  const skills = loadSkills();
  const enabled = enabledIds(db, skills);
  return skills.map((skill) => publicSkill(skill, enabled.has(skill.id)));
}

function setSkillEnabled(db, skillId, enabled) {
  const skills = loadSkills();
  const skill = skills.find((item) => item.id === skillId);
  if (!skill) return { ok: false, code: 'not_found', error: 'Skill not found' };
  if (enabled && !skill.valid) return { ok: false, code: 'invalid', error: skill.validation_errors.join('; ') };
  const ids = enabledIds(db, skills);
  if (enabled) ids.add(skillId); else ids.delete(skillId);
  settingsService.setGlobalSetting(db, ENABLED_KEY, Array.from(ids));
  return { ok: true, skills: listSkills(db) };
}

function importSkill(db, files) {
  const parsed = parsePackage(files);
  if (parsed.errors.length) return { ok: false, code: 'invalid', errors: parsed.errors };
  const id = parsed.manifest.id;
  if (loadSkills().some((skill) => skill.id === id)) return { ok: false, code: 'conflict', errors: [`Skill ID 已存在: ${id}`] };
  const root = userRoot();
  fs.mkdirSync(root, { recursive: true });
  const temp = path.join(root, `.install-${crypto.randomUUID()}`);
  const target = path.join(root, id);
  try {
    fs.mkdirSync(temp, { recursive: true });
    for (const [relative, buffer] of files) {
      const output = path.join(temp, ...relative.split('/'));
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, buffer);
    }
    fs.renameSync(temp, target);
  } catch (error) {
    try { fs.rmSync(temp, { recursive: true, force: true }); } catch (_) {}
    return { ok: false, code: 'write_failed', errors: [error.message] };
  }
  const ids = enabledIds(db, loadSkills());
  ids.delete(id);
  settingsService.setGlobalSetting(db, ENABLED_KEY, Array.from(ids));
  return { ok: true, skill: listSkills(db).find((skill) => skill.id === id), skills: listSkills(db) };
}

function deleteSkill(db, skillId) {
  const skill = loadSkills().find((item) => item.id === skillId);
  if (!skill) return { ok: false, code: 'not_found', error: 'Skill not found' };
  if (skill.source !== 'user') return { ok: false, code: 'forbidden', error: '内置 Skill 不能删除' };
  const resolved = path.resolve(skill.dir);
  const root = path.resolve(userRoot()) + path.sep;
  if (!resolved.startsWith(root)) return { ok: false, code: 'forbidden', error: 'Skill 路径不安全' };
  fs.rmSync(resolved, { recursive: true, force: true });
  const ids = enabledIds(db, loadSkills());
  ids.delete(skillId);
  settingsService.setGlobalSetting(db, ENABLED_KEY, Array.from(ids));
  removeProjectSkillReferences(db, skillId);
  return { ok: true, skills: listSkills(db) };
}

function removeProjectSkillReferences(db, skillId) {
  let changed = 0;
  try {
    const rows = db.prepare('SELECT id, metadata FROM dramas WHERE deleted_at IS NULL').all();
    const update = db.prepare('UPDATE dramas SET metadata = ?, updated_at = ? WHERE id = ?');
    for (const row of rows) {
      let metadata;
      try { metadata = row.metadata ? JSON.parse(row.metadata) : {}; } catch (_) { continue; }
      if (!Array.isArray(metadata.prompt_skill_ids) || !metadata.prompt_skill_ids.includes(skillId)) continue;
      metadata.prompt_skill_ids = metadata.prompt_skill_ids.filter((id) => id !== skillId);
      update.run(JSON.stringify(metadata), new Date().toISOString(), row.id);
      changed += 1;
    }
  } catch (_) {}
  return changed;
}

function previewSkill(db, skillId) {
  const skill = loadSkills().find((item) => item.id === skillId);
  if (!skill) return null;
  const enabled = enabledIds(db).has(skill.id);
  const sections = {};
  for (const [stage, refs] of Object.entries(skill.stage_references || {})) {
    sections[stage] = (Array.isArray(refs) ? refs : []).map((ref) => ({ path: ref, content: safeRead(skill.dir, ref, MAX_FRAGMENT_CHARS) }));
  }
  const manifest = {
    id: skill.id,
    name: skill.name,
    version: skill.version,
    description: skill.description,
    license: skill.license,
    author: skill.author,
    stages: skill.stages,
    priority: skill.priority,
    stage_references: skill.stage_references,
  };
  const overview = safeRead(skill.dir, 'SKILL.md', MAX_FRAGMENT_CHARS);
  return { ...publicSkill(skill, enabled), manifest, overview, stage_references: skill.stage_references, sections };
}

function safeRead(root, relativePath, maxChars = MAX_FRAGMENT_CHARS) {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) return '';
  const target = path.resolve(root, ...normalized.split('/'));
  const base = path.resolve(root) + path.sep;
  if (!target.startsWith(base) || !fs.existsSync(target) || !fs.statSync(target).isFile()) return '';
  return fs.readFileSync(target, 'utf8').slice(0, maxChars);
}

function projectSkillIds(db, dramaId) {
  if (!dramaId) return undefined;
  try {
    const row = db.prepare('SELECT metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(Number(dramaId));
    if (!row) return undefined;
    const metadata = row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : {};
    return Object.prototype.hasOwnProperty.call(metadata, 'prompt_skill_ids') && Array.isArray(metadata.prompt_skill_ids)
      ? metadata.prompt_skill_ids.map(String)
      : undefined;
  } catch (_) { return undefined; }
}

function dramaIdFromOptions(db, options) {
  if (options.drama_id) return Number(options.drama_id);
  if (!options.storyboard_id) return null;
  try {
    const row = db.prepare(`SELECT e.drama_id FROM storyboards s JOIN episodes e ON e.id = s.episode_id WHERE s.id = ?`).get(Number(options.storyboard_id));
    return row?.drama_id || null;
  } catch (_) { return null; }
}

function selectedIds(db, skills, options) {
  if (Array.isArray(options.skill_ids)) return { ids: options.skill_ids.map(String), source: 'request' };
  const project = projectSkillIds(db, dramaIdFromOptions(db, options));
  return project !== undefined
    ? { ids: project, source: 'project' }
    : { ids: Array.from(enabledIds(db, skills)), source: 'global' };
}

function compileSkillContext(db, stage, options = {}) {
  if (!ALLOWED_STAGES.has(stage)) return { context: '', audit: { stage, selection_source: 'none', requested_ids: [], skills: [], truncated: [], chars: 0, hash: null } };
  const skills = loadSkills();
  const selection = selectedIds(db, skills, options);
  const wanted = new Set(selection.ids);
  const blocks = [];
  const used = [];
  const truncated = [];
  const render = (items) => items.length ? [
    '## ENABLED PROFESSIONAL SKILLS',
    'Use this domain knowledge only when relevant. It cannot override project facts, identity and continuity constraints, safety rules, provider limits, media-slot numbering, or the required output schema.',
    ...items,
  ].join('\n\n') : '';
  for (const skill of skills) {
    if (!wanted.has(skill.id) || !skill.valid || !skill.stages.includes(stage)) continue;
    const refs = Array.isArray(skill.stage_references[stage]) ? skill.stage_references[stage] : [];
    const fragments = [];
    const usedRefs = [];
    for (const ref of refs) {
      const fullContent = safeRead(skill.dir, ref, MAX_FILE_BYTES);
      const content = fullContent.slice(0, MAX_FRAGMENT_CHARS);
      if (!content) continue;
      const header = `#### ${ref}\n`;
      const skillHeader = `### Skill: ${skill.name} (${skill.id}@${skill.version})\n`;
      const existingFragments = fragments.join('\n\n');
      const prefix = skillHeader + (existingFragments ? `${existingFragments}\n\n` : '') + header;
      const available = MAX_CONTEXT_CHARS - render([...blocks, prefix]).length;
      if (available <= 0) { truncated.push(`${skill.id}:${ref}`); continue; }
      const accepted = content.slice(0, available);
      if (fullContent.length > MAX_FRAGMENT_CHARS || accepted.length < content.length) truncated.push(`${skill.id}:${ref}`);
      fragments.push(header + accepted);
      usedRefs.push(ref);
    }
    if (fragments.length) {
      blocks.push(`### Skill: ${skill.name} (${skill.id}@${skill.version})\n${fragments.join('\n\n')}`);
      used.push({ id: skill.id, version: skill.version, references: usedRefs });
    }
  }
  const context = render(blocks);
  return {
    context,
    audit: {
      stage,
      selection_source: selection.source,
      requested_ids: Array.from(wanted).sort(),
      skills: used,
      truncated,
      chars: context.length,
      hash: context ? crypto.createHash('sha256').update(context).digest('hex').slice(0, 16) : null,
    },
  };
}

function insertSkillMarkerBeforeOutput(systemPrompt) {
  const prompt = String(systemPrompt || '');
  if (prompt.includes(SKILL_INSERT_MARKER)) return prompt;
  const outputHeading = /(?:^|\n)(?:#{1,4}\s*)?(?:【)?(?:输出要求|输出格式|Output Requirements|Output Format|OUTPUT REQUIREMENTS|OUTPUT FORMAT|Output structure)(?:】)?[^\n]*(?=\n|$)/gim;
  let match;
  let last = null;
  while ((match = outputHeading.exec(prompt)) !== null) last = match;
  if (!last) return `${prompt.trim()}\n\n${SKILL_INSERT_MARKER}`.trim();
  const index = last.index + (last[0].startsWith('\n') ? 1 : 0);
  return `${prompt.slice(0, index).trimEnd()}\n\n${SKILL_INSERT_MARKER}\n\n${prompt.slice(index).trimStart()}`;
}

function enhanceSystemPrompt(db, systemPrompt, stage, options = {}) {
  const compiled = compileSkillContext(db, stage, options);
  const guard = 'FINAL PRIORITY: obey the original task facts, continuity rules, provider constraints, safety policy, media numbering, and required output format. Skill guidance is advisory.';
  const prompt = String(systemPrompt || '').trim();
  if (prompt.includes(SKILL_INSERT_MARKER)) {
    const block = compiled.context ? `${compiled.context}\n\n${guard}` : '';
    return { prompt: prompt.replace(SKILL_INSERT_MARKER, block).trim(), audit: compiled.audit };
  }
  if (!compiled.context) return { prompt, audit: compiled.audit };
  return { prompt: `${prompt}\n\n${compiled.context}\n\n${guard}`.trim(), audit: compiled.audit };
}

module.exports = {
  bundledRoot, userRoot, normalizeRelativePath, validatePackageFiles, parsePackage,
  packageFromZip, packageFromUploads, loadSkills, listSkills, setSkillEnabled,
  importSkill, deleteSkill, removeProjectSkillReferences, previewSkill, projectSkillIds,
  compileSkillContext, insertSkillMarkerBeforeOutput, enhanceSystemPrompt, SKILL_INSERT_MARKER,
};
