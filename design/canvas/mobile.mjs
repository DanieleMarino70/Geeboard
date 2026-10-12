import { ic, pill, badge, meter, avatar, cover, cardSt, label, tiny } from './lib.mjs';

/* Phone artboards. No painted status bar and no painted keyboard —
   on a real device the OS draws both on top of this layout. */

function phone(caption, note, body) {
  return `<div style="display:flex;flex-direction:column;gap:14px;flex:none">
      <div>
        <div style="font-size:13px;font-weight:600;letter-spacing:-0.01em">${caption}</div>
        <div style="font-family:var(--mono);font-size:10px;color:var(--ink-4);margin-top:5px">${note}</div>
      </div>
      <div style="width:390px;height:844px;border-radius:28px;border:1px solid var(--border-2);background:var(--bg);overflow:hidden;position:relative;box-shadow:var(--shadow-3)">
${body}
      </div>
    </div>`;
}

function tabBar(active) {
  const items = [['Home', 'grid'], ['Servers', 'server'], ['Console', 'terminal'], ['Stats', 'chart'], ['More', 'settings']];
  return `        <nav aria-label="Primary" style="position:absolute;left:0;right:0;bottom:0;display:flex;gap:4px;background:var(--glass);backdrop-filter:blur(18px) saturate(150%);border-top:1px solid var(--border);padding:8px 8px 16px">
          ${items.map(([t, i]) => {
            const on = t === active;
            return `<button type="button" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:8px 4px;border-radius:12px;min-height:48px;color:${on ? 'var(--accent)' : 'var(--ink-4)'};background:${on ? 'var(--accent-soft)' : 'transparent'}">
            ${ic(i, 20)}
            <span style="font-size:10px;font-weight:${on ? '500' : '400'}">${t}</span>
          </button>`;
          }).join('\n          ')}
        </nav>`;
}

function mHeader(title, sub, right) {
  return `        <header style="display:flex;align-items:center;gap:12px;padding:20px 20px 14px;border-bottom:1px solid var(--border);background:var(--bg-2)">
          <div style="min-width:0;flex:1">
            <div style="font-size:19px;font-weight:600;letter-spacing:-0.025em;line-height:1.2">${title}</div>
            ${sub ? `<div style="font-size:12px;color:var(--ink-4);margin-top:4px">${sub}</div>` : ''}
          </div>
          ${right}
        </header>`;
}

function mDashboard() {
  const stats = [['Servers', '3', 'of 4'], ['Players', '41', 'peak 58'], ['Median TPS', '19.8', 'of 20'], ['Storage', '412', 'GB of 750']]
    .map(([k, v, u]) => `<div style="${cardSt};padding:16px">
              <div style="${label};font-size:9.5px;margin-bottom:10px">${k}</div>
              <div style="display:flex;align-items:flex-end;gap:6px">
                <span style="font-size:24px;font-weight:600;letter-spacing:-0.03em;line-height:1;font-variant-numeric:tabular-nums">${v}</span>
                <span style="font-size:11px;color:var(--ink-4);padding-bottom:2px">${u}</span>
              </div>
            </div>`).join('\n            ');

  const servers = [
    ['Aurora SMP', '1.21.4 · Paper', 'Running', 'success', false, '23 / 40', 34, 62],
    ['Nightfall PvP', '1.20.6 · Purpur', 'Starting', 'warning', true, '0 / 80', 71, 44],
    ['Ashfold Creative', '1.21.4 · Fabric', 'Running', 'success', false, '18 / 60', 22, 48]
  ].map(([n, tag, state, tone, pulse, players, cpu, ram]) => `<div style="${cardSt};padding:15px;display:flex;gap:12px;align-items:center">
              ${cover('ART', 42, 11)}
              <div style="min-width:0;flex:1">
                <div style="font-size:14px;font-weight:600;letter-spacing:-0.015em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n}</div>
                <div style="font-family:var(--mono);font-size:10px;color:var(--ink-4);margin-top:3px">${tag}</div>
                <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
                  ${pill(state, tone, pulse)}
                  <span style="font-family:var(--mono);font-size:10px;color:var(--ink-3)">${players}</span>
                </div>
              </div>
              <div style="width:52px;flex:none;display:flex;flex-direction:column;gap:7px">
                <div><div style="font-family:var(--mono);font-size:8.5px;color:var(--ink-4);margin-bottom:4px">CPU ${cpu}%</div>${meter(cpu, 'var(--accent)', 3)}</div>
                <div><div style="font-family:var(--mono);font-size:8.5px;color:var(--ink-4);margin-bottom:4px">RAM ${ram}%</div>${meter(ram, 'var(--info)', 3)}</div>
              </div>
            </div>`).join('\n            ');

  const body = `${mHeader('Good afternoon', 'Mara · Ashfold', `<button type="button" aria-label="Notifications" style="width:44px;height:44px;border-radius:12px;display:grid;place-items:center;color:var(--ink-3);background:var(--card);border:1px solid var(--border);flex:none;position:relative">${ic('bell', 18)}<span style="position:absolute;top:11px;right:12px;width:6px;height:6px;border-radius:50%;background:var(--accent)"></span></button>`)}
        <div style="position:absolute;left:0;right:0;top:99px;bottom:80px;overflow:hidden;padding:16px 20px 0;display:flex;flex-direction:column;gap:16px">
          <button type="button" style="display:flex;align-items:center;gap:10px;width:100%;padding:13px 14px;border-radius:12px;border:1px solid var(--border);background:var(--card);color:var(--ink-4);font-size:14px;min-height:48px">
            ${ic('search', 17, 1.9)}<span style="flex:1;text-align:left">Search or jump…</span>
          </button>
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">
            ${stats}
          </div>
          <div style="display:flex;align-items:baseline;gap:10px">
            <h2 style="margin:0;font-size:14px;font-weight:600">Your servers</h2>
            <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-4);margin-left:auto">3 of 4 up</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:12px">
            ${servers}
          </div>
        </div>
${tabBar('Home')}`;

  return phone('Dashboard', '390 × 844 · bottom bar replaces the sidebar', body);
}

function mServer() {
  const actions = [['Restart', 'restart', false], ['Stop', 'stop', true], ['Back up', 'archive', false], ['Console', 'terminal', false]]
    .map(([t, i, danger]) => `<button type="button" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;padding:12px 4px;border-radius:12px;min-height:64px;border:1px solid ${danger ? 'hsl(4 78% 60% / .3)' : 'var(--border)'};background:${danger ? 'var(--danger-soft)' : 'var(--card)'};color:${danger ? 'var(--danger)' : 'var(--ink-2)'}">
              ${ic(i, 19)}<span style="font-size:11px;font-weight:500">${t}</span>
            </button>`).join('\n            ');

  const facts = [['Node', 'fra-node-02'], ['Address', 'aurora.ashfold.gg'], ['Version', 'Paper 1.21.4'], ['Uptime', '6 d 14 h']]
    .map(([k, v]) => `<div style="display:flex;align-items:baseline;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)">
              <span style="font-size:12.5px;color:var(--ink-4);flex:none;width:84px">${k}</span>
              <span style="font-family:var(--mono);font-size:12.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v}</span>
            </div>`).join('\n            ');

  const body = `        <header style="display:flex;align-items:center;gap:12px;padding:16px 16px 14px;border-bottom:1px solid var(--border);background:var(--bg-2)">
          <button type="button" aria-label="Back" style="width:44px;height:44px;border-radius:12px;display:grid;place-items:center;color:var(--ink-2);flex:none">${ic('left', 20, 2)}</button>
          <span style="font-size:14px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Aurora SMP</span>
          <button type="button" aria-label="Server actions" style="width:44px;height:44px;border-radius:12px;display:grid;place-items:center;color:var(--ink-3);flex:none">${ic('dots', 20)}</button>
        </header>
        <div style="position:absolute;left:0;right:0;top:75px;bottom:80px;overflow:hidden;padding:18px 20px 0;display:flex;flex-direction:column;gap:18px">
          <div style="display:flex;gap:14px;align-items:center">
            ${cover('MC<br>ART', 56, 14)}
            <div style="min-width:0;flex:1">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                ${pill('Running', 'success')}
                <span style="font-family:var(--mono);font-size:11px;color:var(--ink-3)">23 / 40 online</span>
              </div>
              <div style="font-family:var(--mono);font-size:11px;color:var(--ink-4);margin-top:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">aurora.ashfold.gg:25565</div>
            </div>
          </div>

          <div style="display:flex;gap:10px">
            ${actions}
          </div>

          <div style="${cardSt};padding:16px">
            <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:14px">
              <h2 style="margin:0;font-size:13px;font-weight:600">Last hour</h2>
              <span style="margin-left:auto;display:flex;gap:12px">
                <span style="display:flex;align-items:center;gap:5px;font-family:var(--mono);font-size:9.5px;color:var(--ink-3)"><span style="width:7px;height:2px;border-radius:2px;background:var(--accent)"></span>CPU 34%</span>
                <span style="display:flex;align-items:center;gap:5px;font-family:var(--mono);font-size:9.5px;color:var(--ink-3)"><span style="width:7px;height:2px;border-radius:2px;background:var(--info)"></span>5.0 GB</span>
              </span>
            </div>
            <svg viewBox="0 0 300 96" preserveAspectRatio="none" role="img" aria-label="CPU and memory over the last hour" style="width:100%;height:96px;display:block">
              <defs><linearGradient id="mFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(80 72% 60%)" stop-opacity=".24"/><stop offset="1" stop-color="hsl(80 72% 60%)" stop-opacity="0"/></linearGradient></defs>
              ${[24, 48, 72].map(y => `<line x1="0" y1="${y}" x2="300" y2="${y}" stroke="var(--border)" stroke-width="1"/>`).join('')}
              <polygon points="0,96 0,68 30,62 60,66 90,48 120,54 150,38 180,44 210,28 240,34 270,20 300,26 300,96" fill="url(#mFill)"/>
              <polyline points="0,68 30,62 60,66 90,48 120,54 150,38 180,44 210,28 240,34 270,20 300,26" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
              <polyline points="0,54 30,52 60,50 90,47 120,48 150,44 180,45 210,41 240,42 270,38 300,39" fill="none" stroke="var(--info)" stroke-width="2" stroke-dasharray="4 4" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
            </svg>
          </div>

          <div style="${cardSt};padding:4px 16px 8px">
            ${facts}
          </div>
        </div>
${tabBar('Servers')}`;

  return phone('Server detail', 'quick actions become a 4-up row of 64px targets', body);
}

function mConsole() {
  const LVL = {
    INFO: ['var(--con-dim)', 'var(--con-ink)'],
    WARN: ['var(--warning)', 'var(--warning)'],
    ERROR: ['var(--danger)', 'var(--danger)'],
    JOIN: ['var(--info)', 'var(--con-ink)'],
    CMD: ['var(--accent)', 'var(--accent)']
  };
  const lines = [
    ['14:22:16', 'INFO', 'Done (11.482s)! For help, type "help"'],
    ['14:23:58', 'JOIN', 'kestrelbay joined the game (22 online)'],
    ['14:24:31', 'JOIN', 'thornfield joined the game (23 online)'],
    ['14:25:02', 'CMD', '/whitelist add lumen_verd'],
    ['14:25:03', 'INFO', 'Added lumen_verd to the whitelist'],
    ['14:25:44', 'WARN', "Can't keep up! Running 2481ms behind"],
    ['14:25:47', 'ERROR', 'Chunk file at [-12,41] is missing block state palette'],
    ['14:26:03', 'INFO', 'Autosave complete · 1.2 GB written in 840ms'],
    ['14:26:19', 'INFO', 'mirefen left the game (22 online)'],
    ['14:26:40', 'INFO', 'Watchdog: tick time back within budget (48.2ms)'],
    ['14:27:02', 'JOIN', 'saltmarch joined the game (23 online)'],
    ['14:27:31', 'INFO', 'Saving chunks for level \'aurora\'']
  ].map(([t, lvl, msg]) => {
    const [lc, mc] = LVL[lvl];
    return `<div style="padding:4px 0">
              <div style="display:flex;gap:9px;align-items:baseline">
                <span style="color:var(--con-dim);flex:none;font-size:9.5px">${t}</span>
                <span style="color:${lc};flex:none;font-size:9.5px;letter-spacing:.04em">${lvl}</span>
              </div>
              <div style="color:${mc};font-size:11.5px;line-height:1.6;margin-top:2px">${msg}</div>
            </div>`;
  }).join('\n            ');

  const body = `        <header style="display:flex;align-items:center;gap:12px;padding:16px 16px 14px;border-bottom:1px solid var(--border);background:var(--bg-2)">
          <button type="button" aria-label="Back" style="width:44px;height:44px;border-radius:12px;display:grid;place-items:center;color:var(--ink-2);flex:none">${ic('left', 20, 2)}</button>
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:600">Console</div>
            <div style="font-family:var(--mono);font-size:10px;color:var(--ink-4);margin-top:2px">Aurora SMP</div>
          </div>
          <button type="button" aria-label="Pause auto-scroll" style="width:44px;height:44px;border-radius:12px;display:grid;place-items:center;color:var(--ink-3);flex:none">${ic('pause', 19)}</button>
          <button type="button" aria-label="Console settings" style="width:44px;height:44px;border-radius:12px;display:grid;place-items:center;color:var(--ink-3);flex:none">${ic('sliders', 19)}</button>
        </header>
        <div style="position:absolute;left:0;right:0;top:75px;bottom:88px;overflow:hidden;background:var(--con-bg);display:flex;flex-direction:column">
          <div style="display:flex;align-items:center;gap:8px;padding:9px 16px;border-bottom:1px solid var(--border);background:var(--bg-2);flex:none">
            <span style="font-family:var(--mono);font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-4)">stdout</span>
            <span style="margin-left:auto;display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:9.5px;color:var(--success)"><span style="width:5px;height:5px;border-radius:50%;background:currentColor;animation:gbPulse 2.2s ease-out infinite"></span>streaming</span>
          </div>
          <div style="flex:1;min-height:0;overflow:hidden;padding:12px 16px;font-family:var(--mono)">
            ${lines}
          </div>
        </div>
        <div style="position:absolute;left:0;right:0;bottom:0;padding:10px 16px 20px;background:var(--glass);backdrop-filter:blur(18px) saturate(150%);border-top:1px solid var(--border)">
          <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:12px;background:var(--bg);border:1px solid var(--accent-line);min-height:48px">
            <span style="font-family:var(--mono);font-size:13px;color:var(--accent);flex:none">&gt;</span>
            <span style="flex:1;font-family:var(--mono);font-size:13px;color:var(--ink-4)">Send a command…</span>
            <button type="button" aria-label="Send" style="width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:var(--accent);color:var(--accent-ink);flex:none">${ic('send', 15, 2)}</button>
          </div>
        </div>`;

  return phone('Console', 'command bar pins above the OS keyboard, never behind it', body);
}

export function mobile() {
  return `<div style="width:1360px;background:var(--bg);padding:44px 40px 48px;display:flex;flex-direction:column;gap:32px">
    <header style="display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;align-items:center;gap:11px">
        <div style="width:30px;height:30px;border-radius:9px;background:var(--accent);display:grid;place-items:center;flex:none;color:var(--accent-ink);box-shadow:0 0 0 1px var(--accent-line),0 8px 24px -10px var(--accent)">${ic('zap', 17, 2.4)}</div>
        <div>
          <div style="font-size:14px;font-weight:600;letter-spacing:-0.01em">Geeboard</div>
          <div style="font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-4)">design system · v3.2</div>
        </div>
        <span style="margin-left:auto;font-family:var(--mono);font-size:10.5px;color:var(--accent)">06 · responsive</span>
      </div>
      <div>
        <h1 style="margin:0;font-size:40px;font-weight:600;letter-spacing:-0.04em;line-height:1.05">Mobile</h1>
        <p style="margin:16px 0 0;font-size:14.5px;color:var(--ink-2);line-height:1.65;max-width:72ch">Below 900px the panel is not a narrower desktop. The sidebar becomes a five-item bottom bar, cards become full-width rows, tables collapse to stacked key–value blocks, and the console gets its own full-height route with the command bar pinned above the keyboard. Every tap target is at least 44px.</p>
      </div>
    </header>
    <div style="display:flex;gap:44px;align-items:flex-start">
      ${mDashboard()}
      ${mServer()}
      ${mConsole()}
    </div>
  </div>`;
}
