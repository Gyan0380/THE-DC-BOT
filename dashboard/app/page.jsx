"use client";
const cards = [
  ["Rule Manager", "Create and edit rule IDs, points, and descriptions."],
  ["Promotion Channels", "Review detected promotion channels and allow-list settings."],
  ["Moderation Queue", "Human review for ambiguous messages."],
  ["Giveaways", "Persist end times and review expired giveaways after restarts."]
];
export default function Home() {
  return <main style={{ maxWidth: 1050, margin: "0 auto", padding: "48px 22px" }}>
    <p style={{ color: "#a6a9c4", letterSpacing: 3, fontSize: 12 }}>COMMUNITY CONTROL CENTER</p>
    <h1 style={{ fontSize: "clamp(34px, 6vw, 58px)", margin: "8px 0" }}>THE DC BOT</h1>
    <p style={{ color: "#b7bad0", lineHeight: 1.7, maxWidth: 650 }}>A starter dashboard for your Discord community. Live login, permissions, and APIs are not connected yet; do not enter secrets here.</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16, marginTop: 30 }}>
      {cards.map(([title, desc]) => <section key={title} style={{ background: "#141624", border: "1px solid #292d42", borderRadius: 18, padding: 22 }}>
        <h2 style={{ fontSize: 19 }}>{title}</h2><p style={{ color: "#b7bad0", lineHeight: 1.6 }}>{desc}</p>
        <span style={{ color: "#f0c978", fontSize: 12 }}>PLANNED / SCAFFOLD</span>
      </section>)}
    </div>
    <p style={{ color: "#777d99", fontSize: 12, marginTop: 36 }}>Starter UI only · Add Discord OAuth and server-side authorization before production.</p>
  </main>;
}
