import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDiscordFlagMessage, hermesMention } from "./discord-flag.ts";

describe("Discord Hermes flag message", () => {
  it("mentions Hermes by name when no bot id is configured", () => {
    const m = hermesMention(undefined);
    assert.equal(m.text, "@Hermes");
    assert.equal(m.user_id, undefined);
    const msg = buildDiscordFlagMessage({ kind: "pulse_stale", price: 1 }, "not-an-id");
    assert.match(msg.content, /@Hermes/);
    assert.equal(msg.content.includes("<@"), false);
    assert.deepEqual(msg.allowed_mentions, { parse: [] });
    assert.equal(msg instanceof Promise, false);
  });

  it("uses a bot mention when a snowflake id is configured", () => {
    const id = "123456789012345678";
    const msg = buildDiscordFlagMessage({ kind: "book_pulse:book_mark_low", book_mark_usd: 110 }, id);
    assert.match(msg.content, new RegExp(`<@${id}> Hermes`));
    assert.deepEqual(msg.allowed_mentions, { parse: [], users: [id] });
    assert.match(msg.content, /Observe-only/);
    assert.match(msg.content, /Not an order/);
    assert.match(msg.content, /"book_mark_usd":110/);
    assert.equal(msg.file_body, undefined);
  });

  it("keeps the full flag on the same message when JSON exceeds the content cap", () => {
    const flag = { kind: "pulse_stale", note: "x".repeat(2100), observe_only: true };
    const msg = buildDiscordFlagMessage(flag, undefined);
    assert.match(msg.content, /@Hermes/);
    assert.ok(msg.content.length <= 2000);
    assert.equal(msg.file_body, JSON.stringify(flag));
    assert.equal(msg.content.includes(flag.note), false);
  });
});
