const test = require("node:test");
const assert = require("node:assert/strict");
const { inspectMessage } = require("../src/moderation");

function message({ content, userId, stickers = 0, attachments = 0 }) {
  return {
    guildId: "test-guild",
    channelId: "test-channel",
    author: { id: userId, tag: userId, bot: false },
    content,
    channel: { name: "general", parent: null },
    mentions: { users: { size: 0 }, roles: { size: 0 } },
    attachments: { size: attachments },
    stickers: { size: stickers }
  };
}

test("configurable blacklist phrases are detected", () => {
  const finding = inspectMessage(
    message({ content: "please do not post this bad phrase", userId: "blacklist-user" }),
    [{ id: "blacklist", title: "Blacklisted phrases", description: "" }],
    {},
    { "Blacklisted phrases": { kind: "blacklist", blacklistTerms: ["bad phrase"], allChannels: true } }
  );
  assert.equal(finding.status, "review");
  assert.equal(finding.ruleId, "blacklist");
  assert.match(finding.reason, /bad phrase/);
});

test("sticker spam policy counts stickers in the configured window", () => {
  const finding = inspectMessage(
    message({ content: "sticker drop", userId: "sticker-user", stickers: 2 }),
    [{ id: "stickers", title: "Sticker spam", description: "" }],
    {},
    { "Sticker spam": { kind: "sticker_spam", limit: 2, windowSeconds: 10, allChannels: true } }
  );
  assert.equal(finding.status, "review");
  assert.equal(finding.ruleId, "stickers");
  assert.match(finding.reason, /2 stickers/);
});

test("blacklist rules respect excluded channels", () => {
  const finding = inspectMessage(
    message({ content: "bad phrase", userId: "excluded-user" }),
    [{ id: "blacklist", title: "Blacklisted phrases", description: "" }],
    {},
    { "Blacklisted phrases": { kind: "blacklist", blacklistTerms: ["bad phrase"], allChannels: true, excludedChannelIds: ["test-channel"] } }
  );
  assert.equal(finding.status, "clear");
});
