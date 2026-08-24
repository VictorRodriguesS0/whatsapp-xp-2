CREATE TYPE "WhatsAppPolicyMode" AS ENUM ('INACTIVE', 'ACTIVE');
CREATE TYPE "WhatsAppTemplateFunction" AS ENUM ('SERVICE_RESUMPTION');
CREATE TYPE "WhatsAppTemplateSyncStatus" AS ENUM ('NEVER', 'SUCCEEDED', 'FAILED');
CREATE TYPE "OutboundPayloadKind" AS ENUM ('FREE_FORM', 'TEMPLATE');
CREATE TYPE "ConversationResumptionStatus" AS ENUM (
  'RESERVED',
  'SEND_IN_FLIGHT',
  'SENT',
  'FAILED',
  'OUTCOME_UNKNOWN'
);
CREATE TYPE "ContactMessagingRestrictionAction" AS ENUM ('OPT_OUT', 'OPT_IN');

ALTER TABLE contacts
  ADD COLUMN messaging_opt_out_at TIMESTAMPTZ(3),
  ADD COLUMN messaging_restriction_reason TEXT,
  ADD COLUMN messaging_restricted_by_user_id UUID;

ALTER TABLE conversations
  ADD COLUMN last_customer_message_at TIMESTAMPTZ(3),
  ADD COLUMN last_customer_message_id UUID,
  ADD COLUMN pending_customer_message_at TIMESTAMPTZ(3),
  ADD COLUMN pending_customer_message_id UUID,
  ADD COLUMN awaiting_customer_since TIMESTAMPTZ(3),
  ADD COLUMN service_window_state_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE messages
  ADD COLUMN outbound_payload_kind "OutboundPayloadKind" NOT NULL DEFAULT 'FREE_FORM',
  ADD COLUMN template_name TEXT,
  ADD COLUMN template_language TEXT,
  ADD COLUMN template_components JSONB,
  ADD COLUMN template_definition_hash TEXT;

CREATE TABLE whatsapp_policy_configuration (
  id INTEGER PRIMARY KEY,
  mode "WhatsAppPolicyMode" NOT NULL DEFAULT 'INACTIVE',
  version INTEGER NOT NULL DEFAULT 0,
  last_template_sync_status "WhatsAppTemplateSyncStatus" NOT NULL DEFAULT 'NEVER',
  last_template_sync_at TIMESTAMPTZ(3),
  last_template_sync_succeeded_at TIMESTAMPTZ(3),
  last_template_sync_failure_code TEXT,
  activated_at TIMESTAMPTZ(3),
  activated_by_user_id UUID,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT whatsapp_policy_configuration_singleton_check CHECK (id = 1),
  CONSTRAINT whatsapp_policy_configuration_version_check CHECK (version >= 0),
  CONSTRAINT whatsapp_policy_configuration_sync_code_check CHECK (
    last_template_sync_failure_code IS NULL
    OR char_length(last_template_sync_failure_code) BETWEEN 1 AND 120
  ),
  CONSTRAINT whatsapp_policy_configuration_sync_state_check CHECK (
    (last_template_sync_status = 'NEVER'
      AND last_template_sync_at IS NULL
      AND last_template_sync_succeeded_at IS NULL
      AND last_template_sync_failure_code IS NULL)
    OR (last_template_sync_status = 'SUCCEEDED'
      AND last_template_sync_at IS NOT NULL
      AND last_template_sync_succeeded_at IS NOT NULL
      AND last_template_sync_failure_code IS NULL)
    OR (last_template_sync_status = 'FAILED'
      AND last_template_sync_at IS NOT NULL
      AND last_template_sync_failure_code IS NOT NULL)
  ),
  CONSTRAINT whatsapp_policy_configuration_activation_check CHECK (
    mode <> 'ACTIVE' OR activated_at IS NOT NULL
  )
);

CREATE TABLE whatsapp_templates (
  id UUID PRIMARY KEY,
  meta_id TEXT,
  name TEXT NOT NULL,
  language TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  quality_score TEXT,
  components JSONB NOT NULL,
  body_text TEXT NOT NULL,
  parameter_count INTEGER NOT NULL,
  supported BOOLEAN NOT NULL,
  definition_hash TEXT NOT NULL,
  synced_at TIMESTAMPTZ(3) NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT whatsapp_templates_name_check CHECK (char_length(name) BETWEEN 1 AND 512),
  CONSTRAINT whatsapp_templates_language_check CHECK (char_length(language) BETWEEN 1 AND 32),
  CONSTRAINT whatsapp_templates_category_check CHECK (char_length(category) BETWEEN 1 AND 64),
  CONSTRAINT whatsapp_templates_status_check CHECK (char_length(status) BETWEEN 1 AND 64),
  CONSTRAINT whatsapp_templates_body_check CHECK (char_length(body_text) BETWEEN 1 AND 4096),
  CONSTRAINT whatsapp_templates_parameter_count_check CHECK (parameter_count BETWEEN 0 AND 32),
  CONSTRAINT whatsapp_templates_definition_hash_check CHECK (definition_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE whatsapp_template_assignments (
  function "WhatsAppTemplateFunction" PRIMARY KEY,
  template_id UUID NOT NULL,
  assigned_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE conversation_resumptions (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL,
  source_message_id UUID NOT NULL,
  template_id UUID NOT NULL,
  message_id UUID,
  sent_by_user_id UUID NOT NULL,
  client_request_id UUID NOT NULL,
  status "ConversationResumptionStatus" NOT NULL,
  rendered_body TEXT NOT NULL,
  template_name TEXT NOT NULL,
  template_language TEXT NOT NULL,
  definition_hash TEXT NOT NULL,
  parameters JSONB NOT NULL,
  provider_message_id TEXT,
  provider_attempted_at TIMESTAMPTZ(3),
  reservation_until TIMESTAMPTZ(3),
  failure_reason TEXT,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT conversation_resumptions_rendered_body_check CHECK (char_length(rendered_body) BETWEEN 1 AND 4096),
  CONSTRAINT conversation_resumptions_template_name_check CHECK (char_length(template_name) BETWEEN 1 AND 512),
  CONSTRAINT conversation_resumptions_template_language_check CHECK (char_length(template_language) BETWEEN 1 AND 32),
  CONSTRAINT conversation_resumptions_definition_hash_check CHECK (definition_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT conversation_resumptions_failure_reason_check CHECK (
    failure_reason IS NULL OR char_length(failure_reason) BETWEEN 1 AND 240
  )
);

CREATE TABLE contact_messaging_restriction_events (
  id UUID PRIMARY KEY,
  contact_id UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  action "ContactMessagingRestrictionAction" NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT contact_messaging_restriction_events_reason_check CHECK (
    char_length(reason) BETWEEN 3 AND 240
  )
);

CREATE UNIQUE INDEX whatsapp_templates_meta_id_key
  ON whatsapp_templates (meta_id);
CREATE UNIQUE INDEX whatsapp_templates_name_language_key
  ON whatsapp_templates (name, language);
CREATE INDEX whatsapp_templates_status_supported_language_idx
  ON whatsapp_templates (status, supported, language);
CREATE UNIQUE INDEX whatsapp_template_assignments_template_id_key
  ON whatsapp_template_assignments (template_id);
CREATE UNIQUE INDEX conversation_resumptions_message_id_key
  ON conversation_resumptions (message_id);
CREATE UNIQUE INDEX conversation_resumptions_client_request_id_key
  ON conversation_resumptions (client_request_id);
CREATE INDEX conversation_resumptions_conversation_id_source_message_id_status_idx
  ON conversation_resumptions (conversation_id, source_message_id, status);
CREATE UNIQUE INDEX conversation_resumptions_active_source_idx
  ON conversation_resumptions (source_message_id)
  WHERE status IN ('RESERVED', 'SEND_IN_FLIGHT', 'OUTCOME_UNKNOWN', 'SENT');
CREATE INDEX contact_messaging_restriction_events_contact_id_created_at_idx
  ON contact_messaging_restriction_events (contact_id, created_at);
CREATE INDEX conversations_last_customer_message_at_idx
  ON conversations (last_customer_message_at);
CREATE INDEX conversations_pending_customer_message_at_idx
  ON conversations (pending_customer_message_at);

WITH ranked_inbound AS (
  SELECT
    id,
    conversation_id,
    external_timestamp,
    ROW_NUMBER() OVER (
      PARTITION BY conversation_id
      ORDER BY external_timestamp DESC, id DESC
    ) AS row_number
  FROM messages
  WHERE direction = 'INBOUND'
)
UPDATE conversations AS conversation
SET
  last_customer_message_at = inbound.external_timestamp,
  last_customer_message_id = inbound.id
FROM ranked_inbound AS inbound
WHERE inbound.row_number = 1
  AND conversation.id = inbound.conversation_id;

INSERT INTO whatsapp_policy_configuration (
  id, mode, version, last_template_sync_status, updated_at
) VALUES (1, 'INACTIVE', 0, 'NEVER', CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE contacts
  ADD CONSTRAINT contacts_messaging_restriction_state_check CHECK (
    (messaging_opt_out_at IS NULL
      AND messaging_restriction_reason IS NULL
      AND messaging_restricted_by_user_id IS NULL)
    OR (messaging_opt_out_at IS NOT NULL
      AND char_length(messaging_restriction_reason) BETWEEN 3 AND 240
      AND messaging_restricted_by_user_id IS NOT NULL)
  ),
  ADD CONSTRAINT contacts_messaging_restricted_by_user_id_fkey
    FOREIGN KEY (messaging_restricted_by_user_id) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_service_window_state_version_check
    CHECK (service_window_state_version >= 0),
  ADD CONSTRAINT conversations_last_customer_message_id_fkey
    FOREIGN KEY (last_customer_message_id) REFERENCES messages(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT conversations_pending_customer_message_id_fkey
    FOREIGN KEY (pending_customer_message_id) REFERENCES messages(id)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE messages
  ADD CONSTRAINT messages_template_payload_check CHECK (
    (outbound_payload_kind = 'FREE_FORM'
      AND template_name IS NULL
      AND template_language IS NULL
      AND template_components IS NULL
      AND template_definition_hash IS NULL)
    OR (outbound_payload_kind = 'TEMPLATE'
      AND char_length(template_name) BETWEEN 1 AND 512
      AND char_length(template_language) BETWEEN 1 AND 32
      AND template_components IS NOT NULL
      AND template_definition_hash ~ '^[0-9a-f]{64}$')
  );

ALTER TABLE whatsapp_policy_configuration
  ADD CONSTRAINT whatsapp_policy_configuration_activated_by_user_id_fkey
    FOREIGN KEY (activated_by_user_id) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE whatsapp_template_assignments
  ADD CONSTRAINT whatsapp_template_assignments_template_id_fkey
    FOREIGN KEY (template_id) REFERENCES whatsapp_templates(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT whatsapp_template_assignments_assigned_by_user_id_fkey
    FOREIGN KEY (assigned_by_user_id) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE conversation_resumptions
  ADD CONSTRAINT conversation_resumptions_conversation_id_fkey
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT conversation_resumptions_source_message_id_fkey
    FOREIGN KEY (source_message_id) REFERENCES messages(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT conversation_resumptions_template_id_fkey
    FOREIGN KEY (template_id) REFERENCES whatsapp_templates(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT conversation_resumptions_message_id_fkey
    FOREIGN KEY (message_id) REFERENCES messages(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT conversation_resumptions_sent_by_user_id_fkey
    FOREIGN KEY (sent_by_user_id) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE contact_messaging_restriction_events
  ADD CONSTRAINT contact_messaging_restriction_events_contact_id_fkey
    FOREIGN KEY (contact_id) REFERENCES contacts(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT contact_messaging_restriction_events_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE CASCADE;
