// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sqlPath = new URL("./backfill-official-echo-reads.sql", import.meta.url);

function source(): string {
  return readFileSync(sqlPath, "utf8");
}

describe("official echo read backfill", () => {
  it("defaults to a read-only preview and requires explicit apply=1", () => {
    const sql = source();

    expect(sql).toContain("\\set apply 0");
    expect(sql).toContain("\\if :apply");
    expect(sql).toContain("official_echo_read_candidates");
    expect(sql).toContain("applied_count");
  });

  it("requires processed messageEcho evidence for actorless provider messages", () => {
    const sql = source();

    expect(sql).toContain("m.direction = 'OUTBOUND'");
    expect(sql).toContain("m.sent_by_user_id IS NULL");
    expect(sql).toContain("m.client_request_id IS NULL");
    expect(sql).toContain("m.whatsapp_message_id IS NOT NULL");
    expect(sql).toContain("we.event_type = 'messageEcho'");
    expect(sql).toContain("we.status = 'PROCESSED'");
    expect(sql).toContain("'message-echo:' || m.whatsapp_message_id");
  });

  it("selects the latest preceding inbound with the shared boundary ordering", () => {
    const sql = source();

    expect(sql).toContain("JOIN LATERAL");
    expect(sql).toContain("i.direction = 'INBOUND'");
    expect(sql).toContain("i.external_timestamp < o.external_timestamp");
    expect(sql).toContain("i.id < o.id");
    expect(sql).toContain("ORDER BY i.external_timestamp DESC, i.id DESC");
  });

  it("updates only the team read columns and emits no customer content", () => {
    const sql = source();
    const update = sql.match(
      /UPDATE conversations AS c[\s\S]*?RETURNING c\.id/,
    )?.[0];

    expect(update).toBeDefined();
    expect(update).toContain("team_last_read_message_id");
    expect(update).toContain("team_last_read_at");
    expect(update).not.toMatch(/manual_unread|awaiting_response|responsible_user/);
    expect(sql).not.toContain("m.body");
    expect(sql).not.toMatch(/contacts|\.phone/);
    expect(sql).toContain("SELECT count(*) AS candidate_count");
  });
});
