export const metadata = {
  title: "THE DC BOT Dashboard",
  description: "Community moderation configuration dashboard starter"
};
export default function RootLayout({ children }) {
  return <html lang="en"><body style={{ margin: 0, fontFamily: "Inter, system-ui, sans-serif", background: "#0a0b12", color: "#f5f5f7" }}>{children}</body></html>;
}
