CREATE INDEX "messages_response_state_idx"
ON "messages"("conversation_id", "direction", "external_timestamp", "id");
