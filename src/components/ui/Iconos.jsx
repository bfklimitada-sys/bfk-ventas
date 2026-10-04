// Iconos SVG consistentes (trazo, 24x24, hereda el color del texto).
// <Ic n="📦" /> acepta el nombre o el emoji histórico como clave.
// <I t="📧 Texto" /> convierte los emojis de un texto en iconos.
const P = {
  chart: <><path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/></>,
  box: <><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></>,
  bank: <><path d="M3 10l9-6 9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8"/><path d="M3 21h18"/></>,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z"/><path d="M9 8h6M9 12h6"/></>,
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M3 13h18"/></>,
  bell: <><path d="M6 9a6 6 0 0112 0c0 6 2 7 2 8H4c0-1 2-2 2-8z"/><path d="M10 21h4"/></>,
  users: <><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6"/><path d="M16 4.6a3.5 3.5 0 010 6.8M18 14.2c2 .7 3.5 2.6 3.5 5.8"/></>,
  hand: <><path d="M12 2v10M12 12c-3 0-6-2-6-5"/><path d="M5 14l2 6h10l2-6"/></>,
  alert: <><path d="M12 3L2 20h20L12 3z"/><path d="M12 10v4M12 17.2v.1"/></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></>,
  mailIn: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6M9 21h6"/></>,
  truck: <><path d="M2 6h11v10H2zM13 9h4l4 4v3h-8"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/></>,
  coins: <><circle cx="12" cy="12" r="9"/><path d="M14.5 9c-.5-1-1.5-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1 0-2-.5-2.5-1.5M12 6v1.5M12 16.5V18"/></>,
  hourglass: <><path d="M6 3h12M6 21h12"/><path d="M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9"/></>,
  wrench: <><path d="M14.5 6.5a4 4 0 005 5l-8.5 8.5a2.1 2.1 0 01-3-3L16.5 8.5"/><path d="M14.5 6.5l2-2.5 3.5 3.5-2.5 2"/></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/></>,
  pause: <><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></>,
  file: <><path d="M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V8l-5-5z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></>,
  link: <><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/></>,
  pencil: <><path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19l-4 1z"/><path d="M14 7l3 3"/></>,
  check: <><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></>,
  clipboard: <><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h6"/></>,
  message: <><path d="M4 5h16v11H9l-5 4V5z"/></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></>,
  building: <><rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3"/></>,
  download: <><path d="M12 4v11M7 11l5 5 5-5M4 20h16"/></>,
  printer: <><path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/></>,
  chevD: <path d="M5 9l7 7 7-7"/>,
  chevL: <path d="M15 5l-7 7 7 7"/>,
  chevR: <path d="M9 5l7 7-7 7"/>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
  dotRed: <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>,
  dotOrange: <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>,
  dotAmber: <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>,
  heart: <><path d="M12 20s-8-5-8-11a4.5 4.5 0 018-2.5A4.5 4.5 0 0120 9c0 6-8 11-8 11z"/></>,
  sparkle: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/></>,
};
const COLOR = { dotRed:"#EF4444", dotAmber:"#F59E0B", dotOrange:"#F97316" };
const ALIAS = {
  "📊":"chart","📦":"box","📅":"calendar","🏦":"bank","🧾":"receipt","🧑‍💼":"briefcase","💼":"briefcase","🔔":"bell","👥":"users","👋":"hand",
  "⚠":"alert","⚠️":"alert","📧":"mail","📩":"mailIn","🚚":"truck","💰":"coins","💸":"coins","⏳":"hourglass","🛠":"wrench","🗑":"trash",
  "⏸":"pause","📄":"file","🔗":"link","✏️":"pencil","✅":"check","📋":"clipboard","💬":"message","🔒":"lock","🏢":"building","📥":"download",
  "☰":"menu","◀":"chevL","▶":"chevR","🔴":"dotRed","🟡":"dotAmber","🟠":"dotOrange","💚":"heart",
};
export function Ic({ n, size = "1.15em", color, style }) {
  const clave = String(n || "").replace(/️/g, "");
  const k = ALIAS[n] || ALIAS[clave] || ALIAS[clave + "️"] || n;
  const g = P[k];
  if (!g) return null;
  const col = color || COLOR[k] || undefined;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ verticalAlign:"-0.18em", flexShrink:0, color:col, ...style }}>{g}</svg>
  );
}

const RE = /(\p{Extended_Pictographic}️?(?:‍\p{Extended_Pictographic}️?)?)/gu;
const SOLO_TEXTO = new Set(["✓","✕","→","←","▲","▼","●","↗","↩","↻","↓","▾","▸","◀","▶","▢","○","⬆","⬇"]);
export function I({ t, size = "1.15em" }) {
  const partes = String(t ?? "").split(RE);
  return <>{partes.map((p, i) => (i % 2 && !SOLO_TEXTO.has(p) && (ALIAS[p] || ALIAS[p.replace(/️/g, "")])
    ? <Ic key={i} n={p} size={size} style={{ marginRight:4 }} />
    : p))}</>;
}
