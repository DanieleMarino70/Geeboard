// Geeboard design canvas — shared vocabulary lifted verbatim from
// deliverable-shape-and-priority/project/Geeboard.dc.html and
// deliverable-shape-and-priority/project/Geeboard Design System.dc.html

/* ── icons: Lucide-style, 24 grid, stroke only ─────────────────── */
const P = {
  grid: '<rect x="3" y="3" width="7" height="8.5" rx="1.6"/><rect x="14" y="3" width="7" height="5" rx="1.6"/><rect x="14" y="10.5" width="7" height="10.5" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/>',
  activity: '<polyline points="21.5 12 17 12 14 20.5 10 3.5 7 12 2.5 12"/>',
  chart: '<line x1="4" y1="20.5" x2="4" y2="12"/><line x1="10" y1="20.5" x2="10" y2="4"/><line x1="16" y1="20.5" x2="16" y2="9"/><line x1="21" y1="20.5" x2="21" y2="15"/>',
  server: '<rect x="2.5" y="3" width="19" height="7.5" rx="2"/><rect x="2.5" y="13.5" width="19" height="7.5" rx="2"/><line x1="6.5" y1="6.75" x2="6.52" y2="6.75"/><line x1="6.5" y1="17.25" x2="6.52" y2="17.25"/>',
  terminal: '<polyline points="4.5 16.5 10 11 4.5 5.5"/><line x1="12" y1="18.5" x2="19.5" y2="18.5"/>',
  folder: '<path d="M3 7.5a2 2 0 0 1 2-2h3.8l2 2.2H19a2 2 0 0 1 2 2v8.8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"/><line x1="10" y1="13" x2="14" y2="13"/>',
  clock: '<circle cx="12" cy="12" r="8.8"/><polyline points="12 6.8 12 12.3 16 14.4"/>',
  package: '<path d="M21 8.2v7.6l-9 4.9-9-4.9V8.2l9-4.9z"/><polyline points="3 8.2 12 13.1 21 8.2"/><line x1="12" y1="13.1" x2="12" y2="20.7"/>',
  cpu: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/><rect x="10" y="10" width="4" height="4" rx="1"/><line x1="9.5" y1="2.5" x2="9.5" y2="6.5"/><line x1="14.5" y1="2.5" x2="14.5" y2="6.5"/><line x1="9.5" y1="17.5" x2="9.5" y2="21.5"/><line x1="14.5" y1="17.5" x2="14.5" y2="21.5"/><line x1="2.5" y1="9.5" x2="6.5" y2="9.5"/><line x1="2.5" y1="14.5" x2="6.5" y2="14.5"/><line x1="17.5" y1="9.5" x2="21.5" y2="9.5"/><line x1="17.5" y1="14.5" x2="21.5" y2="14.5"/>',
  store: '<path d="M4 9.5h16l-1.15 9.6a2 2 0 0 1-2 1.9H7.15a2 2 0 0 1-2-1.9z"/><path d="M8.8 9.5V6.6a3.2 3.2 0 0 1 6.4 0v2.9"/>',
  users: '<circle cx="9.2" cy="8" r="3.3"/><path d="M2.8 20.2c0-3.5 2.9-5.4 6.4-5.4s6.4 1.9 6.4 5.4"/><circle cx="17.6" cy="8.6" r="2.6"/><path d="M17.4 14.9c2.4.3 3.8 2.1 3.8 5.3"/>',
  key: '<circle cx="7.6" cy="16.4" r="4.1"/><line x1="10.6" y1="13.4" x2="21" y2="3"/><line x1="17.6" y1="6.4" x2="20.4" y2="9.2"/><line x1="14.8" y1="9.2" x2="17" y2="11.4"/>',
  shield: '<path d="M12 3.2 19.2 6v6.1c0 4.5-3 8-7.2 9.3-4.2-1.3-7.2-4.8-7.2-9.3V6z"/>',
  settings: '<line x1="20.5" y1="7.5" x2="12" y2="7.5"/><line x1="4" y1="7.5" x2="6.5" y2="7.5"/><circle cx="9.2" cy="7.5" r="2.7"/><line x1="3.5" y1="16.5" x2="12" y2="16.5"/><line x1="20" y1="16.5" x2="17.5" y2="16.5"/><circle cx="14.8" cy="16.5" r="2.7"/>',
  bell: '<path d="M18.2 8.6a6.2 6.2 0 1 0-12.4 0c0 6.6-2.6 8.6-2.6 8.6h17.6s-2.6-2-2.6-8.6"/><path d="M13.8 20.6a2.1 2.1 0 0 1-3.6 0"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><line x1="16" y1="16" x2="21" y2="21"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  right: '<polyline points="9.5 5.5 16 12 9.5 18.5"/>',
  down: '<polyline points="5.5 9.5 12 16 18.5 9.5"/>',
  up: '<polyline points="5.5 14.5 12 8 18.5 14.5"/>',
  left: '<polyline points="14.5 5.5 8 12 14.5 18.5"/>',
  check: '<polyline points="4.5 12.5 9.5 17.5 19.5 6.5"/>',
  x: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
  alert: '<path d="M12 4.2 21 19.6H3z"/><line x1="12" y1="10" x2="12" y2="14"/><line x1="12" y1="16.8" x2="12.02" y2="16.8"/>',
  info: '<circle cx="12" cy="12" r="8.8"/><line x1="12" y1="11" x2="12" y2="16.5"/><line x1="12" y1="7.6" x2="12.02" y2="7.6"/>',
  play: '<path d="M7.5 5.2 18.5 12 7.5 18.8z"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  pause: '<rect x="7.5" y="5.5" width="3.4" height="13" rx="1.2"/><rect x="13.1" y="5.5" width="3.4" height="13" rx="1.2"/>',
  restart: '<path d="M20.4 12a8.4 8.4 0 1 1-2.6-6.1"/><polyline points="20.8 4.2 20.8 9.4 15.6 9.4"/>',
  download: '<path d="M12 3.6v11.6"/><polyline points="7.4 10.8 12 15.4 16.6 10.8"/><path d="M4 17.2v1.6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.6"/>',
  upload: '<path d="M12 15.4V3.8"/><polyline points="7.4 8.4 12 3.8 16.6 8.4"/><path d="M4 17.2v1.6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.6"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.2"/><path d="M5.5 15.5A2 2 0 0 1 3.5 13.5v-8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2"/>',
  trash: '<polyline points="3.8 6.4 20.2 6.4"/><path d="M8.6 6.4V4.8a1.6 1.6 0 0 1 1.6-1.6h3.6a1.6 1.6 0 0 1 1.6 1.6v1.6"/><path d="M6.2 6.4l.9 12.6a2 2 0 0 0 2 1.8h5.8a2 2 0 0 0 2-1.8l.9-12.6"/>',
  dots: '<circle cx="5.4" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.6" cy="12" r="1.4"/>',
  filter: '<path d="M3.5 5.2h17l-6.6 7.6v6.4l-3.8 2v-8.4z"/>',
  refresh: '<polyline points="20.6 4.4 20.6 9.6 15.4 9.6"/><path d="M20.2 9.6a8.4 8.4 0 1 0 .4 4.4"/>',
  external: '<path d="M14.4 4.4h5.2v5.2"/><line x1="19.6" y1="4.4" x2="11.6" y2="12.4"/><path d="M18 14.4v4.2a2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.2"/>',
  lock: '<rect x="4.6" y="10.4" width="14.8" height="10.2" rx="2.4"/><path d="M8.2 10.4V7.6a3.8 3.8 0 0 1 7.6 0v2.8"/>',
  globe: '<circle cx="12" cy="12" r="8.8"/><path d="M3.4 12h17.2"/><path d="M12 3.2c2.4 2.6 3.6 5.6 3.6 8.8s-1.2 6.2-3.6 8.8c-2.4-2.6-3.6-5.6-3.6-8.8s1.2-6.2 3.6-8.8z"/>',
  zap: '<path d="M13 3 5 14h5l-1 7 8-11h-5z"/>',
  drive: '<path d="M3.2 13.4 6 5.6a2 2 0 0 1 1.9-1.4h8.2A2 2 0 0 1 18 5.6l2.8 7.8"/><rect x="3.2" y="13.4" width="17.6" height="6.4" rx="2"/><line x1="7.2" y1="16.6" x2="7.22" y2="16.6"/><line x1="11" y1="16.6" x2="11.02" y2="16.6"/>',
  network: '<path d="M2.6 9.4a13 13 0 0 1 18.8 0"/><path d="M5.8 13a8.6 8.6 0 0 1 12.4 0"/><path d="M9 16.6a4.2 4.2 0 0 1 6 0"/><line x1="12" y1="20.2" x2="12.02" y2="20.2"/>',
  database: '<ellipse cx="12" cy="6" rx="7.8" ry="2.9"/><path d="M4.2 6v12c0 1.6 3.5 2.9 7.8 2.9s7.8-1.3 7.8-2.9V6"/><path d="M4.2 12c0 1.6 3.5 2.9 7.8 2.9s7.8-1.3 7.8-2.9"/>',
  file: '<path d="M13.4 3.2H7a2 2 0 0 0-2 2v13.6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.8z"/><polyline points="13.4 3.2 13.4 8.8 19 8.8"/>',
  image: '<rect x="3.4" y="4.4" width="17.2" height="15.2" rx="2.2"/><circle cx="8.8" cy="9.6" r="1.7"/><path d="M20.6 15.4 16 11l-8.6 8.6"/>',
  code: '<polyline points="9 6.5 3.6 12 9 17.5"/><polyline points="15 6.5 20.4 12 15 17.5"/>',
  branch: '<circle cx="6.6" cy="5.4" r="2.4"/><circle cx="6.6" cy="18.6" r="2.4"/><circle cx="17.4" cy="9.2" r="2.4"/><path d="M6.6 7.8v8.4"/><path d="M17.4 11.6c0 3.4-3 4.6-6.4 5"/>',
  calendar: '<rect x="3.4" y="5.2" width="17.2" height="15.4" rx="2.2"/><line x1="3.4" y1="10" x2="20.6" y2="10"/><line x1="8.2" y1="3" x2="8.2" y2="7"/><line x1="15.8" y1="3" x2="15.8" y2="7"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20.4c0-3.8 3.2-5.8 7.2-5.8s7.2 2 7.2 5.8"/>',
  eye: '<path d="M2.4 12S6 5.6 12 5.6 21.6 12 21.6 12 18 18.4 12 18.4 2.4 12 2.4 12z"/><circle cx="12" cy="12" r="2.9"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><line x1="12" y1="2.4" x2="12" y2="4.6"/><line x1="12" y1="19.4" x2="12" y2="21.6"/><line x1="4.2" y1="4.2" x2="5.8" y2="5.8"/><line x1="18.2" y1="18.2" x2="19.8" y2="19.8"/><line x1="2.4" y1="12" x2="4.6" y2="12"/><line x1="19.4" y1="12" x2="21.6" y2="12"/><line x1="4.2" y1="19.8" x2="5.8" y2="18.2"/><line x1="18.2" y1="5.8" x2="19.8" y2="4.2"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><line x1="9.5" y1="4" x2="9.5" y2="20"/>',
  save: '<path d="M4.4 6.4a2 2 0 0 1 2-2h9.2l4 4v9.2a2 2 0 0 1-2 2H6.4a2 2 0 0 1-2-2z"/><polyline points="8.4 4.4 8.4 9.4 15 9.4"/><rect x="8" y="13.6" width="8" height="6"/>',
  send: '<path d="M21 3.6 10.6 14"/><path d="M21 3.6 14.4 21l-3.8-7-7-3.8z"/>',
  history: '<path d="M3.6 12a8.4 8.4 0 1 0 2.5-6"/><polyline points="3.2 3.8 3.2 9 8.4 9"/><polyline points="12 7.4 12 12.4 15.6 14.4"/>',
  sliders: '<line x1="5" y1="4.5" x2="5" y2="10"/><line x1="5" y1="14" x2="5" y2="19.5"/><line x1="12" y1="4.5" x2="12" y2="13"/><line x1="12" y1="17" x2="12" y2="19.5"/><line x1="19" y1="4.5" x2="19" y2="7"/><line x1="19" y1="11" x2="19" y2="19.5"/><circle cx="5" cy="12" r="2"/><circle cx="12" cy="15" r="2"/><circle cx="19" cy="9" r="2"/>',
  star: '<path d="M12 3.6 14.6 9l5.9.8-4.3 4.1 1.1 5.8-5.3-2.9-5.3 2.9 1.1-5.8L3.5 9.8 9.4 9z"/>',
  link: '<path d="M10.2 13.8a4.4 4.4 0 0 0 6.4 0l2.6-2.6a4.4 4.4 0 0 0-6.2-6.2l-1.4 1.4"/><path d="M13.8 10.2a4.4 4.4 0 0 0-6.4 0l-2.6 2.6a4.4 4.4 0 0 0 6.2 6.2l1.4-1.4"/>'
};

export function ic(n, s = 16, sw = 1.7, extra = '') {
  const st = extra ? ` style="${extra}"` : '';
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${st}>${P[n]}</svg>`;
}

/* ── the token sheet, byte-for-byte from the handoff bundle ─────── */
export const TOKENS = `*{box-sizing:border-box}
body{
  margin:0;
  --sans:Geist,ui-sans-serif,-apple-system,"Helvetica Neue",Helvetica,sans-serif;
  --mono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  --bg:hsl(230 16% 5.5%);
  --bg-2:hsl(230 15% 7.5%);
  --surface:hsl(230 14% 9.5%);
  --card:hsl(230 13% 11%);
  --card-2:hsl(230 13% 14%);
  --border:hsl(230 11% 18%);
  --border-2:hsl(230 11% 26%);
  --ink:hsl(228 22% 97%);
  --ink-2:hsl(228 12% 78%);
  --ink-3:hsl(228 11% 64%);
  --ink-4:hsl(228 10% 56%);
  --accent:hsl(80 72% 60%);
  --accent-2:hsl(80 80% 72%);
  --accent-ink:hsl(80 60% 8%);
  --accent-soft:hsl(80 72% 60% / .13);
  --accent-line:hsl(80 72% 60% / .30);
  --success:hsl(166 68% 45%);
  --success-soft:hsl(166 68% 45% / .14);
  --warning:hsl(38 94% 58%);
  --warning-soft:hsl(38 94% 58% / .14);
  --danger:hsl(4 78% 60%);
  --danger-soft:hsl(4 78% 60% / .14);
  --info:hsl(218 92% 66%);
  --info-soft:hsl(218 92% 66% / .14);
  --wire:hsl(230 10% 22%);
  --wire-2:hsl(230 10% 16%);
  --glass:hsl(230 15% 7.5% / .74);
  --con-bg:hsl(230 20% 6.5%);
  --con-ink:hsl(228 16% 86%);
  --con-dim:hsl(228 10% 54%);
  --shadow-1:0 1px 2px hsl(230 40% 2% / .5);
  --shadow-2:0 4px 16px -4px hsl(230 40% 2% / .6);
  --shadow-3:0 24px 60px -12px hsl(230 40% 2% / .78);
  --pad:32px;
  --gap:16px;
  --cardpad:22px;
  --r-sm:6px; --r:10px; --r-lg:14px; --r-xl:20px;
  background:var(--bg);
  color:var(--ink);
  font-family:var(--sans);
  font-size:14px;
  line-height:1.5;
  -webkit-font-smoothing:antialiased;
  text-wrap:pretty;
}
body[data-theme="light"]{
  --bg:hsl(225 24% 97.5%);
  --bg-2:hsl(0 0% 100%);
  --surface:hsl(225 24% 99%);
  --card:hsl(0 0% 100%);
  --card-2:hsl(225 24% 97%);
  --border:hsl(225 16% 89%);
  --border-2:hsl(225 14% 78%);
  --ink:hsl(228 26% 12%);
  --ink-2:hsl(228 12% 32%);
  --ink-3:hsl(228 10% 40%);
  --ink-4:hsl(228 9% 45%);
  --accent:hsl(84 62% 33%);
  --accent-2:hsl(84 62% 26%);
  --accent-ink:hsl(80 60% 97%);
  --accent-soft:hsl(84 62% 33% / .10);
  --accent-line:hsl(84 62% 33% / .28);
  --success:hsl(166 72% 32%);
  --warning:hsl(30 88% 40%);
  --danger:hsl(4 72% 46%);
  --info:hsl(218 82% 46%);
  --wire:hsl(225 14% 80%);
  --wire-2:hsl(225 18% 92%);
  --glass:hsl(0 0% 100% / .78);
  --con-bg:hsl(228 22% 13%);
  --con-ink:hsl(228 16% 90%);
  --con-dim:hsl(228 10% 62%);
  --shadow-1:0 1px 2px hsl(228 30% 40% / .07);
  --shadow-2:0 4px 16px -4px hsl(228 30% 40% / .12);
  --shadow-3:0 24px 60px -12px hsl(228 30% 40% / .20);
}
a{color:var(--accent);text-decoration:none}
a:hover{color:var(--accent-2);text-decoration:underline}
button{font:inherit;color:inherit;border:0;background:none;cursor:pointer}
input,select,textarea{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
::selection{background:var(--accent-line);color:var(--ink)}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-thumb{background:var(--border-2);border-radius:8px;border:3px solid transparent;background-clip:content-box}
::-webkit-scrollbar-track{background:transparent}
@keyframes gbPulse{0%{box-shadow:0 0 0 0 currentColor;opacity:.55}70%{box-shadow:0 0 0 7px transparent;opacity:0}100%{box-shadow:0 0 0 0 transparent;opacity:0}}
@keyframes gbSpin{to{transform:rotate(360deg)}}
@keyframes gbRise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes gbSheen{0%{background-position:-160% 0}100%{background-position:260% 0}}
@keyframes gbCaret{0%,49%{opacity:1}50%,100%{opacity:0}}
@keyframes gbBar{0%{width:12%}50%{width:74%}100%{width:12%}}
@keyframes gbDash{to{stroke-dashoffset:-14}}
@media (prefers-reduced-motion: reduce){*{animation-duration:.01ms !important;animation-iteration-count:1 !important;transition-duration:.01ms !important}}`;

/* ── file scaffold ─────────────────────────────────────────────── */
const PROPS = '{"theme":{"editor":"enum","options":["dark","light"],"default":"dark","tsType":"string","section":"Appearance"},"accent":{"editor":"color","options":["hsl(80 72% 60%)","hsl(158 70% 55%)","hsl(28 92% 62%)","hsl(258 82% 70%)"],"default":"hsl(80 72% 60%)","tsType":"string","section":"Appearance"}}';

const LOGIC = `class Component extends DCLogic {
  componentDidMount() { this.apply(); }
  componentDidUpdate() { this.apply(); }
  apply() {
    const b = document.body; if (!b) return;
    if ((this.props.theme || 'dark') === 'light') b.setAttribute('data-theme', 'light');
    else b.removeAttribute('data-theme');
    const a = this.props.accent;
    if (a && a !== 'hsl(80 72% 60%)') {
      b.style.setProperty('--accent', a);
      b.style.setProperty('--accent-2', a);
      b.style.setProperty('--accent-soft', 'color-mix(in oklab, ' + a + ' 14%, transparent)');
      b.style.setProperty('--accent-line', 'color-mix(in oklab, ' + a + ' 32%, transparent)');
    } else {
      b.style.removeProperty('--accent'); b.style.removeProperty('--accent-2');
      b.style.removeProperty('--accent-soft'); b.style.removeProperty('--accent-line');
    }
  }
  renderVals() { return {}; }
}`;

export function doc({ w, h, body, extraCss = '' }) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&amp;family=JetBrains+Mono:wght@400;500;600&amp;display=swap" rel="stylesheet">
<style>
${TOKENS}
${extraCss}
</style>
</helmet>
${body}
</x-dc>
<script data-dc-script data-props='${PROPS}'>
${LOGIC}
</script>
</body>
</html>
`;
}

/* ── small composable pieces used across artboards ─────────────── */
export const mono = 'font-family:var(--mono)';
export const label = 'font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-4)';
export const tiny = 'font-family:var(--mono);font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-4)';
export const cardSt = 'background:var(--card);border:1px solid var(--border);border-radius:var(--r-lg);box-shadow:var(--shadow-1)';

export function pill(text, tone = 'success', pulse = false) {
  const map = {
    success: ['var(--success)', 'var(--success-soft)', 'hsl(166 68% 45% / .24)'],
    warning: ['var(--warning)', 'var(--warning-soft)', 'hsl(38 94% 58% / .26)'],
    danger: ['var(--danger)', 'var(--danger-soft)', 'hsl(4 78% 60% / .26)'],
    info: ['var(--info)', 'var(--info-soft)', 'hsl(218 92% 66% / .24)'],
    accent: ['var(--accent)', 'var(--accent-soft)', 'var(--accent-line)'],
    muted: ['var(--ink-4)', 'var(--card-2)', 'var(--border)']
  };
  const [c, bgc, bd] = map[tone];
  const dot = `<span style="width:5px;height:5px;border-radius:50%;background:currentColor;color:${c}${pulse ? ';animation:gbPulse 2.2s ease-out infinite' : ''}"></span>`;
  return `<span style="display:inline-flex;align-items:center;gap:7px;padding:4px 10px;border-radius:99px;font-family:var(--mono);font-size:10.5px;letter-spacing:.03em;color:${c};background:${bgc};border:1px solid ${bd}">${dot}${text}</span>`;
}

export function badge(text, tone = 'accent') {
  const map = {
    accent: ['var(--accent)', 'var(--accent-soft)', 'var(--accent-line)'],
    success: ['var(--success)', 'var(--success-soft)', 'hsl(166 68% 45% / .24)'],
    warning: ['var(--warning)', 'var(--warning-soft)', 'hsl(38 94% 58% / .26)'],
    danger: ['var(--danger)', 'var(--danger-soft)', 'hsl(4 78% 60% / .26)'],
    info: ['var(--info)', 'var(--info-soft)', 'hsl(218 92% 66% / .24)'],
    muted: ['var(--ink-3)', 'var(--card-2)', 'var(--border)']
  };
  const [c, bgc, bd] = map[tone];
  return `<span style="font-family:var(--mono);font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;padding:3px 8px;border-radius:99px;color:${c};background:${bgc};border:1px solid ${bd}">${text}</span>`;
}

export function btn(text, kind = 'primary', size = 'md', icon = null) {
  const pads = { sm: '6px 12px', md: '9px 16px', lg: '12px 22px' };
  const rs = { sm: '8px', md: '9px', lg: '11px' };
  const fs = { sm: '12px', md: '13px', lg: '14px' };
  const skin = {
    primary: `background:var(--accent);color:var(--accent-ink);font-weight:600;box-shadow:0 8px 22px -14px var(--accent)`,
    secondary: `border:1px solid var(--border);background:var(--card);color:var(--ink-2);font-weight:500`,
    ghost: `color:var(--ink-3)`,
    destructive: `border:1px solid hsl(4 78% 60% / .3);background:var(--danger-soft);color:var(--danger);font-weight:500`
  }[kind];
  const inner = icon ? `${ic(icon, size === 'sm' ? 13 : 14)}<span>${text}</span>` : text;
  const flex = icon ? 'display:inline-flex;align-items:center;gap:7px;' : '';
  return `<button type="button" style="${flex}padding:${pads[size]};border-radius:${rs[size]};font-size:${fs[size]};${skin};transition:filter .15s,transform .12s" style-hover="filter:brightness(1.07)" style-active="transform:translateY(1px) scale(.985)">${inner}</button>`;
}

export function meter(pct, color = 'var(--accent)', h = 4) {
  return `<div style="height:${h}px;border-radius:99px;background:var(--card-2);overflow:hidden"><div style="height:100%;width:${pct}%;border-radius:99px;background:${color};transition:width .6s cubic-bezier(.2,.7,.3,1)"></div></div>`;
}

export function avatar(initials, size = 30, r = '50%') {
  return `<div style="width:${size}px;height:${size}px;border-radius:${r};flex:none;background:linear-gradient(140deg,var(--card-2),var(--border-2));display:grid;place-items:center;font-size:${Math.round(size * 0.37)}px;font-weight:600;color:var(--ink-2)">${initials}</div>`;
}

/* Game cover placeholder — striped, per the design system's note that
   artwork is a placeholder until real assets are supplied. */
export function cover(tag, size = 46, r = 11) {
  return `<div style="width:${size}px;height:${size}px;border-radius:${r}px;flex:none;border:1px solid var(--border);background:repeating-linear-gradient(135deg,var(--card-2) 0 6px,var(--bg-2) 6px 12px);display:grid;place-items:center"><span style="font-family:var(--mono);font-size:${size > 60 ? 10 : 8}px;color:var(--ink-3);text-align:center;line-height:1.2">${tag}</span></div>`;
}
