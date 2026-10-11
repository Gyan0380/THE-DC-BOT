const DEFAULT_RULES = [
  { id: "3", title: "Respect the community", description: "Do not harass, threaten, or target members.", points: 2, enabled: true },
  { id: "3.1", title: "No targeted harassment", description: "Repeated or targeted insults may be reviewed by moderators.", points: 3, enabled: true },
  { id: "3.2", title: "No unsolicited promotion", description: "Promote only in designated promotion channels.", points: 2, enabled: true },
  { id: "4", title: "No spam or floods", description: "Avoid repeated messages, disruptive mentions, or link floods.", points: 2, enabled: true }
];
module.exports = { DEFAULT_RULES };
