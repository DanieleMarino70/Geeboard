import { ic, pill, badge, btn, meter, avatar, cover, cardSt, label, tiny } from './lib.mjs';
import { screen, sidebar, topbar } from './chrome.mjs';

function pageHead(title, sub, actions) {
  return `<div style="display:flex;align-items:flex-end;gap:16px;flex:none">
            <div style="min-width:0">
              <h1 style="margin:0;font-size:24px;font-weight:600;letter-spacing:-0.025em">${title}</h1>
              <p style="margin:7px 0 0;font-size:12.5px;color:var(--ink-3);line-height:1.55">${sub}</p>
            </div>
            <div style="margin-left:auto;display:flex;gap:8px;flex:none">${actions}</div>
          </div>`;
}

function tableHead(cols) {
  return `<div style="display:grid;grid-template-columns:${cols.map(c => c[1]).join(' ')};gap:14px;padding:10px 18px;border-bottom:1px solid var(--border);background:var(--bg-2);flex:none">
                ${cols.map(c => `<span style="${tiny}${c[2] ? ';text-align:' + c[2] : ''}">${c[0]}</span>`).join('\n                ')}
              </div>`;
}

/* ── 10 · Analytics ────────────────────────────────────────────── */

export function analytics() {
  const pts = '0,190 50,182 100,168 150,174 200,150 250,158 300,126 350,134 400,104 450,116 500,84 550,96 600,62 650,74 700,50 750,58 800,40';

  const heat = [];
  const rows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const seed = [
    [1, 1, 0, 0, 1, 2, 3, 3, 2, 2, 3, 4, 4, 3, 2, 2, 3, 4, 5, 5, 4, 3, 2, 1],
    [1, 0, 0, 0, 1, 2, 2, 3, 2, 2, 3, 3, 4, 3, 2, 2, 3, 4, 5, 5, 4, 3, 2, 1],
    [1, 1, 0, 0, 1, 1, 2, 3, 3, 2, 2, 3, 4, 4, 3, 3, 3, 4, 5, 5, 4, 3, 2, 1],
    [1, 0, 0, 1, 1, 2, 3, 3, 2, 3, 3, 4, 4, 3, 3, 2, 4, 5, 5, 5, 4, 3, 2, 2],
    [2, 1, 1, 1, 1, 2, 3, 4, 3, 3, 4, 4, 5, 4, 3, 3, 4, 5, 5, 5, 5, 4, 3, 2],
    [2, 2, 1, 1, 2, 2, 3, 4, 4, 4, 5, 5, 5, 5, 4, 4, 5, 5, 5, 5, 5, 4, 3, 3],
    [2, 1, 1, 1, 2, 3, 4, 4, 4, 4, 5, 5, 5, 4, 4, 4, 5, 5, 5, 4, 4, 3, 3, 2]
  ];
  const alpha = [0, 0.1, 0.24, 0.4, 0.6, 0.85];
  rows.forEach((r, ri) => {
    heat.push(`<div style="display:flex;align-items:center;gap:8px">
                  <span style="font-family:var(--mono);font-size:9.5px;color:var(--ink-4);width:26px;flex:none">${r}</span>
                  <div style="display:grid;grid-template-columns:repeat(24,1fr);gap:3px;flex:1">
                    ${seed[ri].map(v => `<div style="aspect-ratio:1;border-radius:3px;background:${v === 0 ? 'var(--card-2)' : `hsl(80 72% 60% / ${alpha[v]})`}"></div>`).join('')}
                  </div>
                </div>`);
  });

  const top = [
    ['thornfield', '31 h', 96],
    ['oakhollow', '26 h', 81],
    ['brackenfell', '22 h', 68],
    ['kestrelbay', '17 h', 53],
    ['veilstrand', '14 h', 44],
    ['mirefen', '11 h', 34]
  ].map(([n, h, pct]) => `<div style="display:flex;align-items:center;gap:11px;padding:7px 0">
                  ${cover('SKIN', 24, 6)}
                  <span style="font-family:var(--mono);font-size:11.5px;width:96px;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n}</span>
                  <span style="flex:1">${meter(pct, 'var(--accent)', 4)}</span>
                  <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-3);width:34px;text-align:right;flex:none">${h}</span>
                </div>`).join('\n                ');

  const kpis = [
    ['Unique players', '1,284', '+12.4%', 'up', 'last 30 days'],
    ['Median session', '48 m', '+6 m', 'up', 'up from 42 m'],
    ['Peak concurrency', '58', '+9', 'up', 'Saturday 20:15'],
    ['Day-7 retention', '41%', '−3 pts', 'down', 'season four cohort']
  ].map(([k, v, d, dir, sub]) => {
    const tone = dir === 'up' ? ['var(--success)', 'var(--success-soft)'] : ['var(--danger)', 'var(--danger-soft)'];
    return `<div style="${cardSt};padding:18px 20px">
              <div style="${label};margin-bottom:12px">${k}</div>
              <div style="font-size:27px;font-weight:600;letter-spacing:-0.03em;line-height:1;font-variant-numeric:tabular-nums">${v}</div>
              <div style="margin-top:11px;display:flex;align-items:center;gap:7px">
                <span style="font-family:var(--mono);font-size:10.5px;padding:2px 6px;border-radius:5px;color:${tone[0]};background:${tone[1]}">${d}</span>
                <span style="font-size:11px;color:var(--ink-4)">${sub}</span>
              </div>
            </div>`;
  }).join('\n            ');

  const main = `        <div style="height:100%;overflow:hidden;padding:22px 32px 26px;display:flex;flex-direction:column;gap:16px">
          ${pageHead('Analytics', 'Player behaviour and world performance across every server in the workspace.', `<div style="display:inline-flex;gap:1px;background:var(--border);border-radius:9px;padding:1px">${['7d', '30d', '90d', 'All'].map((t, i) => `<button type="button" style="padding:8px 14px;border-radius:8px;font-family:var(--mono);font-size:11px;background:${i === 1 ? 'var(--card-2)' : 'transparent'};color:${i === 1 ? 'var(--ink)' : 'var(--ink-3)'}">${t}</button>`).join('')}</div>` + btn('Export CSV', 'secondary', 'md', 'download'))}

          <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;flex:none">
            ${kpis}
          </div>

          <div style="display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:16px;flex:1;min-height:0">
            <div style="display:flex;flex-direction:column;gap:16px;min-height:0">
              <div style="${cardSt};padding:20px;flex:1;min-height:0;display:flex;flex-direction:column">
                <div style="display:flex;align-items:baseline;gap:12px;flex:none">
                  <h2 style="margin:0;font-size:14px;font-weight:600">Concurrent players</h2>
                  <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-4)">peak 58 · median 27</span>
                  <span style="margin-left:auto;display:flex;gap:14px">
                    <span style="display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:10px;color:var(--ink-3)"><span style="width:8px;height:2px;border-radius:2px;background:var(--accent)"></span>This month</span>
                    <span style="display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:10px;color:var(--ink-4)"><span style="width:8px;height:2px;border-radius:2px;background:var(--border-2)"></span>Previous</span>
                  </span>
                </div>
                <div style="flex:1;min-height:0;margin-top:14px">
                  <svg viewBox="0 0 800 220" preserveAspectRatio="none" role="img" aria-label="Concurrent players over the last 30 days" style="width:100%;height:100%;display:block">
                    <defs><linearGradient id="anFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(80 72% 60%)" stop-opacity=".24"/><stop offset="1" stop-color="hsl(80 72% 60%)" stop-opacity="0"/></linearGradient></defs>
                    ${[44, 88, 132, 176].map(y => `<line x1="0" y1="${y}" x2="800" y2="${y}" stroke="var(--border)" stroke-width="1"/>`).join('')}
                    <polyline points="0,200 50,196 100,188 150,192 200,178 250,184 300,166 350,172 400,158 450,164 500,148 550,154 600,140 650,146 700,132 750,138 800,128" fill="none" stroke="var(--border-2)" stroke-width="1.6" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>
                    <polygon points="0,220 ${pts} 800,220" fill="url(#anFill)"/>
                    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
                    <circle cx="800" cy="40" r="4" fill="var(--accent)"/>
                  </svg>
                </div>
                <div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:9.5px;color:var(--ink-4);margin-top:8px;flex:none">
                  ${['10 Aug', '15 Aug', '20 Aug', '25 Aug', '30 Aug', '4 Sep', 'today'].map(t => `<span>${t}</span>`).join('')}
                </div>
              </div>

              <div style="${cardSt};padding:20px;flex:none">
                <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:14px">
                  <h2 style="margin:0;font-size:13.5px;font-weight:600">Activity by hour</h2>
                  <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-4)">local time · darker is busier</span>
                  <span style="margin-left:auto;display:flex;align-items:center;gap:5px;font-family:var(--mono);font-size:9.5px;color:var(--ink-4)">
                    less ${alpha.map(a => `<span style="width:9px;height:9px;border-radius:2px;background:${a === 0 ? 'var(--card-2)' : `hsl(80 72% 60% / ${a})`}"></span>`).join('')} more
                  </span>
                </div>
                <div style="display:flex;flex-direction:column;gap:3px">
                ${heat.join('\n                ')}
                </div>
                <div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:9.5px;color:var(--ink-4);margin:8px 0 0 34px">
                  ${['00', '04', '08', '12', '16', '20', '23'].map(h => `<span>${h}</span>`).join('')}
                </div>
              </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:16px;min-height:0">
              <div style="${cardSt};padding:20px;flex:none">
                <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:8px">
                  <h2 style="margin:0;font-size:13.5px;font-weight:600">Top players</h2>
                  <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-4);margin-left:auto">by playtime</span>
                </div>
                ${top}
              </div>

              <div style="${cardSt};padding:20px;flex:1;min-height:0;display:flex;flex-direction:column">
                <div style="display:flex;align-items:baseline;gap:10px;flex:none">
                  <h2 style="margin:0;font-size:13.5px;font-weight:600">Tick performance</h2>
                  <span style="font-family:var(--mono);font-size:10.5px;color:var(--success);margin-left:auto">19.8 TPS</span>
                </div>
                <div style="flex:1;min-height:0;margin-top:14px">
                  <svg viewBox="0 0 400 110" preserveAspectRatio="none" role="img" aria-label="Ticks per second over the last day" style="width:100%;height:100%;display:block">
                    <line x1="0" y1="22" x2="400" y2="22" stroke="var(--success)" stroke-width="1" stroke-dasharray="3 4" opacity=".5"/>
                    <line x1="0" y1="66" x2="400" y2="66" stroke="var(--warning)" stroke-width="1" stroke-dasharray="3 4" opacity=".45"/>
                    <polyline points="0,26 25,24 50,28 75,22 100,30 125,25 150,58 175,72 200,40 225,26 250,24 275,29 300,23 325,27 350,22 375,25 400,24" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
                  </svg>
                </div>
                <div style="display:flex;gap:14px;margin-top:10px;flex:none">
                  <span style="display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:9.5px;color:var(--ink-4)"><span style="width:8px;height:1px;background:var(--success)"></span>20 TPS</span>
                  <span style="display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:9.5px;color:var(--ink-4)"><span style="width:8px;height:1px;background:var(--warning)"></span>15 TPS floor</span>
                  <span style="margin-left:auto;font-size:11px;color:var(--ink-4)">one dip · 18:40</span>
                </div>
              </div>
            </div>
          </div>
        </div>`;

  return screen({ active: 'Analytics', crumbs: ['Ashfold', 'Analytics'], main });
}

/* ── 11 · Settings ─────────────────────────────────────────────── */

export function settings() {
  const subnav = [['General', 'settings', true], ['Startup & Java', 'terminal'], ['Network & ports', 'network'], ['Storage', 'drive'], ['Members & roles', 'users'], ['Integrations', 'link'], ['Notifications', 'bell'], ['Danger zone', 'alert']]
    .map(([t, icon, on]) => `<button type="button" style="display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border-radius:8px;font-size:12.5px;color:${t === 'Danger zone' ? 'var(--danger)' : on ? 'var(--ink)' : 'var(--ink-3)'};background:${on ? 'var(--accent-soft)' : 'transparent'};font-weight:${on ? '500' : '400'};transition:background .15s" style-hover="background:var(--card-2)">
                <span style="display:grid;place-items:center;flex:none;color:${t === 'Danger zone' ? 'var(--danger)' : on ? 'var(--accent)' : 'var(--ink-4)'}">${ic(icon, 15)}</span>
                <span style="flex:1;text-align:left">${t}</span>
              </button>`).join('\n              ');

  function field(lbl, value, hint, mono = false, aside = null) {
    return `<div>
                  <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:7px">
                    <label style="font-size:12px;font-weight:500">${lbl}</label>
                    ${aside ? `<span style="margin-left:auto;font-family:var(--mono);font-size:10px;color:var(--ink-4)">${aside}</span>` : ''}
                  </div>
                  <div style="width:100%;padding:10px 12px;border-radius:9px;background:var(--bg-2);border:1px solid var(--border);font-size:13px;${mono ? 'font-family:var(--mono);font-size:12.5px;' : ''}transition:border-color .15s" style-hover="border-color:var(--border-2)">${value}</div>
                  ${hint ? `<p style="margin:7px 0 0;font-size:11px;color:var(--ink-4);line-height:1.5">${hint}</p>` : ''}
                </div>`;
  }

  function toggleRow(lbl, note, on) {
    return `<div style="display:flex;align-items:flex-start;gap:12px;padding:14px 0;border-bottom:1px solid var(--border)">
                  <span style="width:36px;height:20px;border-radius:99px;flex:none;padding:2px;display:flex;justify-content:${on ? 'flex-end' : 'flex-start'};background:${on ? 'var(--accent)' : 'var(--card-2)'};border:1px solid ${on ? 'var(--accent-line)' : 'var(--border)'};transition:background .18s;margin-top:1px"><span style="width:14px;height:14px;border-radius:50%;background:${on ? 'var(--accent-ink)' : 'var(--ink-4)'};transition:background .18s"></span></span>
                  <span style="min-width:0;flex:1">
                    <span style="display:block;font-size:12.5px;font-weight:500">${lbl}</span>
                    <span style="display:block;font-size:11px;color:var(--ink-4);margin-top:3px;line-height:1.5">${note}</span>
                  </span>
                </div>`;
  }

  const main = `        <div style="height:100%;overflow:hidden;padding:22px 32px 26px;display:flex;flex-direction:column;gap:16px">
          ${pageHead('Settings', 'Aurora SMP · changes to startup values apply on the next restart.', `<span style="display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--warning);margin-right:4px">${ic('alert', 13)}2 unsaved changes</span>` + btn('Discard', 'ghost', 'md') + btn('Save changes', 'primary', 'md', 'save'))}

          <div style="display:grid;grid-template-columns:222px minmax(0,1fr) 300px;gap:16px;flex:1;min-height:0">
            <div style="${cardSt};padding:12px;display:flex;flex-direction:column;gap:1px;overflow:hidden;align-content:start">
              ${subnav}
            </div>

            <div style="display:flex;flex-direction:column;gap:16px;min-height:0;overflow:hidden">
              <div style="${cardSt};padding:22px">
                <h2 style="margin:0 0 4px;font-size:14px;font-weight:600;letter-spacing:-0.015em">Identity</h2>
                <p style="margin:0 0 20px;font-size:11.5px;color:var(--ink-4);line-height:1.55">How the server introduces itself in the multiplayer list.</p>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
                  ${field('Server name', 'Aurora SMP', 'Shown to players in the server list.')}
                  ${field('Subdomain', 'aurora.ashfold.gg', 'DNS is managed for you.', true, 'verified')}
                </div>
              </div>

              <div style="${cardSt};padding:22px">
                <h2 style="margin:0 0 4px;font-size:14px;font-weight:600;letter-spacing:-0.015em">Runtime</h2>
                <p style="margin:0 0 20px;font-size:11.5px;color:var(--ink-4);line-height:1.55">Java flags and the ceiling the container will not exceed.</p>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
                  ${field('Java runtime', 'Temurin 21.0.4 · LTS', null)}
                  ${field('Heap ceiling', '8 GB of 8 GB allocated', 'Raised from 6 GB an hour ago.', false, 'changed')}
                </div>
                <div style="margin-top:18px">
                  <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:7px"><label style="font-size:12px;font-weight:500">Startup flags</label></div>
                  <div style="display:flex;align-items:center;gap:9px;padding:10px 12px;border-radius:9px;background:var(--bg-2);border:1px solid var(--border)">
                    <span style="font-family:var(--mono);font-size:11px;color:var(--ink-4);flex:none">java</span>
                    <span style="flex:1;min-width:0;font-family:var(--mono);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">-Xms4G -Xmx8G -XX:+UseG1GC -XX:MaxGCPauseMillis=200</span>
                    <button type="button" aria-label="Reset to recommended" style="color:var(--ink-4);display:grid;place-items:center;flex:none" style-hover="color:var(--ink)">${ic('refresh', 14)}</button>
                  </div>
                </div>
              </div>

              <div style="${cardSt};padding:22px">
                <h2 style="margin:0 0 14px;font-size:14px;font-weight:600;letter-spacing:-0.015em">Behaviour</h2>
                ${toggleRow('Autosave every 5 minutes', 'Writes the world to disk without pausing ticks.', true)}
                ${toggleRow('Whitelist only', 'Rejects anyone not on the allow list.', false)}
              </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:16px;min-height:0">
              <div style="${cardSt};padding:18px 20px">
                <h2 style="margin:0 0 12px;font-size:13px;font-weight:600">Applies on restart</h2>
                <div style="display:flex;flex-direction:column;gap:10px">
                  ${[['Heap ceiling', '6 GB → 8 GB'], ['MOTD', 'season three → season four']].map(([k, v]) => `<div style="padding:11px 12px;border-radius:10px;background:var(--warning-soft);border:1px solid hsl(38 94% 58% / .26)">
                    <div style="font-size:11.5px;font-weight:500;color:var(--warning)">${k}</div>
                    <div style="font-family:var(--mono);font-size:10.5px;color:var(--ink-3);margin-top:4px">${v}</div>
                  </div>`).join('\n                  ')}
                </div>
                <p style="margin:14px 0 0;font-size:11px;color:var(--ink-4);line-height:1.55">Saving stages the change. The server picks it up on the next restart — schedule one, or restart now.</p>
                <div style="margin-top:14px;display:flex;gap:8px">${btn('Restart now', 'secondary', 'sm', 'restart')}${btn('Schedule', 'ghost', 'sm')}</div>
              </div>

              <div style="background:var(--card);border:1px solid hsl(4 78% 60% / .3);border-radius:var(--r-lg);padding:18px 20px">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
                  <span style="width:24px;height:24px;border-radius:7px;display:grid;place-items:center;color:var(--danger);background:var(--danger-soft);flex:none">${ic('alert', 13)}</span>
                  <h2 style="margin:0;font-size:13px;font-weight:600">Danger zone</h2>
                </div>
                <p style="margin:0 0 14px;font-size:11.5px;color:var(--ink-3);line-height:1.55">Deleting removes the container, 11.2 GB of world data and every snapshot.</p>
                <div style="display:flex;flex-direction:column;gap:8px">
                  ${btn('Transfer ownership', 'secondary', 'sm')}
                  ${btn('Delete this server', 'destructive', 'sm', 'trash')}
                </div>
              </div>
            </div>
          </div>
        </div>`;

  return screen({ active: 'Settings', crumbs: ['Ashfold', 'Aurora SMP', 'Settings'], main });
}

/* ── 12 · Audit log ────────────────────────────────────────────── */

export function auditLog() {
  const rows = [
    ['Devi Vasquez', 'DV', 'api_key.revoked', 'ci-deploy-key', 'danger', '14:02:11', '81.**.**.44'],
    ['Mara Kessler', 'MK', 'server.settings.updated', 'Aurora SMP · heap 6→8 GB', 'accent', '13:48:02', '81.**.**.204'],
    ['Scheduler', 'SY', 'backup.completed', 'daily-09-07 · 3.42 GB', 'success', '03:00:41', 'internal'],
    ['Mara Kessler', 'MK', 'member.role.changed', 'oakhollow → Moderator', 'accent', 'yesterday 21:20', '81.**.**.204'],
    ['Watchdog', 'SY', 'server.recovered', 'Aurora SMP · tick overload', 'warning', 'yesterday 18:41', 'internal'],
    ['Devi Vasquez', 'DV', 'server.stopped', 'Wipe Wednesday', 'warning', 'yesterday 17:03', '81.**.**.44'],
    ['Tomas Reiner', 'TR', 'login.failed', '3 attempts · locked 15 m', 'danger', 'yesterday 09:12', '203.**.**.7'],
    ['Mara Kessler', 'MK', 'node.drained', 'sgp-node-01', 'warning', '5 Sep 22:15', '81.**.**.204']
  ].map(([who, ini, action, target, tone, when, ip], i) => `<div style="display:grid;grid-template-columns:180px minmax(0,1fr) 210px 136px 120px;gap:14px;align-items:center;padding:11px 18px;border-bottom:1px solid var(--border);background:${i === 0 ? 'var(--accent-soft)' : 'transparent'};transition:background .12s" style-hover="background:var(--card-2)">
                <div style="display:flex;align-items:center;gap:10px;min-width:0">
                  ${avatar(ini, 26, '8px')}
                  <span style="font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${who}</span>
                </div>
                <span style="font-family:var(--mono);font-size:11.5px;color:var(--${tone === 'accent' ? 'accent' : tone});min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${action}</span>
                <span style="font-size:11.5px;color:var(--ink-3);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${target}</span>
                <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-4)">${when}</span>
                <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-4);text-align:right">${ip}</span>
              </div>`).join('\n              ');

  const diff = [
    ['-', '  "max-memory": "6G",', 'danger'],
    ['+', '  "max-memory": "8G",', 'success'],
    [' ', '  "java": "temurin-21",', 'dim'],
    [' ', '  "flags": [', 'dim'],
    [' ', '    "-XX:+UseG1GC",', 'dim'],
    ['+', '    "-XX:MaxGCPauseMillis=200"', 'success'],
    [' ', '  ]', 'dim']
  ].map(([sign, txt, tone]) => {
    const col = tone === 'danger' ? 'var(--danger)' : tone === 'success' ? 'var(--success)' : 'var(--con-dim)';
    const bg = tone === 'danger' ? 'hsl(4 78% 60% / .08)' : tone === 'success' ? 'hsl(166 68% 45% / .08)' : 'transparent';
    return `<div style="display:flex;gap:10px;padding:1px 12px;background:${bg}"><span style="color:${col};flex:none;width:8px">${sign}</span><span style="color:${tone === 'dim' ? 'var(--con-ink)' : col};white-space:pre">${txt}</span></div>`;
  }).join('\n                ');

  const main = `        <div style="height:100%;overflow:hidden;padding:22px 32px 26px;display:flex;flex-direction:column;gap:16px">
          ${pageHead('Audit log', 'Every privileged action, who took it and what changed. Retained for 400 days and exportable.', btn('Export', 'secondary', 'md', 'download') + btn('Stream to webhook', 'secondary', 'md', 'link'))}

          <div style="display:flex;align-items:center;gap:10px;flex:none">
            <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:9px;background:var(--bg-2);border:1px solid var(--border);width:300px">
              <span style="color:var(--ink-4);display:grid;place-items:center;flex:none">${ic('search', 14, 1.9)}</span>
              <span style="flex:1;font-size:12.5px;color:var(--ink-4)">Filter by actor, action or target…</span>
            </div>
            ${['Everyone', 'All actions', 'Last 7 days'].map(t => `<button type="button" style="display:inline-flex;align-items:center;gap:7px;padding:8px 12px;border-radius:9px;border:1px solid var(--border);background:var(--card);color:var(--ink-2);font-size:12px;transition:border-color .15s" style-hover="border-color:var(--border-2)">${t}${ic('down', 13, 2)}</button>`).join('\n            ')}
            <span style="margin-left:auto;font-family:var(--mono);font-size:10.5px;color:var(--ink-4)">2,418 events</span>
          </div>

          <div style="display:grid;grid-template-columns:minmax(0,1fr) 344px;gap:16px;flex:1;min-height:0">
            <div style="${cardSt};overflow:hidden;display:flex;flex-direction:column">
              ${tableHead([['Actor', '180px'], ['Action', 'minmax(0,1fr)'], ['Target', '210px'], ['When', '136px'], ['Source IP', '120px', 'right']])}
              <div style="flex:1;min-height:0;overflow:hidden">
              ${rows}
              </div>
            </div>

            <div style="${cardSt};overflow:hidden;display:flex;flex-direction:column;min-height:0">
              <div style="padding:18px 20px;border-bottom:1px solid var(--border);flex:none">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
                  <span style="width:26px;height:26px;border-radius:8px;display:grid;place-items:center;color:var(--danger);background:var(--danger-soft);flex:none">${ic('key', 14)}</span>
                  <span style="font-family:var(--mono);font-size:12.5px;color:var(--danger)">api_key.revoked</span>
                </div>
                <div style="display:flex;align-items:center;gap:10px">
                  ${avatar('DV', 28, '9px')}
                  <div style="min-width:0">
                    <div style="font-size:12.5px;font-weight:500">Devi Vasquez</div>
                    <div style="font-family:var(--mono);font-size:10px;color:var(--ink-4);margin-top:2px">today 14:02:11 UTC · 81.**.**.44</div>
                  </div>
                </div>
              </div>
              <div style="flex:1;min-height:0;overflow:hidden;padding:16px 20px">
                ${[['Key', 'ci-deploy-key'], ['Key ID', 'gbk_2f9a…41c7'], ['Scopes', 'servers:write, files:write'], ['Reason', 'rotation · quarterly policy'], ['Session', 'web · Firefox on macOS']].map(([k, v]) => `<div style="display:flex;align-items:baseline;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
                  <span style="font-size:11.5px;color:var(--ink-4);flex:none;width:74px">${k}</span>
                  <span style="font-family:var(--mono);font-size:11.5px;flex:1;min-width:0">${v}</span>
                </div>`).join('\n                ')}
                <div style="${tiny};margin:16px 0 10px">payload diff · previous event</div>
                <div style="background:var(--con-bg);border:1px solid var(--border);border-radius:10px;padding:10px 0;font-family:var(--mono);font-size:10.5px;line-height:1.8;overflow:hidden">
                ${diff}
                </div>
              </div>
              <div style="flex:none;padding:14px 20px;border-top:1px solid var(--border);background:var(--bg-2);display:flex;gap:8px">
                ${btn('Copy event JSON', 'secondary', 'sm', 'copy')}
                ${btn('View actor', 'ghost', 'sm')}
              </div>
            </div>
          </div>
        </div>`;

  return screen({ active: 'Audit log', crumbs: ['Ashfold', 'Audit log'], main });
}

/* ── 13 · API keys ─────────────────────────────────────────────── */

export function apiKeys() {
  const keys = [
    ['Production deploy', 'gbk_live_8f2a…d417', 'servers:write · files:write', '2 min ago', 'Active', 'success', 'never'],
    ['Grafana metrics', 'gbk_live_4c81…9b02', 'metrics:read', '6 min ago', 'Active', 'success', '12 Dec 2025'],
    ['Status page', 'gbk_live_a119…3e5f', 'servers:read', '1 h ago', 'Active', 'success', 'never'],
    ['Discord bot', 'gbk_live_77de…c840', 'servers:read · console:write', '3 d ago', 'Idle', 'muted', '1 Nov 2025'],
    ['ci-deploy-key', 'gbk_live_2f9a…41c7', 'servers:write · files:write', 'revoked today', 'Revoked', 'danger', '—']
  ].map(([n, id, scopes, used, state, tone, expires], i, a) => `<div style="display:grid;grid-template-columns:minmax(0,1fr) 176px 232px 116px 116px 40px;gap:14px;align-items:center;padding:12px 18px;${i === a.length - 1 ? '' : 'border-bottom:1px solid var(--border);'}opacity:${state === 'Revoked' ? '.62' : '1'};transition:background .12s" style-hover="background:var(--card-2)">
                <div style="display:flex;align-items:center;gap:11px;min-width:0">
                  <span style="width:28px;height:28px;border-radius:8px;display:grid;place-items:center;flex:none;color:${state === 'Revoked' ? 'var(--ink-4)' : 'var(--accent)'};background:${state === 'Revoked' ? 'var(--card-2)' : 'var(--accent-soft)'}">${ic('key', 14)}</span>
                  <div style="min-width:0">
                    <div style="font-size:12.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n}</div>
                    <div style="font-family:var(--mono);font-size:9.5px;color:var(--ink-4);margin-top:2px">expires ${expires}</div>
                  </div>
                </div>
                <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${id}</span>
                <span style="font-family:var(--mono);font-size:10px;color:var(--ink-4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${scopes}</span>
                <span style="font-size:11.5px;color:var(--ink-4)">${used}</span>
                <div>${pill(state, tone)}</div>
                <button type="button" aria-label="Key actions" style="width:26px;height:26px;border-radius:7px;display:grid;place-items:center;color:var(--ink-4);justify-self:end;transition:background .15s,color .15s" style-hover="background:var(--card-2);color:var(--ink)">${ic('dots', 15)}</button>
              </div>`).join('\n              ');

  const scopeRows = [
    ['servers:read', 'List servers and read their state', true],
    ['servers:write', 'Start, stop, restart and reconfigure', true],
    ['console:write', 'Send commands to a running console', false],
    ['files:read', 'Download files and list directories', true],
    ['files:write', 'Upload, edit and delete files', false],
    ['metrics:read', 'Read CPU, memory and player metrics', true]
  ].map(([s, d, on]) => `<div style="display:flex;align-items:flex-start;gap:11px;padding:9px 0;border-bottom:1px solid var(--border)">
                  <span style="width:17px;height:17px;border-radius:5px;flex:none;display:grid;place-items:center;margin-top:1px;background:${on ? 'var(--accent)' : 'transparent'};border:1px solid ${on ? 'var(--accent)' : 'var(--border-2)'};color:var(--accent-ink);transition:background .12s,border-color .12s">${on ? ic('check', 11, 3.4) : ''}</span>
                  <span style="min-width:0;flex:1">
                    <span style="display:block;font-family:var(--mono);font-size:11.5px;color:${on ? 'var(--ink)' : 'var(--ink-3)'}">${s}</span>
                    <span style="display:block;font-size:11px;color:var(--ink-4);margin-top:2px">${d}</span>
                  </span>
                </div>`).join('\n                ');

  const main = `        <div style="height:100%;overflow:hidden;padding:22px 32px 26px;display:flex;flex-direction:column;gap:16px">
          ${pageHead('API keys', 'Scoped tokens for CI, bots and dashboards. Secrets are shown once, at creation, and never again.', btn('Read the API docs', 'secondary', 'md', 'external') + btn('Create key', 'primary', 'md', 'plus'))}

          <div style="${cardSt};padding:18px 20px;flex:none;border-color:var(--accent-line);background:linear-gradient(180deg,var(--accent-soft),transparent 70%),var(--card)">
            <div style="display:flex;align-items:center;gap:11px;margin-bottom:12px">
              <span style="width:26px;height:26px;border-radius:8px;display:grid;place-items:center;color:var(--accent);background:var(--accent-soft);flex:none">${ic('check', 14, 2.6)}</span>
              <div>
                <div style="font-size:13px;font-weight:600">Production deploy — copy this now</div>
                <div style="font-size:11.5px;color:var(--ink-3);margin-top:3px">This is the only time the full secret is shown. Store it in your CI secret manager.</div>
              </div>
              <span style="margin-left:auto">${btn('Done', 'ghost', 'sm')}</span>
            </div>
            <div style="display:flex;align-items:center;gap:10px;padding:11px 13px;border-radius:10px;background:var(--con-bg);border:1px solid var(--border)">
              <span style="font-family:var(--mono);font-size:12px;color:var(--con-ink);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">gbk_live_8f2a41d0b7c94e6f2a19d4173c88be05</span>
              ${btn('Copy', 'secondary', 'sm', 'copy')}
            </div>
          </div>

          <div style="display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:16px;flex:1;min-height:0">
            <div style="${cardSt};overflow:hidden;display:flex;flex-direction:column">
              <div style="display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid var(--border);flex:none">
                <h2 style="margin:0;font-size:13.5px;font-weight:600">Keys</h2>
                <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-4)">4 active · 1 revoked</span>
              </div>
              ${tableHead([['Name', 'minmax(0,1fr)'], ['Key ID', '176px'], ['Scopes', '232px'], ['Last used', '116px'], ['State', '116px'], ['', '40px']])}
              <div style="flex:1;min-height:0;overflow:hidden">
              ${keys}
              </div>
            </div>

            <div style="${cardSt};overflow:hidden;display:flex;flex-direction:column;min-height:0">
              <div style="padding:16px 20px;border-bottom:1px solid var(--border);flex:none">
                <h2 style="margin:0;font-size:13.5px;font-weight:600">Scopes · Production deploy</h2>
                <p style="margin:6px 0 0;font-size:11px;color:var(--ink-4);line-height:1.5">Least privilege by default. Widening a scope re-prompts for your password.</p>
              </div>
              <div style="flex:1;min-height:0;overflow:hidden;padding:8px 20px 16px">
                ${scopeRows}
                <div style="${tiny};margin:16px 0 10px">restrictions</div>
                <div style="display:flex;flex-direction:column;gap:8px">
                  ${[['IP allow list', '2 ranges'], ['Rate limit', '600 req / min']].map(([k, v]) => `<div style="display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:9px;background:var(--bg-2);border:1px solid var(--border)">
                    <span style="font-size:11.5px;color:var(--ink-3);flex:1">${k}</span>
                    <span style="font-family:var(--mono);font-size:11px;color:var(--ink-2)">${v}</span>
                  </div>`).join('\n                  ')}
                </div>
              </div>
              <div style="flex:none;padding:14px 20px;border-top:1px solid var(--border);background:var(--bg-2);display:flex;gap:8px">
                ${btn('Save scopes', 'primary', 'sm')}
                ${btn('Revoke', 'destructive', 'sm')}
              </div>
            </div>
          </div>
        </div>`;

  return screen({ active: 'API keys', crumbs: ['Ashfold', 'API keys'], main });
}
