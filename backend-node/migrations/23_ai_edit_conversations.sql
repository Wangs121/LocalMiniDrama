CREATE TABLE IF NOT EXISTS ai_edit_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('character', 'scene', 'prop', 'storyboard')),
  entity_id INTEGER NOT NULL,
  drama_id INTEGER NOT NULL,
  episode_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS ai_edit_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  reply_to_message_id INTEGER,
  client_request_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL DEFAULT '',
  base_snapshot_hash TEXT,
  candidate_json TEXT,
  diff_json TEXT,
  proposal_status TEXT,
  selected_fields_json TEXT,
  request_status TEXT NOT NULL DEFAULT 'completed' CHECK (request_status IN ('pending', 'completed', 'failed')),
  error_code TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES ai_edit_conversations(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_edit_message_request
  ON ai_edit_messages (conversation_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_edit_messages_conversation
  ON ai_edit_messages (conversation_id, id);

ALTER TABLE scenes ADD COLUMN polished_prompt_single TEXT;
ALTER TABLE characters ADD COLUMN image_stale INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scenes ADD COLUMN image_stale INTEGER NOT NULL DEFAULT 0;
ALTER TABLE props ADD COLUMN image_stale INTEGER NOT NULL DEFAULT 0;
ALTER TABLE storyboards ADD COLUMN image_stale INTEGER NOT NULL DEFAULT 0;
ALTER TABLE storyboards ADD COLUMN video_stale INTEGER NOT NULL DEFAULT 0;
