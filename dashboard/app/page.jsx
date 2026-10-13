"use client";

import { useEffect, useMemo, useState } from "react";

const sections = ["Overview", "Welcome & Goodbye", "Rules", "AutoMod", "Moderation", "Giveaways", "Chat Health", "Logs", "Settings"];

export default function Home() {
  const [user, setUser] = useState(null);
  const [guilds, setGuilds] = useState([]);
  const [guildId, setGuildId] = useState("");
  const [active, setActive] = useState("Overview");
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState({ firebase: "checking", bot: "unknown" });
  const [channels, setChannels] = useState([]);
  const [channelError, setChannelError] = useState("");
  const [moderationForm, setModerationForm] = useState({ action: "timeout", userId: "", minutes: 10, durationHours: "", reason: "" });
  const [pointsForm, setPointsForm] = useState({ userId: "", amount: 1, reason: "" });
  const [pointsBusy, setPointsBusy] = useState(false);
  const [settings, setSettings] = useState({ welcome: { enabled: false, channelId: "", message: "Welcome {user} to {server}!" }, goodbye: { enabled: false, channelId: "", message: "Goodbye {user}!" }, rules: [], automod: { enabled: false, autoTimeoutMinutes: 0 }, spamDetection: { messages: 5, windowSeconds: 6, repeats: 4, repeatWindowSeconds: 15 }, moderation: {}, giveaways: {}, logs: {} });
  const [rulesText, setRulesText] = useState("");
  const [ruleSearch, setRuleSearch] = useState("");
  const [rulePolicies, setRulePolicies] = useState({});
  const [aiInfo, setAiInfo] = useState({ configured: false, enabled: false, provider: "", keyOwnerId: "" });
  const [aiProvider, setAiProvider] = useState("gemini");
  const [aiKey, setAiKey] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [modLogs, setModLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState("");
  const [logFilter, setLogFilter] = useState("all");
  const [giveawayForm, setGiveawayForm] = useState({ channelId: "", prize: "", durationMinutes: 60 });
  const [giveaways, setGiveaways] = useState([]);
  const [giveawayBusy, setGiveawayBusy] = useState(false);
  const [chatHealth, setChatHealth] = useState({ date: null, users: [] });
  const [chatHealthBusy, setChatHealthBusy] = useState(false);

  const guild = guilds.find(g => g.id === guildId) || null;
  const canSave = Boolean(user && guild && !busy);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("authError")) setError(params.get("authError") || "Discord login failed.");
    Promise.all([
      fetch("/api/auth/session", { cache: "no-store" }).then(r => r.json()),
      fetch("/api/health", { cache: "no-store" }).then(r => r.json()).catch(() => ({ firebase: "unknown", bot: "unknown" }))
    ]).then(([session, status]) => {
      setHealth(status);
      if (session.authenticated) {
        setUser(session.user);
        setGuilds(session.guilds || []);
        if (session.guilds?.length) setGuildId(session.guilds[0].id);
      }
    }).catch(() => setError("Could not load dashboard. Please refresh and try again."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!guildId || !user) return;
    let cancelled = false;
    fetch("/api/settings?guildId=" + encodeURIComponent(guildId), { cache: "no-store" })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "Could not load settings."); return d; })
      .then(d => {
        if (cancelled) return;
        const s = d.settings || {};
        setSettings({
          welcome: { enabled: Boolean(s.welcome?.enabled), channelId: s.welcome?.channelId || "", message: s.welcome?.message || "Welcome {user} to {server}!" },
          goodbye: { enabled: Boolean(s.goodbye?.enabled), channelId: s.goodbye?.channelId || "", message: s.goodbye?.message || "Goodbye {user}!" },
          rules: Array.isArray(s.rules) ? s.rules : [],
          rulePolicies: s.rulePolicies && typeof s.rulePolicies === "object" ? s.rulePolicies : {},
          ai: s.ai || {},
          automod: { enabled: Boolean(s.automod?.enabled), autoTimeoutMinutes: Number(s.automod?.autoTimeoutMinutes || 0) },
          spamDetection: { messages: Number(s.spamDetection?.messages || 5), windowSeconds: Number(s.spamDetection?.windowSeconds || 6), repeats: Number(s.spamDetection?.repeats || 4), repeatWindowSeconds: Number(s.spamDetection?.repeatWindowSeconds || 15) },
          moderation: s.moderation || {}, giveaways: s.giveaways || {}, logs: s.logs || {}
        });
        setRulesText((s.rules || []).map(r => typeof r === "string" ? r : r.title ? r.title + (r.description ? ": " + r.description : "") : JSON.stringify(r)).join("\n"));
      })
      .catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [guildId, user]);

  useEffect(() => {
    if (!guildId || !user) return;
    let cancelled = false;
    fetch("/api/ai?guildId=" + encodeURIComponent(guildId), { cache: "no-store" }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "Could not load AI settings."); return d; }).then(d => { if (!cancelled) { setAiInfo(d); setAiProvider(d.provider || "gemini"); setAiKey(""); } }).catch(() => { if (!cancelled) setAiInfo({ configured: false, enabled: false, provider: "", keyOwnerId: "" }); });
    return () => { cancelled = true; };
  }, [guildId, user]);

  useEffect(() => {
    if (!guildId || !user) { setChannels([]); return; }
    let cancelled = false;
    fetch("/api/channels?guildId=" + encodeURIComponent(guildId), { cache: "no-store" })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "Could not load channels."); return d; })
      .then(d => { if (!cancelled) { setChannels(d.channels || []); setChannelError(""); } })
      .catch(e => { if (!cancelled) { setChannels([]); setChannelError(e.message); } });
    return () => { cancelled = true; };
  }, [guildId, user]);

  useEffect(() => {
    if (!guildId || !user || active !== "Logs") return;
    let cancelled = false;
    setLogsLoading(true); setLogsError("");
    fetch("/api/logs?guildId=" + encodeURIComponent(guildId), { cache: "no-store" })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "Could not load logs."); return d; })
      .then(d => { if (!cancelled) setModLogs(d.logs || []); })
      .catch(e => { if (!cancelled) setLogsError(e.message || "Could not load logs."); })
      .finally(() => { if (!cancelled) setLogsLoading(false); });
    return () => { cancelled = true; };
  }, [guildId, user, active]);

  async function runModeration() {
    if (!guildId || busy) return;
    setBusy(true); setNotice(""); setError("");
    try {
      const r = await fetch("/api/moderation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ guildId, ...moderationForm }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Moderation action failed.");
      setNotice(d.message || "Moderation action completed.");
    } catch (e) { setError(e.message || "Moderation action failed."); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!canSave) return;
    setBusy(true); setNotice(""); setError("");
    const next = { ...settings, rules: rulesText.split("\n").map(s => s.trim()).filter(Boolean), rulePolicies };
    try {
      const r = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ guildId, settings: next }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Save failed.");
      setSettings(next);
      setNotice("Settings saved to Firebase for this server. Bot behavior only changes where the bot has a matching live handler.");
    } catch (e) { setError(e.message || "Could not save settings."); }
    finally { setBusy(false); }
  }

  async function addPoints() {
    if (!guildId || !pointsForm.userId.trim() || !pointsForm.reason.trim() || pointsBusy) return;
    setPointsBusy(true); setNotice(""); setError("");
    try {
      const r = await fetch("/api/points", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ guildId, ...pointsForm }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Could not add points.");
      setNotice("Added " + pointsForm.amount + " moderation point(s). New total: " + d.total + ".");
      setPointsForm(p => ({ ...p, reason: "" }));
    } catch (e) { setError(e.message || "Could not add points."); } finally { setPointsBusy(false); }
  }

  async function createGiveaway() {
    if (!guildId || !giveawayForm.channelId || !giveawayForm.prize.trim() || giveawayBusy) return;
    setGiveawayBusy(true); setNotice(""); setError("");
    try {
      const r = await fetch("/api/giveaways", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ guildId, ...giveawayForm }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Could not create giveaway.");
      setNotice("Giveaway created and posted. ID: " + d.id); setGiveawayForm(p => ({ ...p, prize: "" })); await loadGiveaways();
    } catch (e) { setError(e.message || "Could not create giveaway."); } finally { setGiveawayBusy(false); }
  }
  async function loadGiveaways() {
    if (!guildId || !user) return;
    const r = await fetch("/api/giveaways?guildId=" + encodeURIComponent(guildId), { cache: "no-store" });
    const d = await r.json(); if (!r.ok) throw new Error(d.error || "Could not load giveaways."); setGiveaways(d.giveaways || []);
  }
  async function loadChatHealth() {
    if (!guildId || !user) return; setChatHealthBusy(true);
    try { const r = await fetch("/api/chat-health?guildId=" + encodeURIComponent(guildId), { cache: "no-store" }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "Could not load Chat Health."); setChatHealth(d); }
    catch (e) { setError(e.message || "Could not load Chat Health."); } finally { setChatHealthBusy(false); }
  }

  async function saveAiKey() {
    if (!guildId || !aiKey.trim() || aiBusy) return;
    setAiBusy(true); setNotice(""); setError("");
    try { const r = await fetch("/api/ai", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ guildId, provider: aiProvider, apiKey: aiKey.trim() }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "Could not configure AI."); setAiInfo({ configured: true, enabled: true, provider: aiProvider, keyOwnerId: user?.id || "" }); setAiKey(""); setNotice("AI key authenticated and encrypted for " + guild?.name + ". " + d.message); }
    catch (e) { setError(e.message || "Could not configure AI."); } finally { setAiBusy(false); }
  }
  async function removeAiKey() {
    if (!guildId || aiBusy || !window.confirm("Remove this server’s saved AI key?")) return;
    setAiBusy(true); setNotice(""); setError("");
    try { const r = await fetch("/api/ai?guildId=" + encodeURIComponent(guildId), { method: "DELETE" }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "Could not remove AI configuration."); setAiInfo({ configured: false, enabled: false, provider: "", keyOwnerId: "" }); setAiKey(""); setNotice("AI configuration removed for this server."); }
    catch (e) { setError(e.message || "Could not remove AI configuration."); } finally { setAiBusy(false); }
  }

  useEffect(() => {
    if (!guildId || !user) return;
    if (active === "Giveaways") loadGiveaways().catch(e => setError(e.message));
    if (active === "Chat Health") loadChatHealth();
  }, [guildId, user, active]);

  async function logout() {
    await fetch("/api/auth/session", { method: "DELETE" });
    window.location.href = "/";
  }

  const initials = useMemo(() => (user?.username || "DC").slice(0, 2).toUpperCase(), [user]);

  return <main className="appShell">
    <aside className="sidebar">
      <div className="brand"><span className="brandMark">DC</span><span><b>THE DC BOT</b><small>COMMUNITY CONTROL</small></span></div>
      <label className="label" htmlFor="server">YOUR SERVERS</label>
      {user && <select id="server" value={guildId} onChange={e => { setGuildId(e.target.value); setNotice(""); setError(""); }}><option value="">Select a server</option>{guilds.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>}
      <div className="label navTitle">DASHBOARD</div>
      <nav>{sections.map((s, i) => <button key={s} className={active === s ? "navItem active" : "navItem"} onClick={() => setActive(s)}><span>{["⌂","✦","☷","◇","⚑","✳","◷","≡","⚙"][i]}</span>{s}</button>)}</nav>
      <div className="profile"><span className="avatar">{initials}</span><span><b>{user?.username || "Not signed in"}</b><small>{user ? "Discord account connected" : "Sign in to continue"}</small></span></div>
    </aside>
    <section className="main">
      <header className="topbar"><span>Servers <i>/</i> <b>{guild?.name || "Select a server"}</b></span><span className="statusTag"><i/> LIVE DATA ONLY</span></header>
      <div className="content">
        <div className="heading"><div><p className="eyebrow">COMMUNITY CONTROL CENTER</p><h1>{active}</h1><p className="muted">{guild ? "Configure " + guild.name + " from one dashboard." : "Sign in with Discord and select a server you manage."}</p></div>
          {!user ? <a className="primary" href="/api/auth/discord">Login with Discord</a> : <button className="secondary" onClick={logout}>Log out</button>}
        </div>
        {loading && <div className="notice">Checking your Discord session and service status…</div>}
        {error && <div className="notice error"><b>Something needs attention</b><p>{error}</p><button className="secondary" onClick={() => { setError(""); window.location.href = "/"; }}>Clear error</button></div>}
        {notice && <div className="notice success">{notice}</div>}
        {!loading && !user && <section className="panel"><h2>Connect your Discord account</h2><p className="muted">Sign in to list servers where your account has Manage Server permission. No sample servers or fabricated statistics are shown.</p><a className="primary" href="/api/auth/discord">Continue with Discord</a></section>}
        {!loading && user && !guild && <section className="panel"><h2>No manageable servers found</h2><p className="muted">Your Discord account did not return a server where you have Manage Server permission. Confirm the account and OAuth configuration.</p></section>}
        {user && guild && active === "Overview" && <>
          <div className="stats">
            <article className="stat"><small>DISCORD ACCOUNT</small><strong className="good">Connected</strong><span>{user.username}</span></article>
            <article className="stat"><small>SELECTED SERVER</small><strong>{guild.name}</strong><span>{guild.owner ? "You own this server" : "Manage Server permission returned by Discord"}</span></article>
            <article className="stat"><small>FIREBASE</small><strong className={health.firebase === "connected" ? "good" : "warn"}>{health.firebase === "connected" ? "Connected" : health.firebase === "not_configured" ? "Not configured" : "Unverified"}</strong><span>Live connection check</span></article>
            <article className="stat"><small>BOT CONNECTION</small><strong className="warn">{health.bot === "online" ? "Online" : "Not verified"}</strong><span>{health.bot === "online" ? "Heartbeat received" : "No live bot heartbeat configured"}</span></article>
          </div>
          <section className="panel"><div className="panelHeading"><div><h2>Server modules</h2><p className="muted">Open a section to edit and save its configuration.</p></div></div><div className="moduleGrid">{sections.slice(1,7).map(s => <button key={s} className="module" onClick={() => setActive(s)}><b>{s}</b><span>Open settings ↗</span></button>)}</div></section>
          <section className="panel"><h2>Connected features</h2><p className="muted">Welcome/goodbye, server rules, supported spam checks, moderation, persistent giveaways, member profiles, private parties, community missions, Q&A recaps, and Chat Health use the bot and Firestore. Some advanced per-rule detector types still need live enforcement handlers; configure and test in a private server before relying on them.</p></section>
        </>}
        {user && guild && active !== "Overview" && <section className="panel">
          <div className="panelHeading"><div><h2>{active} configuration</h2><p className="muted">Saved to Firebase for <b>{guild.name}</b>. This does not claim that every option is already enforced by the bot.</p></div><span className="tag">SERVER SETTINGS</span></div>
          {active === "Welcome & Goodbye" && <>
            <h3>Welcome messages</h3>
            <label className="toggle"><span><b>Enable welcome message</b><small>Sent when a new member joins.</small></span><input type="checkbox" checked={settings.welcome.enabled} onChange={e => setSettings(p => ({...p, welcome:{...p.welcome, enabled:e.target.checked}}))}/></label>
            <label className="fieldLabel">Welcome channel</label><select value={settings.welcome.channelId} onChange={e => setSettings(p => ({...p, welcome:{...p.welcome, channelId:e.target.value}}))}><option value="">Select #welcome channel</option>{channels.map(ch => <option key={ch.id} value={ch.id}>#{ch.name}</option>)}</select>
            <label className="fieldLabel">Welcome message template</label><textarea rows={3} value={settings.welcome.message} onChange={e => setSettings(p => ({...p, welcome:{...p.welcome, message:e.target.value}}))}/><p className="hint">Placeholders: {"{user}"} and {"{server}"}. Example: Welcome {"{user}"} to {"{server}"}!</p>
            <div className="sectionDivider"></div>
            <h3>Goodbye messages</h3>
            <label className="toggle"><span><b>Enable goodbye message</b><small>Sent when a member leaves the server.</small></span><input type="checkbox" checked={settings.goodbye.enabled} onChange={e => setSettings(p => ({...p, goodbye:{...p.goodbye, enabled:e.target.checked}}))}/></label>
            <label className="fieldLabel">Goodbye channel</label><select value={settings.goodbye.channelId} onChange={e => setSettings(p => ({...p, goodbye:{...p.goodbye, channelId:e.target.value}}))}><option value="">Select #goodbye channel</option>{channels.map(ch => <option key={ch.id} value={ch.id}>#{ch.name}</option>)}</select>
            <label className="fieldLabel">Goodbye message template</label><textarea rows={3} value={settings.goodbye.message} onChange={e => setSettings(p => ({...p, goodbye:{...p.goodbye, message:e.target.value}}))}/><p className="hint">Use {"{user}"} and {"{server}"} placeholders. Save changes to activate them.</p>
            {channelError && <p className="hint">Channel list: {channelError} You can also configure channels with /welcome-setup and /goodbye-setup in Discord.</p>}
          </>}
          {active === "Rules" && <>
            <h3>Rule categories & library</h3>
            <p className="hint">Categories are numbered automatically (1, 2, 3...). Rules inside them use 1.1, 1.2, 2.1 numbering. Select a hashtag category, then add one or more rules. Every rule stores its own thresholds, timeout and channel scope.</p>
            <label className="fieldLabel">Search hashtag library</label>
            <input value={ruleSearch} onChange={e => setRuleSearch(e.target.value)} placeholder="Search #LINKS, #SPAM, #GENERAL..." />
            <div className="moduleGrid" style={{marginTop:12}}>
              {[
                {tag:"#LINKS", title:"Link Spam", desc:"Limit link messages in a time window", kind:"links", points:1, timeout:0, limit:1, window:4},
                {tag:"#LINKS", title:"Unauthorized Links", desc:"Block links in selected channels", kind:"links", points:1, timeout:5, limit:1, window:4},
                {tag:"#LINKS", title:"Suspicious Links", desc:"Review suspicious URLs", kind:"links", points:2, timeout:10, limit:1, window:10},
                {tag:"#SPAM", title:"Rapid Message Spam", desc:"Too many messages inside a short time window", kind:"rapid_spam", points:2, timeout:10, limit:5, window:6},
                {tag:"#SPAM", title:"Repeated Message Spam", desc:"Same or nearly identical message repeated", kind:"repeat_spam", points:2, timeout:10, limit:4, window:15},
                {tag:"#SPAM", title:"Link Spam", desc:"Too many messages containing URLs", kind:"link_spam", points:2, timeout:5, limit:1, window:4},
                {tag:"#SPAM", title:"Mention Spam", desc:"Too many user or role mentions", kind:"mention_spam", points:2, timeout:5, limit:4, window:10},
                {tag:"#SPAM", title:"Emoji Spam", desc:"Excessive emoji in a message or burst", kind:"emoji_spam", points:1, timeout:0, limit:8, window:10},
                {tag:"#SPAM", title:"Attachment Spam", desc:"Too many images or files in a short time", kind:"attachment_spam", points:2, timeout:5, limit:3, window:10},
                {tag:"#SPAM", title:"Invite Link Spam", desc:"Repeated Discord invite links", kind:"invite_spam", points:2, timeout:10, limit:1, window:10},
                {tag:"#SPAM", title:"Character Flood", desc:"Excessively repeated characters", kind:"character_flood", points:1, timeout:0, limit:1, window:4},
                {tag:"#SPAM", title:"Mass Ping Spam", desc:"Mass mentions or everyone/here pings", kind:"mass_ping", points:3, timeout:30, limit:1, window:10},
                {tag:"#SPAM", title:"Sticker Spam", desc:"Too many stickers in a short time", kind:"sticker_spam", points:1, timeout:0, limit:4, window:10},
                {tag:"#ADVERTISEMENT", title:"Unauthorized Advertising", desc:"Promotional content outside allowed channels", kind:"advertising", points:3, timeout:30, limit:1, window:60},
                {tag:"#HARASSMENT", title:"Harassment or Insults", desc:"Send for moderator review", kind:"review", points:2, timeout:0, limit:1, window:60},
                {tag:"#SCAM", title:"Scams or Fake Giveaways", desc:"Send suspicious cases for review", kind:"review", points:3, timeout:30, limit:1, window:60},
                {tag:"#CAPS", title:"Excessive Caps", desc:"All-caps messages", kind:"caps", points:1, timeout:0, limit:1, window:60},
                {tag:"#VOICE", title:"Voice Chat Conduct", desc:"Voice rules are configured separately from text checks", kind:"voice", points:1, timeout:0, limit:1, window:60},
                {tag:"#GENERAL", title:"Respect Members", desc:"General community rule", kind:"review", points:1, timeout:0, limit:1, window:60},
                {tag:"#GENERAL", title:"Follow Server Rules", desc:"General community rule", kind:"review", points:1, timeout:0, limit:1, window:60}
              ].filter(item => !ruleSearch || (item.tag+" "+item.title+" "+item.desc).toLowerCase().includes(ruleSearch.replace(/^#/,"").toLowerCase())).map(item => <div className="module" key={item.tag+item.title}>
                <span>{item.tag}</span><b>{item.title}</b><small className="muted">{item.desc}</small>
                <button className="secondary" type="button" onClick={() => {
                  setRulesText(v => {
                    const lines = v.split("\n").map(x => x.trim()).filter(Boolean);
                    const exists = lines.some(x => !x.startsWith("#") && x.replace(/\s*\(\d+\s+(?:points?|minutes? timeout)\)/gi,"").trim() === item.title);
                    if (exists) return v;
                    if (!lines.includes(item.tag)) lines.push(item.tag);
                    lines.push(item.title+" ("+item.timeout+" minutes timeout) ("+item.points+" points)");
                    return lines.join("\n");
                  });
                  setRulePolicies(p => ({...p,[item.title]:p[item.title]||{category:item.tag,kind:item.kind,allChannels:true,channelIds:[],excludedChannelIds:[],limit:item.limit,windowSeconds:item.window}}));
                }}>+ Add rule</button>
              </div>)}
            </div>
            <div className="sectionDivider"></div>
            <h3>Selected categories & rules</h3>
            <p className="hint">Category tags are headings, not moderation rules. Remove a rule using its own Remove button. Settings are kept per rule.</p>
            {(() => {
              const lines = rulesText.split("\n").map(line => line.trim()).filter(Boolean);
              const groups = [];
              let current = null;
              for (const line of lines) {
                if (line.startsWith("#")) {
                  current = {tag:line.toUpperCase(), rules:[]};
                  groups.push(current);
                } else {
                  if (!current) { current = {tag:"#GENERAL",rules:[]}; groups.push(current); }
                  current.rules.push(line);
                }
              }
              let categoryNumber = 0;
              return groups.map(group => {
                categoryNumber += 1;
                const groupNumber = categoryNumber;
                return <details className="panel" key={group.tag+"-"+groupNumber} open={groupNumber === 1}><summary style={{cursor:"pointer",fontWeight:700,paddingBottom:12}}>{groupNumber}. {group.tag} · {group.rules.length} rule(s)</summary>
                  <div className="panelHeading"><div><b>{groupNumber}. {group.tag}</b><p className="hint">{group.rules.length} rule(s)</p></div><button className="secondary" type="button" onClick={() => setRulesText(v => v.split("\n").filter(x => x.trim().toUpperCase() !== group.tag).join("\n"))}>Remove category</button></div>
                  {group.rules.map((line, index) => {
                    const title = line.replace(/\s*\(\d+\s+(?:points?|minutes? timeout)\)/gi,"").trim();
                    const pointValue = (line.match(/\((\d+)\s+points?\)/i)||[])[1] ?? "0";
                    const timeoutValue = (line.match(/\((\d+)\s+minutes? timeout\)/i)||[])[1] ?? "0";
                    const policy = rulePolicies[title] || {category:group.tag,kind:/spam|rapid|repeated/i.test(title)?"spam":/link|url/i.test(title)?"links":"review",allChannels:true,channelIds:[],excludedChannelIds:[],limit:5,windowSeconds:6};
                    const updateSetting = (kind, raw) => {
                      setRulesText(v => v.split("\n").map(x => {
                        if (x.trim() !== line) return x;
                        const clean = x.replace(/\s*\(\d+\s+(?:points?|minutes? timeout)\)/gi,"").trim();
                        const pts = kind === "points" ? raw : ((x.match(/\((\d+)\s+points?\)/i)||[])[1] ?? "0");
                        const mins = kind === "timeout" ? raw : ((x.match(/\((\d+)\s+minutes? timeout\)/i)||[])[1] ?? "0");
                        return clean+" ("+mins+" minutes timeout) ("+pts+" points)";
                      }).join("\n"));
                    };
                    return <div className="panel" key={title+"-"+groupNumber+"-"+index}>
                      <div className="panelHeading"><div><b>{groupNumber}.{index+1} {title}</b><p className="hint">{group.tag} · {line}</p></div><button className="secondary" type="button" onClick={() => {setRulesText(v=>v.split("\n").filter(x=>x.trim()!==line).join("\n"));setRulePolicies(p=>{const n={...p};delete n[title];return n;});}}>Remove rule</button></div>
                      <label className="fieldLabel">Rule type</label>
                      <select value={policy.kind||"review"} onChange={e=>setRulePolicies(p=>({...p,[title]:{...policy,kind:e.target.value}}))}>
                        <option value="links">Links / URL policy</option><option value="link_spam">Link spam</option><option value="invite_spam">Invite link spam</option><option value="rapid_spam">Rapid message spam</option><option value="repeat_spam">Repeated message spam</option><option value="mention_spam">Mention spam</option><option value="emoji_spam">Emoji spam</option><option value="attachment_spam">Attachment spam</option><option value="character_flood">Character flood</option><option value="mass_ping">Mass ping spam</option><option value="sticker_spam">Sticker spam</option><option value="advertising">Advertising</option><option value="caps">Excessive caps</option><option value="review">Moderator review</option><option value="voice">Voice chat</option>
                      </select>
                      <label className="toggle"><span><b>Apply in all channels</b><small>Turn off to choose exactly where this rule applies.</small></span><input type="checkbox" checked={Boolean(policy.allChannels)} onChange={e=>setRulePolicies(p=>({...p,[title]:{...policy,allChannels:e.target.checked}}))}/></label>
                      {!policy.allChannels && <div className="moduleGrid" style={{marginTop:12}}>
                        {channels.map(ch => <label className="toggle" key={ch.id}><span><b>#{ch.name}</b></span><input type="checkbox" checked={(policy.channelIds||[]).includes(ch.id)} onChange={e=>setRulePolicies(p=>({...p,[title]:{...policy,channelIds:e.target.checked?[...(policy.channelIds||[]),ch.id]:(policy.channelIds||[]).filter(id=>id!==ch.id)}}))}/></label>)}
                        {channels.length===0 && <p className="hint">No channels loaded. Check bot permissions.</p>}
                      </div>}
                      <div className="moduleGrid" style={{marginTop:12}}>
                        <div><label className="fieldLabel">Points (label/metadata)</label><input type="text" inputMode="numeric" value={pointValue} onChange={e=>updateSetting("points",e.target.value.replace(/\D/g,""))}/></div>
                        <div><label className="fieldLabel">Timeout (minutes, 0 = none)</label><input type="text" inputMode="numeric" value={timeoutValue} onChange={e=>updateSetting("timeout",e.target.value.replace(/\D/g,""))}/></div>
                        <div><label className="fieldLabel">Allowed matches</label><input type="number" min="1" max="100" value={policy.limit ?? 1} onChange={e=>setRulePolicies(p=>({...p,[title]:{...policy,limit:Math.max(1,Math.min(100,Number(e.target.value)||1))}}))}/></div>
                        <div><label className="fieldLabel">Time window (seconds)</label><input type="number" min="1" max="3600" value={policy.windowSeconds ?? 4} onChange={e=>setRulePolicies(p=>({...p,[title]:{...policy,windowSeconds:Math.max(1,Math.min(3600,Number(e.target.value)||1))}}))}/></div>
                      </div>
                    </div>;
                  })}
                  <button className="secondary" type="button" onClick={() => {const title=window.prompt("New rule name for "+group.tag+":");if(!title||!title.trim())return;const clean=title.trim();setRulesText(v=>v.split("\n").some(x=>x.replace(/\s*\(\d+\s+(?:points?|minutes? timeout)\)/gi,"").trim()===clean)?v:(v+"\n"+clean+" (0 minutes timeout) (1 points)").trim());setRulePolicies(p=>({...p,[clean]:p[clean]||{category:group.tag,kind:"review",allChannels:true,channelIds:[],excludedChannelIds:[],limit:1,windowSeconds:4}}));}}>+ Add custom rule to {group.tag}</button>
                </details>;
              });
            })()}
            <label className="fieldLabel">Rules text (advanced editor)</label>
            <textarea rows={5} value={rulesText} onChange={e=>setRulesText(e.target.value)} placeholder={"#LINKS\nLink Spam (0 minutes timeout) (1 points)"} />
            <div className="sectionDivider"></div>
            <h3>Default spam detection thresholds</h3>
            <p className="hint">These are global fallbacks. A specific rule's threshold settings above should be used by a matching live detector once supported in the bot.</p>
            <div className="moduleGrid">
              <div><label className="fieldLabel">Messages in burst</label><input type="number" min="2" max="30" value={settings.spamDetection?.messages ?? 5} onChange={e=>setSettings(p=>({...p,spamDetection:{...p.spamDetection,messages:Number(e.target.value)}}))}/></div>
              <div><label className="fieldLabel">Burst window (seconds)</label><input type="number" min="1" max="60" value={settings.spamDetection?.windowSeconds ?? 6} onChange={e=>setSettings(p=>({...p,spamDetection:{...p.spamDetection,windowSeconds:Number(e.target.value)}}))}/></div>
              <div><label className="fieldLabel">Same message repeats</label><input type="number" min="2" max="20" value={settings.spamDetection?.repeats ?? 4} onChange={e=>setSettings(p=>({...p,spamDetection:{...p.spamDetection,repeats:Number(e.target.value)}}))}/></div>
              <div><label className="fieldLabel">Repeat window (seconds)</label><input type="number" min="2" max="120" value={settings.spamDetection?.repeatWindowSeconds ?? 15} onChange={e=>setSettings(p=>({...p,spamDetection:{...p.spamDetection,repeatWindowSeconds:Number(e.target.value)}}))}/></div>
            </div>
          </>}

          {active === "AutoMod" && <>
            <label className="toggle"><span><b>Enable automatic message checks</b><small>Detects suspicious promotion links and message floods.</small></span><input type="checkbox" checked={settings.automod.enabled} onChange={e => setSettings(p => ({...p, automod:{...p.automod, enabled:e.target.checked}}))}/></label>
            <label className="fieldLabel">Automatic timeout duration (minutes)</label><input type="number" min="0" max="40320" value={settings.automod.autoTimeoutMinutes} onChange={e => setSettings(p => ({...p, automod:{...p.automod, autoTimeoutMinutes:Number(e.target.value)}}))}/><p className="hint">Set 0 to only send a rule-review DM without automatically timing out. A positive value enables timeout for the bot's supported detections only. Custom rules written as plain text are displayed in /rules but are not automatically understood as detection logic.</p>
          </>}
          {active === "Moderation" && <>
            <p className="muted">Enter the target member's Discord ID (Developer Mode → right-click member → Copy User ID). Discord bot permissions and role hierarchy still apply.</p>
            <label className="fieldLabel">Action</label><select value={moderationForm.action} onChange={e => setModerationForm(p => ({...p, action:e.target.value}))}><option value="timeout">Timeout</option><option value="untimeout">Remove timeout</option><option value="kick">Kick</option><option value="ban">Ban</option></select>
            <label className="fieldLabel">Member ID</label><input value={moderationForm.userId} onChange={e => setModerationForm(p => ({...p, userId:e.target.value}))} placeholder="Discord user ID"/>
            {moderationForm.action === "timeout" && <><label className="fieldLabel">Duration in minutes (1–40320)</label><input type="number" min="1" max="40320" value={moderationForm.minutes} onChange={e => setModerationForm(p => ({...p, minutes:e.target.value}))}/></>}\n            {moderationForm.action === "ban" && <><label className="fieldLabel">Temporary ban duration in hours (1–8760; leave blank for permanent)</label><input type="number" min="1" max="8760" value={moderationForm.durationHours} onChange={e => setModerationForm(p => ({...p, durationHours:e.target.value}))}/><p className="hint">Leave blank for a permanent ban. Temporary bans are unbanned after the saved absolute expiry time.</p></>}
            <label className="fieldLabel">Reason</label><textarea rows={3} value={moderationForm.reason} onChange={e => setModerationForm(p => ({...p, reason:e.target.value}))} placeholder="Reason for this action"/>
            <div className="actions"><button className="primary" disabled={busy || !moderationForm.userId.trim()} onClick={runModeration}>{busy ? "Working…" : "Run moderation action"}</button></div>
            <p className="hint">Actions are sent to Discord immediately and may not be reversible.</p>
            <div className="sectionDivider"></div><h3>One-click moderation points</h3>
            <p className="hint">Points are stored in Firestore and appear on the member profile. Use this for manual point additions; configured rule violations also add their saved point value automatically.</p>
            <label className="fieldLabel">Member ID</label><input value={pointsForm.userId} onChange={e => setPointsForm(p => ({...p, userId:e.target.value}))} placeholder="Discord user ID"/>
            <label className="fieldLabel">Points to add (1–100)</label><input type="number" min="1" max="100" value={pointsForm.amount} onChange={e => setPointsForm(p => ({...p, amount:Number(e.target.value)}))}/>
            <label className="fieldLabel">Reason</label><textarea rows={2} value={pointsForm.reason} onChange={e => setPointsForm(p => ({...p, reason:e.target.value}))} placeholder="Reason for adding points"/>
            <div className="actions"><button className="primary" disabled={pointsBusy || !pointsForm.userId.trim() || !pointsForm.reason.trim()} onClick={addPoints}>{pointsBusy ? "Saving…" : "Add points now"}</button></div>
          </>}
          {active === "Settings" && <><h3>AI Auto Moderation — Gemini / DeepSeek</h3><p className="muted">Each server manager adds their own provider key here. It is validated on the server, encrypted before Firestore storage, and never displayed again.</p><div className="stat"><small>SERVER AI STATUS</small><strong className={aiInfo.configured && aiInfo.enabled ? "good" : "warn"}>{aiInfo.configured && aiInfo.enabled ? "Configured · " + (aiInfo.provider === "gemini" ? "Gemini" : "DeepSeek") : "Not configured"}</strong><span>{aiInfo.configured ? "Saved key is hidden from the browser." : "No AI key is saved for this server."}</span></div><label className="fieldLabel">AI provider</label><select value={aiProvider} onChange={e => setAiProvider(e.target.value)}><option value="gemini">Google Gemini</option><option value="deepseek">DeepSeek</option></select><label className="fieldLabel">Your API key</label><input type="password" autoComplete="new-password" value={aiKey} onChange={e => setAiKey(e.target.value)} placeholder={aiInfo.configured ? "Saved key hidden — enter a new key to replace it" : "Paste your own API key"} maxLength={500}/><p className="hint">Official key pages: Google AI Studio or DeepSeek Platform. Authentication validation cannot guarantee credits or perfect security. Never paste keys into Discord chat or share them with members.</p><div className="actions"><button className="secondary" disabled={aiBusy || !aiInfo.configured} onClick={removeAiKey}>Remove saved key</button><button className="primary" disabled={aiBusy || aiKey.trim().length < 12} onClick={saveAiKey}>{aiBusy ? "Checking & encrypting…" : aiInfo.configured ? "Validate & replace key" : "Validate & save key"}</button></div><div className="sectionDivider"></div><p className="hint">Required: AI_KEY_ENCRYPTION_SECRET must be set to the same strong random secret on the dashboard host and bot host. AI classification sends relevant message text and saved rules to your selected AI provider.</p></>}{active === "Logs" && <>
            <div className="panelHeading"><div><h2>Moderation history</h2><p className="muted">Only records belonging to {guild.name} are shown. Data is filtered server-side by this server ID.</p></div><button className="secondary" onClick={() => { setLogsError(""); setLogsLoading(true); fetch("/api/logs?guildId=" + encodeURIComponent(guildId), {cache:"no-store"}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||"Could not load logs.");setModLogs(d.logs||[]);}).catch(e=>setLogsError(e.message)).finally(()=>setLogsLoading(false)); }}>Refresh logs</button></div>
            <label className="fieldLabel">Filter by action</label><select value={logFilter} onChange={e=>setLogFilter(e.target.value)}><option value="all">All events</option><option value="ai">AI review / moderation</option><option value="timeout">Timeouts</option><option value="kick">Kicks</option><option value="ban">Bans</option><option value="warning">Warnings / review</option></select>
            {logsLoading && <p className="muted">Loading this server’s logs…</p>}{logsError && <div className="notice error">{logsError}</div>}
            {!logsLoading && !logsError && modLogs.filter(l => logFilter==="all" || (logFilter==="ai" ? String(l.action||"").startsWith("ai_") || l.source==="ai" : logFilter==="timeout" ? String(l.action||"").includes("timeout") : logFilter==="warning" ? ["needs_review","warning"].includes(l.status) || String(l.action||"").includes("review") : l.action===logFilter)).length===0 && <div className="placeholder"><b>No matching moderation logs</b><p className="muted">New records will appear here when the bot records moderation activity for this server.</p></div>}
            <div className="logList">{modLogs.filter(l => logFilter==="all" || (logFilter==="ai" ? String(l.action||"").startsWith("ai_") || l.source==="ai" : logFilter==="timeout" ? String(l.action||"").includes("timeout") : logFilter==="warning" ? ["needs_review","warning"].includes(l.status) || String(l.action||"").includes("review") : l.action===logFilter)).map((l,i)=><article className="logEntry" key={l.id||i}><div className="logTop"><b>{l.action || (l.source==="ai" ? "AI review" : "Moderation event")}</b><span className="tag">{l.status || "logged"}</span></div><p>{l.reason || "No reason recorded"}</p><div className="logMeta"><span>Member: {l.username || l.userId || "—"}</span><span>Rule: {l.ruleId || "—"}</span><span>{l.createdAt ? new Date(l.createdAt).toLocaleString() : "Time unavailable"}</span></div></article>)} </div>
            <p className="hint">For privacy, this view does not expose other servers’ records. Message text is not shown unless the bot explicitly stores it.</p>
          </>}
          {active === "Giveaways" && <>
            <h3>Create a persistent giveaway</h3>
            <p className="hint">The bot stores the absolute end timestamp in Firestore. If the bot restarts or is offline, the end time does not reset; the result is processed after the bot returns.</p>
            <label className="fieldLabel">Announcement channel</label>
            <select value={giveawayForm.channelId} onChange={e => setGiveawayForm(p => ({...p, channelId:e.target.value}))}><option value="">Choose a text channel</option>{channels.map(ch => <option key={ch.id} value={ch.id}>#{ch.name}</option>)}</select>
            <label className="fieldLabel">Prize</label><input value={giveawayForm.prize} maxLength={150} onChange={e => setGiveawayForm(p => ({...p, prize:e.target.value}))} placeholder="Example: game gift card"/>
            <label className="fieldLabel">Duration (minutes, 1–10080)</label><input type="number" min="1" max="10080" value={giveawayForm.durationMinutes} onChange={e => setGiveawayForm(p => ({...p, durationMinutes:Number(e.target.value)}))}/>
            <div className="actions"><button className="secondary" onClick={() => loadGiveaways().catch(e => setError(e.message))}>Refresh list</button><button className="primary" disabled={giveawayBusy || !giveawayForm.channelId || !giveawayForm.prize.trim()} onClick={createGiveaway}>{giveawayBusy ? "Creating…" : "Create & announce giveaway"}</button></div>
            <div className="sectionDivider"></div><div className="panelHeading"><div><h3>Saved giveaways</h3><p className="hint">Up to 50 recent records from this server.</p></div></div>
            {!giveaways.length ? <div className="placeholder"><b>No saved giveaways</b><p className="muted">Create a giveaway above or use the giveaway-create command in Discord.</p></div> : <div className="logList">{giveaways.map(g => <article className="logEntry" key={g.id}><div className="logTop"><b>{g.prize}</b><span className="tag">{g.status}</span></div><p>Entries: {g.participantCount} · Channel: {g.channelId ? "#" + (channels.find(c => c.id === g.channelId)?.name || g.channelId) : "—"}</p><div className="logMeta"><span>ID: {g.id}</span><span>{g.endsAt ? (g.status === "active" ? "Ends " : "Ended ") + new Date(g.endsAt).toLocaleString() : "End time unavailable"}</span><span>{g.winnerId ? "Winner: " + g.winnerId : ""}</span></div></article>)}</div>}
          </>}
          {active === "Chat Health" && <>
            <div className="panelHeading"><div><h3>Chat Health Monitor</h3><p className="muted">Daily Firestore snapshots; the bot retains the newest seven snapshots per server.</p></div><button className="secondary" disabled={chatHealthBusy} onClick={loadChatHealth}>{chatHealthBusy ? "Loading…" : "Refresh analytics"}</button></div>
            <div className="stats"><article className="stat"><small>LATEST SNAPSHOT</small><strong>{chatHealth.date || "Not available"}</strong><span>Latest saved daily snapshot</span></article><article className="stat"><small>TRACKED MEMBERS</small><strong>{chatHealth.users?.length || 0}</strong><span>Members in latest snapshot</span></article><article className="stat"><small>RETENTION</small><strong>7 days</strong><span>Oldest daily snapshot is removed first</span></article><article className="stat"><small>LIVE COMMAND</small><strong>/chat-health</strong><span>Moderator-only summary in Discord</span></article></div>
            {!chatHealth.users?.length ? <div className="placeholder"><b>No chat-health snapshot yet</b><p className="muted">The bot needs to run and record messages before the first snapshot is available. Check bot status and refresh later.</p></div> : <div className="logList">{chatHealth.users.map((u,i) => <article className="logEntry" key={u.userId}><div className="logTop"><b>{i+1}. {u.userId}</b><span className="tag">{u.messages7d} messages / 7 days</span></div><div className="logMeta"><span>Active days: {u.activeDays}</span><span>Last message: {u.lastMessageAt ? new Date(u.lastMessageAt).toLocaleString() : "—"}</span></div></article>)}</div>}
          </>}
          {active !== "Settings" && active !== "Giveaways" && active !== "Chat Health" && <div className="actions"><button className="secondary" onClick={() => window.location.reload()}>Reload saved values</button><button className="primary" disabled={!canSave} onClick={save}>{busy ? "Saving…" : "Save to Firebase"}</button></div>}
        </section>}
        <footer>THE DC BOT <span>Discord OAuth · Firestore-backed settings</span></footer>
      </div>
    </section>
    <style jsx global>{`
      *{box-sizing:border-box}body{margin:0;background:#0a0c12;color:#edf0f8;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,textarea,select{font:inherit}button{cursor:pointer}.appShell{min-height:100vh;display:grid;grid-template-columns:255px minmax(0,1fr)}.sidebar{height:100vh;position:sticky;top:0;background:#0e1018;border-right:1px solid #252a38;padding:22px 14px;display:flex;flex-direction:column;gap:10px;overflow:auto}.brand{display:flex;align-items:center;gap:11px;padding:0 8px 28px}.brandMark{width:40px;height:40px;display:grid;place-items:center;border-radius:12px;background:linear-gradient(135deg,#9a7aff,#6047df);font-weight:900}.brand b{display:block;font-size:13px;letter-spacing:1px}.brand small,.profile small{display:block;color:#82899c;font-size:10px;margin-top:4px}.label{font-size:10px;letter-spacing:1.4px;font-weight:800;color:#7f8799;padding:0 8px}.sidebar select{width:100%;background:#171a25;color:#e8eaf2;border:1px solid #2a3040;border-radius:9px;padding:11px}.navTitle{margin-top:18px}nav{display:grid;gap:4px}.navItem{display:flex;align-items:center;gap:12px;padding:11px 12px;border:0;border-radius:9px;background:transparent;color:#aeb4c5;text-align:left}.navItem span{width:19px;text-align:center}.navItem:hover,.navItem.active{background:#25203d;color:#c5b5ff}.profile{margin-top:auto;border-top:1px solid #252a38;padding:18px 6px 2px;display:flex;gap:10px;align-items:center}.profile b{font-size:12px}.avatar{width:34px;height:34px;border-radius:10px;background:#28243d;display:grid;place-items:center;color:#c8b9ff;font-weight:800}.main{min-width:0}.topbar{height:64px;border-bottom:1px solid #252a38;display:flex;justify-content:space-between;align-items:center;padding:0 30px;color:#858da1;font-size:12px}.topbar i{padding:0 10px;color:#4c5262}.topbar b{color:#e9ebf3}.statusTag,.tag{font-size:10px;letter-spacing:1px;color:#aeb5c6;border:1px solid #303545;border-radius:20px;padding:7px 10px}.statusTag i{display:inline-block;width:6px;height:6px;border-radius:50%;background:#9a8bff;margin-right:7px}.content{max-width:1320px;margin:0 auto;padding:32px}.heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:26px}.eyebrow{font-size:10px;font-weight:800;letter-spacing:1.7px;color:#a995ff;margin:0 0 9px}.heading h1{font-size:30px;margin:0;letter-spacing:-.8px}.muted{color:#9299ab;font-size:13px;line-height:1.7}.primary,.secondary{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;border:0;border-radius:9px;padding:11px 15px;font-size:12px;font-weight:800}.primary{background:#8a72f6;color:#fff}.primary:hover{background:#9b87ff}.primary:disabled{opacity:.5;cursor:not-allowed}.secondary{background:#202432;color:#d9dceb;border:1px solid #34394a}.notice{background:#171a25;border:1px solid #34394a;border-radius:10px;padding:14px 16px;margin:14px 0;color:#c8ccda;font-size:13px;line-height:1.6}.notice p{margin:6px 0}.notice.error{border-color:#74434c}.notice.success{border-color:#356a58}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:22px 0}.stat,.panel{background:#11141d;border:1px solid #272c3b;border-radius:13px}.stat{padding:18px;min-height:130px}.stat small{display:block;color:#858da1;font-size:10px;letter-spacing:1.1px;font-weight:800;margin-bottom:15px}.stat strong{display:block;font-size:18px;overflow-wrap:anywhere}.stat span{display:block;color:#9299ab;font-size:11px;margin-top:9px;line-height:1.5}.good{color:#76d6a8}.warn{color:#f0c27d}.panel{padding:22px;margin:18px 0}.panel h2{font-size:17px;margin:0 0 7px}.panelHeading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}.panelHeading p{margin:0}.moduleGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.module{display:flex;flex-direction:column;gap:24px;align-items:flex-start;text-align:left;background:#171a25;border:1px solid #2a3040;border-radius:10px;padding:17px;color:#e8eaf3}.module span{font-size:11px;color:#a995ff}.fieldLabel{display:block;margin:20px 0 8px;font-size:12px;font-weight:700;color:#cfd3e0}h3{font-size:14px;margin:18px 0 4px}select,input:not([type=checkbox]){width:100%;background:#0b0e15;border:1px solid #303648;border-radius:9px;color:#e9ebf5;padding:12px;outline:none}.sectionDivider{height:1px;background:#282d3b;margin:24px 0}textarea{width:100%;resize:vertical;background:#0b0e15;border:1px solid #303648;border-radius:9px;color:#e9ebf5;padding:12px;outline:none}textarea:focus,select:focus{border-color:#8a72f6}.hint{font-size:11px;color:#858da1;line-height:1.6}.toggle{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:16px 0;border-bottom:1px solid #282d3b}.toggle b,.toggle small{display:block}.toggle small{color:#858da1;font-size:11px;margin-top:5px}.toggle input{width:18px;height:18px;accent-color:#8a72f6}.placeholder{padding:18px;border:1px dashed #353b4c;border-radius:10px}.placeholder p{margin-bottom:0}.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:22px;padding-top:18px;border-top:1px solid #282d3b}.logList{display:grid;gap:10px;margin-top:14px}.logEntry{border:1px solid #2a3040;background:#0d1018;border-radius:10px;padding:14px}.logEntry p{color:#b8bfd0;font-size:12px;line-height:1.6;overflow-wrap:anywhere}.logTop{display:flex;justify-content:space-between;align-items:center;gap:10px}.logTop b{font-size:13px}.logMeta{display:flex;flex-wrap:wrap;gap:8px 16px;color:#858da1;font-size:10px}footer{display:flex;justify-content:space-between;gap:12px;padding:24px 0;color:#6e768a;font-size:10px;letter-spacing:.8px}footer span{letter-spacing:0}@media(max-width:1050px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.moduleGrid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:720px){.appShell{grid-template-columns:1fr}.sidebar{height:auto;position:relative}.profile{margin-top:15px}.topbar{padding:0 16px}.content{padding:20px 15px}.heading{align-items:flex-start;flex-direction:column}.stats,.moduleGrid{grid-template-columns:1fr}.statusTag{display:none}footer{flex-direction:column}}
    `}</style>
  </main>;
}
