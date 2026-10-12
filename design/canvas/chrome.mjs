// Shared application chrome — sidebar + topbar.
// Artboards share nothing at runtime, so each screen embeds its own copy;
// this module is what keeps those copies identical.
import { ic, avatar } from './lib.mjs';

const NAV = [
  { label: 'Workspace', items: [
    ['Dashboard', 'grid'],
    ['Activity', 'activity'],
    ['Analytics', 'chart']
  ] },
  { label: 'Servers', items: [
    ['Servers', 'server', '4'],
    ['Console', 'terminal'],
    ['Files', 'folder'],
    ['Backups', 'archive'],
    ['Scheduler', 'clock'],
    ['Plugins', 'package']
  ] },
  { label: 'Infrastructure', items: [
    ['Nodes', 'cpu', null, 'warning'],
    ['Marketplace', 'store']
  ] },
  { label: 'Organisation', items: [
    ['Members', 'users'],
    ['API keys', 'key'],
    ['Audit log', 'shield'],
    ['Settings', 'settings']
  ] }
];

function navItem([t, icon, count, dot], active) {
  const on = t === active;
  const st = `display:flex;align-items:center;gap:10px;width:100%;padding:7px 10px;border-radius:8px;font-size:12.5px;`
    + `color:${on ? 'var(--ink)' : 'var(--ink-3)'};background:${on ? 'var(--accent-soft)' : 'transparent'};`
    + `font-weight:${on ? '500' : '400'};transition:background .15s,color .15s`;
  const ist = `display:grid;place-items:center;flex:none;color:${on ? 'var(--accent)' : 'var(--ink-4)'}`;
  const tail = dot
    ? `<span style="width:6px;height:6px;border-radius:50%;background:var(--${dot});color:var(--${dot});animation:gbPulse 2.2s ease-out infinite;flex:none"></span>`
    : (count ? `<span style="font-family:var(--mono);font-size:10px;color:var(--ink-4)">${count}</span>` : '');
  return `<button type="button" style="${st}" style-hover="background:var(--card)">
                <span style="${ist}">${ic(icon, 16)}</span>
                <span style="flex:1;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t}</span>${tail}
              </button>`;
}

export function sidebar(active) {
  const groups = NAV.map(g => `<div>
            <div style="font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-4);padding:0 10px 7px">${g.label}</div>
            <div style="display:flex;flex-direction:column;gap:1px">
              ${g.items.map(i => navItem(i, active)).join('\n              ')}
            </div>
          </div>`).join('\n          ');

  return `<nav aria-label="Primary" style="flex:none;width:252px;display:flex;flex-direction:column;background:var(--bg-2);border-right:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:10px;padding:18px 18px 14px">
        <div style="width:28px;height:28px;border-radius:8px;background:var(--accent);display:grid;place-items:center;flex:none;color:var(--accent-ink);box-shadow:0 0 0 1px var(--accent-line),0 6px 18px -8px var(--accent)">${ic('zap', 16, 2.4)}</div>
        <div style="min-width:0">
          <div style="font-size:14px;font-weight:600;letter-spacing:-0.01em">Geeboard</div>
          <div style="font-family:var(--mono);font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-4)">v3.2 · community</div>
        </div>
        <button type="button" aria-label="Collapse sidebar" style="margin-left:auto;width:26px;height:26px;border-radius:7px;display:grid;place-items:center;color:var(--ink-4);flex:none;transition:background .15s,color .15s" style-hover="background:var(--card-2);color:var(--ink-2)">${ic('sidebar', 15, 1.8)}</button>
      </div>

      <button type="button" aria-label="Search or jump to" style="display:flex;align-items:center;gap:9px;margin:0 10px 12px;padding:8px 10px;border-radius:9px;border:1px solid var(--border);background:var(--bg);color:var(--ink-4);font-size:12.5px;transition:border-color .15s,background .15s" style-hover="border-color:var(--border-2);background:var(--card-2)">
        ${ic('search', 14, 1.9)}
        <span style="flex:1;text-align:left">Search or jump…</span>
        <kbd style="font-family:var(--mono);font-size:10px;padding:2px 5px;border-radius:5px;background:var(--card-2);border:1px solid var(--border);color:var(--ink-4)">⌘K</kbd>
      </button>

      <div style="flex:1;min-height:0;overflow:hidden;padding:0 10px 10px;display:flex;flex-direction:column;gap:16px">
          ${groups}
      </div>

      <div style="border-top:1px solid var(--border);padding:10px">
        <div style="display:flex;align-items:center;gap:10px;padding:7px 8px;border-radius:9px;transition:background .15s" style-hover="background:var(--card)">
          ${avatar('MK', 26)}
          <div style="min-width:0;flex:1">
            <div style="font-size:12.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Mara Kessler</div>
            <div style="font-size:10.5px;color:var(--ink-4)">Owner</div>
          </div>
          <button type="button" aria-label="Toggle colour theme" style="width:26px;height:26px;border-radius:7px;display:grid;place-items:center;color:var(--ink-4);flex:none;transition:background .15s,color .15s" style-hover="background:var(--card-2);color:var(--ink)">${ic('sun', 14)}</button>
        </div>
      </div>
    </nav>`;
}

export function topbar(crumbs, actions = '') {
  const sep = `<span style="display:grid;place-items:center;color:var(--ink-4);flex:none">${ic('right', 13, 2)}</span>`;
  const trail = crumbs.map((c, i) => {
    const last = i === crumbs.length - 1;
    return `<span style="font-size:12.5px;color:${last ? 'var(--ink)' : 'var(--ink-3)'};font-weight:${last ? '500' : '400'};white-space:nowrap">${c}</span>`;
  }).join(sep);

  return `<header style="flex:none;display:flex;align-items:center;gap:12px;padding:0 32px;height:56px;background:var(--glass);backdrop-filter:blur(16px) saturate(150%);border-bottom:1px solid var(--border)">
        <nav aria-label="Breadcrumb" style="display:flex;align-items:center;gap:7px;min-width:0;overflow:hidden">${trail}</nav>
        <div style="margin-left:auto;display:flex;align-items:center;gap:6px">
          ${actions}
          <button type="button" aria-label="Search" style="width:32px;height:32px;border-radius:9px;display:grid;place-items:center;color:var(--ink-3);transition:background .15s,color .15s" style-hover="background:var(--card);color:var(--ink)">${ic('search', 16)}</button>
          <button type="button" aria-label="Notifications" style="position:relative;width:32px;height:32px;border-radius:9px;display:grid;place-items:center;color:var(--ink-3);transition:background .15s,color .15s" style-hover="background:var(--card);color:var(--ink)">${ic('bell', 16)}<span style="position:absolute;top:6px;right:7px;width:6px;height:6px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 2px var(--bg-2)"></span></button>
          <div style="width:1px;height:20px;background:var(--border);margin:0 4px"></div>
          ${avatar('MK', 28)}
        </div>
      </header>`;
}

/* Full 1440×900 desktop screen: chrome + a scroll-free content area. */
export function screen({ active, crumbs, actions = '', main, mainStyle = '' }) {
  return `<div style="width:1440px;height:900px;display:flex;overflow:hidden;background:var(--bg)">
    ${sidebar(active)}
    <div style="flex:1;min-width:0;display:flex;flex-direction:column">
      ${topbar(crumbs, actions)}
      <main style="flex:1;min-height:0;overflow:hidden;${mainStyle}">
${main}
      </main>
    </div>
  </div>`;
}
