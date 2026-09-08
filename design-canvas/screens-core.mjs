import { ic, pill, badge, btn, meter, avatar, cover, cardSt, label, tiny } from './lib.mjs';
import { screen } from './chrome.mjs';

/* ── shared fragments ──────────────────────────────────────────── */

function statCard({ icon, name, value, unit, delta, deltaTone, sub }) {
  const tone = { up: ['var(--success)', 'var(--success-soft)'], down: ['var(--danger)', 'var(--danger-soft)'], flat: ['var(--ink-3)', 'var(--card-2)'] }[deltaTone];
  return `<div style="${cardSt};padding:20px;transition:border-color .18s,transform .18s cubic-bezier(.2,.7,.3,1)" style-hover="border-color:var(--border-2);transform:translateY(-2px)">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
              <span style="color:var(--ink-4);display:grid;place-items:center">${ic(icon, 14)}</span>
              <span style="${label}">${name}</span>
            </div>
            <div style="display:flex;align-items:flex-end;gap:8px">
              <div style="font-size:30px;font-weight:600;letter-spacing:-0.03em;line-height:1;font-variant-numeric:tabular-nums">${value}</div>
              <div style="font-size:12px;color:var(--ink-4);padding-bottom:3px">${unit}</div>
            </div>
            <div style="margin-top:12px;display:flex;align-items:center;gap:7px">
              <span style="font-family:var(--mono);font-size:10.5px;padding:2px 6px;border-radius:5px;color:${tone[0]};background:${tone[1]}">${delta}</span>
              <span style="font-size:11.5px;color:var(--ink-4)">${sub}</span>
            </div>
          </div>`;
}

function spark(points, color, id) {
  return `<svg viewBox="0 0 120 28" preserveAspectRatio="none" aria-hidden="true" style="width:100%;height:28px;display:block">
                  <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
                  <path d="M0 28 ${points} L120 28 Z" fill="url(#${id})"/>
                  <path d="M${points.slice(1)}" fill="none" stroke="${color}" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>
                </svg>`;
}

function serverCard({ name, tag, art, state, tone, pulse, players, cpu, ram, disk, spk, spkColor, id, addr }) {
  return `<div style="${cardSt};overflow:hidden;transition:border-color .18s,transform .18s cubic-bezier(.2,.7,.3,1)" style-hover="border-color:var(--border-2);transform:translateY(-2px)">
              <div style="padding:18px;display:flex;gap:13px;align-items:flex-start">
                ${cover(art)}
                <div style="min-width:0;flex:1">
                  <div style="display:flex;align-items:center;gap:8px">
                    <div style="font-size:14.5px;font-weight:600;letter-spacing:-0.015em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</div>
                  </div>
                  <div style="font-family:var(--mono);font-size:10px;color:var(--ink-4);margin-top:4px">${tag}</div>
                  <div style="display:flex;align-items:center;gap:7px;margin-top:9px">
                    ${pill(state, tone, pulse)}
                    <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-3)">${players}</span>
                  </div>
                </div>
                <button type="button" aria-label="Server actions" style="width:26px;height:26px;border-radius:7px;display:grid;place-items:center;color:var(--ink-4);flex:none;transition:background .15s,color .15s" style-hover="background:var(--card-2);color:var(--ink)">${ic('dots', 15)}</button>
              </div>
              <div style="padding:0 18px 12px">${spark(spk, spkColor, id)}</div>
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--border);border-top:1px solid var(--border)">
                ${[['CPU', cpu, 'var(--accent)'], ['RAM', ram, 'var(--info)'], ['DISK', disk, 'var(--ink-4)']].map(([k, v, c]) => `<div style="background:var(--card);padding:11px 13px">
                  <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="font-family:var(--mono);font-size:9px;letter-spacing:.07em;text-transform:uppercase;color:var(--ink-4)">${k}</span><span style="font-family:var(--mono);font-size:10px;color:var(--ink-2)">${v}%</span></div>
                  ${meter(v, c, 3)}
                </div>`).join('\n                ')}
              </div>
              <div style="padding:10px 18px;border-top:1px solid var(--border);background:var(--bg-2);display:flex;align-items:center;gap:8px">
                <span style="font-family:var(--mono);font-size:10px;color:var(--ink-4);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${addr}</span>
                <span style="display:flex;gap:4px">
                  ${['restart', 'stop', 'terminal'].map(i => `<button type="button" aria-label="${i}" style="width:24px;height:24px;border-radius:6px;display:grid;place-items:center;color:var(--ink-4);transition:background .15s,color .15s" style-hover="background:var(--card-2);color:var(--ink)">${ic(i, 13)}</button>`).join('')}
                </span>
              </div>
            </div>`;
}

/* ── 1 · Dashboard ─────────────────────────────────────────────── */

export function dashboard() {
  const stats = [
    statCard({ icon: 'server', name: 'Servers online', value: '3', unit: 'of 4', delta: 'stable', deltaTone: 'flat', sub: '7 days without an incident' }),
    statCard({ icon: 'users', name: 'Players now', value: '41', unit: 'peak 58', delta: '+21%', deltaTone: 'up', sub: 'vs last Saturday' }),
    statCard({ icon: 'activity', name: 'Median TPS', value: '19.8', unit: 'of 20', delta: '−0.1', deltaTone: 'flat', sub: 'across every running world' }),
    statCard({ icon: 'drive', name: 'Storage used', value: '412', unit: 'GB of 750', delta: '+18 GB', deltaTone: 'down', sub: 'snapshots take 61% of it' })
  ].join('\n          ');

  const servers = [
    serverCard({ name: 'Aurora SMP', tag: '1.21.4 · Paper', art: 'MC<br>ART', state: 'Running', tone: 'success', pulse: false, players: '23 / 40', cpu: 34, ram: 62, disk: 41, spk: 'L0 21 L12 19 L24 22 L36 14 L48 17 L60 11 L72 13 L84 8 L96 12 L108 7 L120 9', spkColor: 'hsl(80 72% 60%)', id: 'sp1', addr: 'aurora.ashfold.gg:25565' }),
    serverCard({ name: 'Nightfall PvP', tag: '1.20.6 · Purpur', art: 'MC<br>ART', state: 'Starting', tone: 'warning', pulse: true, players: '0 / 80', cpu: 71, ram: 44, disk: 28, spk: 'L0 26 L12 25 L24 24 L36 22 L48 18 L60 15 L72 16 L84 11 L96 9 L108 6 L120 5', spkColor: 'hsl(38 94% 58%)', id: 'sp2', addr: 'pvp.ashfold.gg:25566' }),
    serverCard({ name: 'Ashfold Creative', tag: '1.21.4 · Fabric', art: 'MC<br>ART', state: 'Running', tone: 'success', pulse: false, players: '18 / 60', cpu: 22, ram: 48, disk: 66, spk: 'L0 18 L12 20 L24 17 L36 19 L48 16 L60 18 L72 15 L84 17 L96 14 L108 16 L120 13', spkColor: 'hsl(80 72% 60%)', id: 'sp3', addr: 'build.ashfold.gg:25567' }),
    serverCard({ name: 'Wipe Wednesday', tag: '2024.11 · Rust', art: 'RUST<br>ART', state: 'Stopped', tone: 'muted', pulse: false, players: '— / 120', cpu: 0, ram: 0, disk: 54, spk: 'L0 24 L12 24 L24 24 L36 24 L48 24 L60 24 L72 24 L84 24 L96 24 L108 24 L120 24', spkColor: 'hsl(228 10% 56%)', id: 'sp4', addr: 'rust.ashfold.gg:28015' })
  ].join('\n            ');

  const activity = [
    ['thornfield', 'joined Aurora SMP', '2 min ago', 'var(--info)'],
    ['Scheduler', 'ran the nightly backup', '38 min ago', 'var(--accent)'],
    ['Mara', 'raised the heap ceiling to 8 GB', '1 h ago', 'var(--ink-4)']
  ].map(([who, what, when, c], i, arr) => `<div style="display:flex;gap:13px;padding-bottom:${i === arr.length - 1 ? '0' : '12px'}">
                <div style="position:relative;flex:none;width:9px;display:flex;justify-content:center;padding-top:5px">
                  <span style="width:7px;height:7px;border-radius:50%;background:${c};z-index:1;flex:none;box-shadow:0 0 0 3px var(--card)"></span>
                  ${i === arr.length - 1 ? '' : '<span style="position:absolute;top:12px;bottom:-12px;width:1px;background:var(--border)"></span>'}
                </div>
                <div style="min-width:0;flex:1">
                  <div style="font-size:12.5px;line-height:1.45;color:var(--ink-2)"><span style="font-weight:500;color:var(--ink)">${who}</span> ${what}</div>
                  <div style="font-family:var(--mono);font-size:10px;color:var(--ink-4);margin-top:3px">${when}</div>
                </div>
              </div>`).join('\n              ');

  const nodes = [
    ['fra-node-02', 'Frankfurt', '14 ms', 48, 61, 'success', false],
    ['ash-node-01', 'Ashburn', '92 ms', 33, 40, 'success', false],
    ['sgp-node-01', 'Singapore', '211 ms', 88, 91, 'warning', true]
  ].map(([n, city, ping, cpu, ram, tone, warn]) => `<div style="display:flex;flex-direction:column;gap:9px;padding:12px 0;border-bottom:1px solid var(--border)">
                <div style="display:flex;align-items:center;gap:9px">
                  <span style="width:6px;height:6px;border-radius:50%;background:var(--${tone});flex:none${warn ? ';animation:gbPulse 2.2s ease-out infinite;color:var(--warning)' : ''}"></span>
                  <span style="font-family:var(--mono);font-size:11.5px;font-weight:500">${n}</span>
                  <span style="font-size:11px;color:var(--ink-4)">${city}</span>
                  <span style="margin-left:auto;font-family:var(--mono);font-size:10.5px;color:var(--ink-3)">${ping}</span>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                  <div><div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:9.5px;color:var(--ink-4);margin-bottom:5px"><span>CPU</span><span style="color:var(--ink-2)">${cpu}%</span></div>${meter(cpu, cpu > 80 ? 'var(--warning)' : 'var(--accent)', 3)}</div>
                  <div><div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:9.5px;color:var(--ink-4);margin-bottom:5px"><span>RAM</span><span style="color:var(--ink-2)">${ram}%</span></div>${meter(ram, ram > 80 ? 'var(--warning)' : 'var(--accent)', 3)}</div>
                </div>
              </div>`).join('\n              ');

  const main = `        <div style="height:100%;overflow:hidden;padding:26px 32px;display:flex;flex-direction:column;gap:20px;position:relative">
          <div aria-hidden="true" style="position:absolute;top:-180px;right:-120px;width:520px;height:360px;border-radius:50%;background:radial-gradient(closest-side,var(--accent-soft),transparent);pointer-events:none"></div>

          <div style="display:flex;align-items:flex-end;gap:20px;flex:none;position:relative">
            <div style="min-width:0">
              <h1 style="margin:0;font-size:30px;font-weight:600;letter-spacing:-0.025em;line-height:1.1">Good afternoon, Mara</h1>
              <p style="margin:8px 0 0;font-size:13.5px;color:var(--ink-2);line-height:1.6">Three of four servers are up and holding 19.8 ticks per second. Singapore is the one to watch.</p>
            </div>
            <div style="margin-left:auto;display:flex;gap:8px;flex:none">
              ${btn('Import a server', 'secondary', 'md', 'download')}
              ${btn('Create server', 'primary', 'md', 'plus')}
            </div>
          </div>

          <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;flex:none;position:relative">
          ${stats}
          </div>

          <div style="display:grid;grid-template-columns:minmax(0,1fr) 348px;gap:16px;flex:1;min-height:0;position:relative">
            <div style="display:flex;flex-direction:column;gap:12px;min-height:0">
              <div style="display:flex;align-items:baseline;gap:12px;flex:none">
                <h2 style="margin:0;font-size:15px;font-weight:600;letter-spacing:-0.01em">Your servers</h2>
                <span style="font-family:var(--mono);font-size:11px;color:var(--ink-4)">4 total · 3 up</span>
                <a href="#" style="margin-left:auto;font-size:12.5px">Manage all</a>
              </div>
              <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-content:start">
            ${servers}
              </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:16px;min-height:0">
              <div style="${cardSt};padding:18px 20px;flex:1;min-height:0;display:flex;flex-direction:column">
                <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:16px;flex:none">
                  <h2 style="margin:0;font-size:13.5px;font-weight:600">Activity</h2>
                  <a href="#" style="margin-left:auto;font-size:11.5px">All events</a>
                </div>
                <div style="flex:1;min-height:0;overflow:hidden">
              ${activity}
                </div>
              </div>

              <div style="${cardSt};padding:20px;flex:none">
                <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:4px">
                  <h2 style="margin:0;font-size:13.5px;font-weight:600">Node health</h2>
                  <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-4);margin-left:auto">3 nodes</span>
                </div>
              ${nodes}
                <div style="display:flex;align-items:center;gap:8px;padding-top:12px">
                  <span style="width:20px;height:20px;border-radius:6px;display:grid;place-items:center;color:var(--warning);background:var(--warning-soft);flex:none">${ic('alert', 12, 2)}</span>
                  <span style="font-size:11.5px;color:var(--ink-3);line-height:1.45">Singapore at 91% memory — consider draining.</span>
                </div>
              </div>
            </div>
          </div>
        </div>`;

  return screen({
    active: 'Dashboard',
    crumbs: ['Ashfold', 'Dashboard'],
    main
  });
}

/* ── 2 · Server detail ─────────────────────────────────────────── */

export function serverDetail() {
  const tabs = ['Overview', 'Console', 'Files', 'Backups', 'Scheduler', 'Players', 'Plugins', 'Settings'];
  const tabBar = `<div role="tablist" style="display:flex;gap:2px;border-bottom:1px solid var(--border);flex:none;margin:0 -32px;padding:0 32px">
            ${tabs.map(t => {
              const on = t === 'Overview';
              return `<button type="button" role="tab" aria-selected="${on}" style="position:relative;padding:11px 15px 13px;font-size:12.5px;font-weight:${on ? '500' : '400'};color:${on ? 'var(--ink)' : 'var(--ink-3)'};transition:color .15s" style-hover="color:var(--ink-2)">${t}<span style="position:absolute;left:8px;right:8px;bottom:-1px;height:2px;border-radius:2px;background:${on ? 'var(--accent)' : 'transparent'}"></span></button>`;
            }).join('\n            ')}
          </div>`;

  const facts = [
    ['Node', 'fra-node-02', 'Frankfurt · 14 ms'],
    ['Address', 'aurora.ashfold.gg', 'port 25565'],
    ['Version', 'Paper 1.21.4', 'build 218'],
    ['Uptime', '6 d 14 h', 'since 2 Sep, 09:12'],
    ].map(([k, v, s]) => `<div style="padding:12px 0;border-bottom:1px solid var(--border)">
                <div style="${tiny};margin-bottom:6px">${k}</div>
                <div style="font-size:12.5px;font-weight:500">${v}</div>
                <div style="font-family:var(--mono);font-size:10px;color:var(--ink-4);margin-top:3px">${s}</div>
              </div>`).join('\n              ');

  // hour of CPU + memory, 600×170 viewBox as in the source prototype
  const cpuPts = '0,120 40,108 80,116 120,86 160,94 200,70 240,78 280,52 320,64 360,44 400,56 440,38 480,48 520,30 560,40 600,34';
  const ramPts = '0,96 40,92 80,88 120,84 160,86 200,78 240,80 280,72 320,74 360,66 400,68 440,60 480,62 520,56 560,58 600,54';

  const chart = `<div style="${cardSt};padding:20px;flex:1;min-height:0;display:flex;flex-direction:column">
              <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:2px;flex:none">
                <h2 style="margin:0;font-size:13.5px;font-weight:600">Resource usage</h2>
                <div style="display:flex;gap:14px;margin-left:auto;align-items:center">
                  <span style="display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:10px;color:var(--ink-3)"><span style="width:8px;height:2px;border-radius:2px;background:var(--accent)"></span>CPU 34%</span>
                  <span style="display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:10px;color:var(--ink-3)"><span style="width:8px;height:2px;border-radius:2px;background:var(--info)"></span>Memory 5.0 GB</span>
                  <div style="display:inline-flex;gap:1px;background:var(--border);border-radius:8px;padding:1px">
                    ${['1h', '6h', '24h', '7d'].map(t => `<button type="button" style="padding:4px 10px;border-radius:7px;font-family:var(--mono);font-size:10px;background:${t === '1h' ? 'var(--card-2)' : 'transparent'};color:${t === '1h' ? 'var(--ink)' : 'var(--ink-4)'};transition:background .15s,color .15s">${t}</button>`).join('')}
                  </div>
                </div>
              </div>
              <div style="flex:1;min-height:0;position:relative;margin-top:12px">
                <svg viewBox="0 0 600 170" preserveAspectRatio="none" role="img" aria-label="CPU and memory over the last hour" style="width:100%;height:100%;display:block">
                  <defs>
                    <linearGradient id="cpuFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(80 72% 60%)" stop-opacity=".22"/><stop offset="1" stop-color="hsl(80 72% 60%)" stop-opacity="0"/></linearGradient>
                  </defs>
                  ${[34, 68, 102, 136].map(y => `<line x1="0" y1="${y}" x2="600" y2="${y}" stroke="var(--border)" stroke-width="1"/>`).join('')}
                  <polygon points="0,170 ${cpuPts} 600,170" fill="url(#cpuFill)"/>
                  <polyline points="${cpuPts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
                  <polyline points="${ramPts}" fill="none" stroke="var(--info)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>
                  <circle cx="600" cy="34" r="3.5" fill="var(--accent)"/>
                </svg>
              </div>
              <div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:9.5px;color:var(--ink-4);margin-top:8px;flex:none">
                ${['14:00', '14:12', '14:24', '14:36', '14:48', 'now'].map(t => `<span>${t}</span>`).join('')}
              </div>
            </div>`;

  const consolePreview = `<div style="background:var(--con-bg);border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden;flex:none;display:flex;flex-direction:column">
              <div style="display:flex;align-items:center;gap:9px;padding:10px 16px;border-bottom:1px solid var(--border);background:var(--bg-2)">
                <span style="color:var(--ink-4);display:grid;place-items:center">${ic('terminal', 14)}</span>
                <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-3)">console · tail</span>
                <span style="margin-left:auto;display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:9.5px;color:var(--success)"><span style="width:5px;height:5px;border-radius:50%;background:currentColor;animation:gbPulse 2.2s ease-out infinite"></span>live</span>
                <a href="#" style="font-size:11px">Open console</a>
              </div>
              <div style="padding:12px 16px;font-family:var(--mono);font-size:11px;line-height:1.85;color:var(--con-ink)">
                ${[
                  ['14:24:31', 'JOIN', 'thornfield joined the game (23 online)', 'var(--info)', 'var(--con-ink)'],
                  ['14:25:02', 'CMD', '/whitelist add lumen_verd', 'var(--accent)', 'var(--accent)'],
                  ['14:25:44', 'WARN', "Can't keep up! Running 2481ms behind", 'var(--warning)', 'var(--warning)'],
                  ['14:26:03', 'INFO', 'Autosave complete · 1.2 GB written in 840ms', 'var(--con-dim)', 'var(--con-ink)']
                ].map(([t, lvl, msg, lc, mc]) => `<div style="display:flex;gap:12px">
                  <span style="color:var(--con-dim);flex:none;font-size:10.5px;padding-top:1px">${t}</span>
                  <span style="color:${lc};flex:none;width:46px;font-size:10.5px;letter-spacing:.04em">${lvl}</span>
                  <span style="color:${mc};min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${msg}</span>
                </div>`).join('\n                ')}
              </div>
            </div>`;

  const players = ['thornfield', 'lumen_verd', 'kestrelbay', 'oakhollow'].map((p, i) => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0${i === 3 ? '' : ';border-bottom:1px solid var(--border)'}">
                ${cover('SKIN', 24, 6)}
                <span style="font-family:var(--mono);font-size:11.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p}</span>
                <span style="font-family:var(--mono);font-size:10px;color:var(--ink-4)">${[14, 41, 8, 122][i]} ms</span>
              </div>`).join('\n              ');

  const backups = [
    ['daily-09-07', '3.4 GB', '2 h ago', 'success'],
    ['daily-09-06', '3.3 GB', '1 d ago', 'success'],
    ['pre-update', '3.1 GB', '4 d ago', 'muted']
  ].map(([n, s, w, tone], i) => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0${i === 2 ? '' : ';border-bottom:1px solid var(--border)'}">
                <span style="width:5px;height:5px;border-radius:50%;background:var(--${tone === 'success' ? 'success' : 'ink-4'});flex:none"></span>
                <span style="font-family:var(--mono);font-size:11.5px;flex:1;min-width:0">${n}</span>
                <span style="font-family:var(--mono);font-size:10px;color:var(--ink-4)">${s}</span>
                <span style="font-size:10.5px;color:var(--ink-4);width:52px;text-align:right">${w}</span>
              </div>`).join('\n              ');

  const main = `        <div style="height:100%;overflow:hidden;padding:22px 32px 26px;display:flex;flex-direction:column;gap:16px">
          <div style="display:flex;align-items:flex-start;gap:16px;flex:none">
            ${cover('MC<br>ART', 52, 13)}
            <div style="min-width:0">
              <div style="display:flex;align-items:center;gap:10px">
                <h1 style="margin:0;font-size:26px;font-weight:600;letter-spacing:-0.025em">Aurora SMP</h1>
                ${pill('Running', 'success')}
              </div>
              <div style="display:flex;align-items:center;gap:14px;margin-top:8px;font-family:var(--mono);font-size:11px;color:var(--ink-4)">
                <span style="display:flex;align-items:center;gap:6px">${ic('globe', 13)}aurora.ashfold.gg:25565</span>
                <span style="display:flex;align-items:center;gap:6px">${ic('cpu', 13)}fra-node-02</span>
                <span style="display:flex;align-items:center;gap:6px">${ic('clock', 13)}up 6 d 14 h</span>
                <span style="display:flex;align-items:center;gap:6px">${ic('users', 13)}23 / 40 online</span>
              </div>
            </div>
            <div style="margin-left:auto;display:flex;gap:8px;flex:none">
              ${btn('Restart', 'secondary', 'md', 'restart')}
              ${btn('Stop', 'destructive', 'md', 'stop')}
              ${btn('Back up now', 'primary', 'md', 'archive')}
            </div>
          </div>

          ${tabBar}

          <div style="display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:16px;flex:1;min-height:0">
            <div style="display:flex;flex-direction:column;gap:16px;min-height:0">
              ${chart}
              ${consolePreview}
            </div>
            <div style="display:flex;flex-direction:column;gap:16px;min-height:0;overflow:hidden">
              <div style="${cardSt};padding:18px 20px;flex:none">
                <h2 style="margin:0 0 2px;font-size:13.5px;font-weight:600">Details</h2>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 18px">
              ${facts}
                </div>
              </div>
              <div style="${cardSt};padding:18px 20px;flex:none">
                <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:4px">
                  <h2 style="margin:0;font-size:13.5px;font-weight:600">Players online</h2>
                  <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-4);margin-left:auto">23</span>
                </div>
              ${players}
              </div>
              <div style="${cardSt};padding:18px 20px;flex:none">
                <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:4px">
                  <h2 style="margin:0;font-size:13.5px;font-weight:600">Recent backups</h2>
                  <a href="#" style="margin-left:auto;font-size:11.5px">All</a>
                </div>
              ${backups}
              </div>
            </div>
          </div>
        </div>`;

  return screen({ active: 'Servers', crumbs: ['Ashfold', 'Servers', 'Aurora SMP'], main });
}

/* ── 3 · Console ───────────────────────────────────────────────── */

export function consoleScreen() {
  const LVL = {
    INFO: ['var(--con-dim)', 'var(--con-ink)'],
    WARN: ['var(--warning)', 'var(--warning)'],
    ERROR: ['var(--danger)', 'var(--danger)'],
    JOIN: ['var(--info)', 'var(--con-ink)'],
    LEFT: ['var(--info)', 'var(--con-dim)'],
    CMD: ['var(--accent)', 'var(--accent)'],
    CHAT: ['var(--ink-3)', 'var(--con-ink)']
  };
  const lines = [
    ['14:22:04', 'INFO', 'Starting minecraft server version 1.21.4'],
    ['14:22:05', 'INFO', 'Loading properties · level-name=aurora, view-distance=10'],
    ['14:22:09', 'INFO', 'Preparing spawn area: 84%'],
    ['14:22:16', 'INFO', 'Done (11.482s)! For help, type "help"'],
    ['14:23:58', 'JOIN', 'kestrelbay joined the game (22 online)'],
    ['14:24:31', 'JOIN', 'thornfield joined the game (23 online)'],
    ['14:24:47', 'CHAT', '&lt;thornfield&gt; anyone got spare netherite'],
    ['14:25:02', 'CMD', '/whitelist add lumen_verd'],
    ['14:25:03', 'INFO', 'Added lumen_verd to the whitelist'],
    ['14:25:44', 'WARN', "Can't keep up! Running 2481ms behind — did the system time change?"],
    ['14:25:47', 'ERROR', 'Chunk file at [-12,41] is missing block state palette'],
    ['14:25:48', 'WARN', 'Region file r.-1.2.mca will be regenerated on next save'],
    ['14:26:03', 'INFO', 'Autosave complete · 1.2 GB written in 840ms'],
    ['14:26:19', 'LEFT', 'mirefen left the game (22 online)'],
    ['14:26:40', 'INFO', 'Watchdog: tick time back within budget (48.2ms)']
  ].map(([t, lvl, msg]) => {
    const [lc, mc] = LVL[lvl];
    return `<div style="display:flex;gap:14px;padding:1px 0;border-radius:4px;transition:background .12s" style-hover="background:hsl(230 20% 12% / .6)">
                  <span style="color:var(--con-dim);flex:none;font-size:10.5px;padding-top:2px;width:56px">${t}</span>
                  <span style="color:${lc};flex:none;width:46px;font-size:10.5px;letter-spacing:.04em;padding-top:1px">${lvl}</span>
                  <span style="color:${mc};min-width:0;flex:1">${msg}</span>
                </div>`;
  }).join('\n                ');

  const filters = ['All', 'Info', 'Warn', 'Error', 'Chat', 'Commands'];

  const main = `        <div style="height:100%;overflow:hidden;padding:22px 32px 26px;display:flex;flex-direction:column;gap:14px">
          <div style="display:flex;align-items:center;gap:14px;flex:none">
            <div style="min-width:0">
              <h1 style="margin:0;font-size:24px;font-weight:600;letter-spacing:-0.025em">Console</h1>
              <div style="display:flex;align-items:center;gap:10px;margin-top:6px">
                <span style="font-family:var(--mono);font-size:11px;color:var(--ink-4)">Aurora SMP · fra-node-02</span>
                ${pill('Attached', 'success')}
              </div>
            </div>
            <div style="margin-left:auto;display:flex;gap:8px;flex:none">
              ${btn('Split view', 'secondary', 'sm', 'sidebar')}
              ${btn('Download log', 'secondary', 'sm', 'download')}
              ${btn('Restart', 'secondary', 'sm', 'restart')}
              ${btn('Stop', 'destructive', 'sm', 'stop')}
            </div>
          </div>

          <div style="display:flex;align-items:center;gap:10px;flex:none">
            <div style="display:flex;align-items:center;gap:8px;padding:7px 11px;border-radius:9px;background:var(--bg-2);border:1px solid var(--border);width:280px">
              <span style="color:var(--ink-4);display:grid;place-items:center;flex:none">${ic('search', 14, 1.9)}</span>
              <span style="flex:1;font-family:var(--mono);font-size:11px;color:var(--ink-2)">chunk</span>
              <span style="font-family:var(--mono);font-size:9.5px;color:var(--ink-4);flex:none">2 / 2</span>
            </div>
            <div style="display:inline-flex;gap:1px;background:var(--border);border-radius:9px;padding:1px">
              ${filters.map(f => `<button type="button" style="padding:6px 12px;border-radius:8px;font-size:11.5px;background:${f === 'All' ? 'var(--card-2)' : 'transparent'};color:${f === 'All' ? 'var(--ink)' : 'var(--ink-3)'};transition:background .15s,color .15s" style-hover="color:var(--ink-2)">${f}</button>`).join('\n              ')}
            </div>
            <div style="margin-left:auto;display:flex;align-items:center;gap:4px">
              ${[['pause', 'Pause auto-scroll'], ['copy', 'Copy visible'], ['trash', 'Clear'], ['sliders', 'Console settings']].map(([i, t]) => `<button type="button" aria-label="${t}" title="${t}" style="width:29px;height:29px;border-radius:8px;display:grid;place-items:center;color:var(--ink-4);transition:background .15s,color .15s" style-hover="background:var(--card-2);color:var(--ink)">${ic(i, 15)}</button>`).join('\n              ')}
            </div>
          </div>

          <div style="flex:1;min-height:0;display:flex;flex-direction:column;background:var(--con-bg);border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden">
            <div style="display:flex;align-items:center;gap:10px;padding:9px 16px;border-bottom:1px solid var(--border);background:var(--bg-2);flex:none">
              <span style="font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-4)">stdout · latest 500 lines</span>
              <span style="margin-left:auto;display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:9.5px;color:var(--success)"><span style="width:5px;height:5px;border-radius:50%;background:currentColor;animation:gbPulse 2.2s ease-out infinite"></span>streaming</span>
            </div>
            <div style="flex:1;min-height:0;overflow:hidden;padding:14px 16px;font-family:var(--mono);font-size:11.5px;line-height:1.9">
                ${lines}
                <div style="display:flex;gap:14px;padding:1px 0">
                  <span style="color:var(--con-dim);flex:none;font-size:10.5px;padding-top:2px;width:56px">14:26:41</span>
                  <span style="color:var(--con-dim);flex:none;width:46px;font-size:10.5px;padding-top:1px">INFO</span>
                  <span style="color:var(--con-ink)">Saving chunks for level 'aurora'<span style="display:inline-block;width:7px;height:13px;background:var(--accent);margin-left:3px;vertical-align:-2px;animation:gbCaret 1.05s step-end infinite"></span></span>
                </div>
            </div>
            <div style="flex:none;border-top:1px solid var(--border);background:var(--bg-2);padding:10px 14px">
              <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;background:var(--bg);border:1px solid var(--accent-line)">
                <span style="font-family:var(--mono);font-size:12.5px;color:var(--accent);flex:none">&gt;</span>
                <span style="flex:1;font-family:var(--mono);font-size:12.5px;color:var(--ink-2)">/say <span style="color:var(--ink-4)">Restarting in 60 seconds</span></span>
                <kbd style="font-family:var(--mono);font-size:9.5px;padding:2px 6px;border-radius:5px;background:var(--card-2);border:1px solid var(--border);color:var(--ink-4);flex:none">↑ history</kbd>
                <kbd style="font-family:var(--mono);font-size:9.5px;padding:2px 6px;border-radius:5px;background:var(--card-2);border:1px solid var(--border);color:var(--ink-4);flex:none">↵ send</kbd>
              </div>
              <div style="display:flex;align-items:center;gap:6px;margin-top:8px;padding-left:2px">
                <span style="font-family:var(--mono);font-size:9.5px;color:var(--ink-4)">suggestions</span>
                ${['/say', '/save-all', '/whitelist add', '/op', '/stop'].map((c, i) => `<span style="font-family:var(--mono);font-size:10px;padding:3px 8px;border-radius:6px;background:${i === 0 ? 'var(--accent-soft)' : 'var(--card-2)'};border:1px solid ${i === 0 ? 'var(--accent-line)' : 'var(--border)'};color:${i === 0 ? 'var(--accent)' : 'var(--ink-3)'}">${c}</span>`).join('\n                ')}
              </div>
            </div>
          </div>
        </div>`;

  return screen({ active: 'Console', crumbs: ['Ashfold', 'Aurora SMP', 'Console'], main });
}

/* ── 4 · File manager ──────────────────────────────────────────── */

export function files() {
  const tree = [
    [0, 'aurora', 'folder', true, null],
    [1, 'config', 'folder', false, null],
    [1, 'plugins', 'folder', true, null],
    [2, 'EssentialsX', 'folder', false, null],
    [2, 'LuckPerms', 'folder', false, null],
    [1, 'world', 'folder', false, null],
    [1, 'world_nether', 'folder', false, null],
    [1, 'logs', 'folder', false, null],
    [1, 'server.properties', 'file', false, 'M'],
    [1, 'ops.json', 'file', false, null],
    [1, 'whitelist.json', 'file', false, 'A'],
    [1, 'eula.txt', 'file', false, null]
  ].map(([d, n, kind, open, gitState]) => {
    const on = n === 'server.properties';
    const gs = gitState === 'M'
      ? '<span style="font-family:var(--mono);font-size:9.5px;color:var(--warning)">M</span>'
      : gitState === 'A' ? '<span style="font-family:var(--mono);font-size:9.5px;color:var(--success)">A</span>' : '';
    return `<div style="display:flex;align-items:center;gap:7px;padding:5px 8px 5px ${8 + d * 14}px;border-radius:7px;font-size:12px;color:${on ? 'var(--ink)' : 'var(--ink-2)'};background:${on ? 'var(--accent-soft)' : 'transparent'};transition:background .12s" style-hover="background:var(--card-2)">
                <span style="color:var(--ink-4);display:grid;place-items:center;flex:none;width:12px">${kind === 'folder' ? ic(open ? 'down' : 'right', 12, 2.2) : ''}</span>
                <span style="color:${on ? 'var(--accent)' : 'var(--ink-4)'};display:grid;place-items:center;flex:none">${ic(kind === 'folder' ? 'folder' : 'file', 14)}</span>
                <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n}</span>${gs}
              </div>`;
  }).join('\n              ');

  const rows = [
    ['server.properties', 'file', '1.4 KB', '2 Sep 09:12', 'rw-r--r--', 'M'],
    ['ops.json', 'file', '312 B', '28 Aug 18:40', 'rw-r--r--', ''],
    ['whitelist.json', 'file', '1.1 KB', 'today 14:25', 'rw-r--r--', 'A'],
    ['banned-ips.json', 'file', '2 B', '12 Aug 11:02', 'rw-r--r--', ''],
    ['eula.txt', 'file', '182 B', '12 Aug 11:02', 'rw-r--r--', ''],
    ['paper.yml', 'file', '8.9 KB', '30 Aug 22:15', 'rw-r--r--', ''],
    ['spigot.yml', 'file', '6.2 KB', '30 Aug 22:15', 'rw-r--r--', ''],
    ['icon.png', 'image', '4.4 KB', '12 Aug 11:04', 'rw-r--r--', '']
  ].map(([n, kind, size, when, perms, git], i) => {
    const on = i === 0;
    const gs = git === 'M' ? '<span style="font-family:var(--mono);font-size:9.5px;padding:1px 5px;border-radius:4px;color:var(--warning);background:var(--warning-soft)">modified</span>'
      : git === 'A' ? '<span style="font-family:var(--mono);font-size:9.5px;padding:1px 5px;border-radius:4px;color:var(--success);background:var(--success-soft)">new</span>' : '';
    return `<div style="display:grid;grid-template-columns:minmax(0,1fr) 90px 120px 96px 84px;gap:12px;align-items:center;padding:9px 16px;border-bottom:1px solid var(--border);background:${on ? 'var(--accent-soft)' : 'transparent'};transition:background .12s" style-hover="background:var(--card-2)">
                <div style="display:flex;align-items:center;gap:10px;min-width:0">
                  <span style="width:15px;height:15px;border-radius:4px;border:1px solid ${on ? 'var(--accent)' : 'var(--border-2)'};background:${on ? 'var(--accent)' : 'transparent'};display:grid;place-items:center;flex:none;color:var(--accent-ink)">${on ? ic('check', 10, 3.4) : ''}</span>
                  <span style="color:var(--ink-4);display:grid;place-items:center;flex:none">${ic(kind === 'image' ? 'image' : 'file', 15)}</span>
                  <span style="font-size:12.5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n}</span>
                </div>
                <div>${gs}</div>
                <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-4)">${when}</span>
                <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-4)">${perms}</span>
                <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-3);text-align:right">${size}</span>
              </div>`;
  }).join('\n              ');

  const code = [
    ['1', '#Minecraft server properties', 'c'],
    ['2', '#Mon Sep 02 09:12:44 UTC 2025', 'c'],
    ['3', '', 'p'],
    ['4', 'level-name=<v>aurora</v>', 'k'],
    ['5', 'view-distance=<v>10</v>', 'k'],
    ['6', 'simulation-distance=<v>8</v>', 'k'],
    ['7', 'max-players=<v>40</v>', 'km'],
    ['8', 'white-list=<v>true</v>', 'k'],
    ['9', 'online-mode=<v>true</v>', 'k'],
    ['10', 'enforce-secure-profile=<v>false</v>', 'k'],
    ['11', 'server-port=<v>25565</v>', 'k'],
    ['12', 'motd=<v>Aurora SMP — season four</v>', 'k']
  ].map(([n, txt, kind]) => {
    const body = txt
      .replace(/<v>/g, '<span style="color:var(--accent-2)">')
      .replace(/<\/v>/g, '</span>');
    const col = kind === 'c' ? 'var(--con-dim)' : 'var(--info)';
    const mod = kind === 'km';
    return `<div style="display:flex;gap:16px;padding:0 14px;background:${mod ? 'hsl(38 94% 58% / .07)' : 'transparent'};border-left:2px solid ${mod ? 'var(--warning)' : 'transparent'}">
                  <span style="color:var(--con-dim);width:20px;text-align:right;flex:none;font-size:10.5px">${n}</span>
                  <span style="color:${col};min-width:0">${kind === 'c' ? body : body.replace(/^([a-z-]+)=/, '<span style="color:var(--info)">$1</span><span style="color:var(--con-dim)">=</span>')}</span>
                </div>`;
  }).join('\n                ');

  const main = `        <div style="height:100%;overflow:hidden;padding:22px 32px 26px;display:flex;flex-direction:column;gap:14px">
          <div style="display:flex;align-items:center;gap:14px;flex:none">
            <div>
              <h1 style="margin:0;font-size:24px;font-weight:600;letter-spacing:-0.025em">Files</h1>
              <div style="display:flex;align-items:center;gap:7px;margin-top:7px">
                ${['aurora', 'plugins', 'LuckPerms'].map((c, i, a) => `<span style="font-family:var(--mono);font-size:11.5px;color:${i === a.length - 1 ? 'var(--ink)' : 'var(--ink-3)'}">${c}</span>${i === a.length - 1 ? '' : `<span style="color:var(--ink-4);display:grid;place-items:center">${ic('right', 12, 2)}</span>`}`).join('')}
              </div>
            </div>
            <div style="margin-left:auto;display:flex;gap:8px;flex:none">
              ${btn('New folder', 'secondary', 'sm', 'folder')}
              ${btn('Upload', 'primary', 'sm', 'upload')}
            </div>
          </div>

          <div style="display:grid;grid-template-columns:232px minmax(0,1fr) 372px;gap:16px;flex:1;min-height:0">
            <div style="${cardSt};padding:10px;overflow:hidden;display:flex;flex-direction:column">
              <div style="${tiny};padding:6px 8px 10px">file tree</div>
              <div style="flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;gap:1px">
              ${tree}
              </div>
              <div style="border-top:1px solid var(--border);margin-top:8px;padding:10px 8px 4px;display:flex;flex-direction:column;gap:6px">
                <div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:10px;color:var(--ink-4)"><span>disk</span><span style="color:var(--ink-2)">11.2 / 25 GB</span></div>
                ${meter(45, 'var(--accent)', 4)}
              </div>
            </div>

            <div style="${cardSt};overflow:hidden;display:flex;flex-direction:column">
              <div style="display:grid;grid-template-columns:minmax(0,1fr) 90px 120px 96px 84px;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border);background:var(--bg-2);flex:none">
                ${['Name', 'Changes', 'Modified', 'Permissions', 'Size'].map((h, i) => `<span style="${tiny}${i === 4 ? ';text-align:right' : ''}">${h}</span>`).join('\n                ')}
              </div>
              <div style="flex:1;min-height:0;overflow:hidden">
              ${rows}
              </div>
              <div style="flex:none;padding:10px 16px;border-top:1px solid var(--border);background:var(--bg-2);display:flex;align-items:center;gap:12px">
                <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-3)">1 selected · 8 items</span>
                <div style="margin-left:auto;display:flex;gap:4px">
                  ${[['download', 'Download'], ['copy', 'Duplicate'], ['lock', 'Permissions'], ['trash', 'Delete']].map(([i, t]) => `<button type="button" aria-label="${t}" title="${t}" style="width:27px;height:27px;border-radius:7px;display:grid;place-items:center;color:${i === 'trash' ? 'var(--danger)' : 'var(--ink-4)'};transition:background .15s,color .15s" style-hover="background:var(--card-2)">${ic(i, 14)}</button>`).join('\n                  ')}
                </div>
              </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:14px;min-height:0">
              <div style="background:var(--con-bg);border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden;flex:1;min-height:0;display:flex;flex-direction:column">
                <div style="display:flex;align-items:center;gap:9px;padding:10px 14px;border-bottom:1px solid var(--border);background:var(--bg-2);flex:none">
                  <span style="color:var(--ink-4);display:grid;place-items:center">${ic('code', 14)}</span>
                  <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-2)">server.properties</span>
                  ${badge('unsaved', 'warning')}
                  <button type="button" aria-label="Close preview" style="margin-left:auto;color:var(--ink-4);display:grid;place-items:center" style-hover="color:var(--ink)">${ic('x', 14)}</button>
                </div>
                <div style="flex:1;min-height:0;overflow:hidden;padding:12px 0;font-family:var(--mono);font-size:11.5px;line-height:1.95">
                ${code}
                </div>
                <div style="flex:none;display:flex;align-items:center;gap:8px;padding:10px 14px;border-top:1px solid var(--border);background:var(--bg-2)">
                  <span style="font-family:var(--mono);font-size:9.5px;color:var(--ink-4)">1 change · line 7</span>
                  <div style="margin-left:auto;display:flex;gap:6px">
                    ${btn('Revert', 'ghost', 'sm')}
                    ${btn('Save', 'primary', 'sm', 'save')}
                  </div>
                </div>
              </div>

              <div style="${cardSt};padding:16px 18px;flex:none">
                <div style="display:flex;align-items:center;gap:9px;margin-bottom:12px">
                  <span style="width:22px;height:22px;border-radius:7px;display:grid;place-items:center;color:var(--accent);background:var(--accent-soft);flex:none">${ic('upload', 13)}</span>
                  <span style="font-size:12.5px;font-weight:600">world-backup.zip</span>
                  <span style="margin-left:auto;font-family:var(--mono);font-size:10.5px;color:var(--accent)">62%</span>
                </div>
                <div style="height:5px;border-radius:99px;background:var(--card-2);overflow:hidden"><div style="height:100%;width:62%;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2));transition:width .6s cubic-bezier(.2,.7,.3,1)"></div></div>
                <div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:10px;color:var(--ink-4);margin-top:8px"><span>2.1 GB of 3.4 GB</span><span>~40 s left</span></div>
              </div>
            </div>
          </div>
        </div>`;

  return screen({ active: 'Files', crumbs: ['Ashfold', 'Aurora SMP', 'Files'], main });
}
