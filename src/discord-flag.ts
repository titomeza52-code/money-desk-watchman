/**
 * Observe-only Discord message for a Watchman flag.
 * Mentions Hermes so the gateway can accept it. No score, no wait, no order.
 * The webhook URL is not read here and must not be committed.
 */

export const DISCORD_CONTENT_LIMIT = 2000;

const SNOWFLAKE = /^\d{17,20}$/;

export type DiscordAllowedMentions = {
  parse: [];
  users?: string[];
};

export type DiscordFlagMessage = {
  content: string;
  allowed_mentions: DiscordAllowedMentions;
  /** Full flag JSON when it does not fit in content. Same message. */
  file_body?: string;
};

export function hermesMention(userId: string | undefined): { text: string; user_id?: string } {
  const id = typeof userId === "string" ? userId.trim() : "";
  if (SNOWFLAKE.test(id)) {
    return { text: `<@${id}> Hermes`, user_id: id };
  }
  return { text: "@Hermes" };
}

/** Synchronous. Puts the flag JSON in the message. Does not score or fetch. */
export function buildDiscordFlagMessage(
  flag: Record<string, unknown>,
  hermesUserId?: string
): DiscordFlagMessage {
  const mention = hermesMention(hermesUserId);
  const allowed_mentions: DiscordAllowedMentions = mention.user_id
    ? { parse: [], users: [mention.user_id] }
    : { parse: [] };
  const header = `${mention.text} Watchman flag. Observe-only. Not an order.`;
  const json = JSON.stringify(flag);
  const fenced = `${header}\n\`\`\`json\n${json}\n\`\`\``;
  if (fenced.length <= DISCORD_CONTENT_LIMIT) {
    return { content: fenced, allowed_mentions };
  }
  const short = `${header}\nflag.json attached (full computed flag).`;
  return {
    content: short.length <= DISCORD_CONTENT_LIMIT ? short : header.slice(0, DISCORD_CONTENT_LIMIT),
    allowed_mentions,
    file_body: json,
  };
}
