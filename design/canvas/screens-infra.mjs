import { ic, pill, badge, btn, meter, avatar, cover, cardSt, label, tiny } from './lib.mjs';
import { screen } from './chrome.mjs';

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

/* ── 5 · Node detail ───────────────────────────────────────────── */

export function nodeDetail() {
  const gauges = [
    ['CPU', '48%', 48, '16 vCPU · AMD EPYC 7443P', 'var(--accent)'],
    ['Memory', '61%', 61, '78 GB of 128 GB', 'var(--accent)'],
    ['Storage', '39%', 39, '1.4 TB of 3.5 TB NVMe', 'var(--accent)'],
    ['Network', '112 Mb/s', 11, 'peak 840 Mb/s · 1 Gb link', 'var(--info)']
  ].map(([k, v, pct, sub, c]) => `<div style="${cardSt};padding:20px">
              <div style="${label};margin-bottom:14px">${k}</div>
              <div style="font-size:28px;font-weight:600;letter-spacing:-0.03em;line-height:1;font-variant-numeric:tabular-nums">${v}</div>
              <div style="margin:14px 0 9px">${meter(pct, c, 4)}</div>
              <div style="font-family:var(--mono);font-size:10px;color:var(--ink-4)">${sub}</div>
            </div>`).join('\n            ');

  const hosted = [
    ['Aurora SMP', 'MC 1.21.4', 'Running', 'success', 34, '8 GB', '25565'],
    ['Ashfold Creative', 'MC 1.21.4', 'Running', 'success', 22, '6 GB', '25567'],
    ['Nightfall PvP', 'MC 1.20.6', 'Starting', 'warning', 71, '12 GB', '25566'],
    ['Wipe Wednesday', 'Rust 2024.11', 'Stopped', 'muted', 0, '16 GB', '28015'],
    ['staging-01', 'MC 1.21.4', 'Suspended', 'muted', 0, '4 GB', '25570']
  ].map(([n, g, state, tone, cpu, ram, port], i, a) => `<div style="display:grid;grid-template-columns:minmax(0,1fr) 108px 118px 120px 72px 72px;gap:14px;align-items:center;padding:11px 18px;${i === a.length - 1 ? '' : 'border-bottom:1px solid var(--border);'}transition:background .12s" style-hover="background:var(--card-2)">
                <div style="display:flex;align-items:center;gap:11px;min-width:0">
                  ${cover('ART', 28, 8)}
                  <span style="font-size:12.5px;font-weight:500;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n}</span>
                </div>
                <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-4)">${g}</span>
                <div>${pill(state, tone, state === 'Starting')}</div>
                <div style="display:flex;align-items:center;gap:8px"><span style="flex:1">${meter(cpu, cpu > 60 ? 'var(--warning)' : 'var(--accent)', 3)}</span><span style="font-family:var(--mono);font-size:10px;color:var(--ink-3);width:26px;text-align:right">${cpu}%</span></div>
                <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-3)">${ram}</span>
                <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-4);text-align:right">${port}</span>
              </div>`).join('\n              ');

  const allocations = [
    ['25565', 'Aurora SMP', 'primary'],
    ['25566', 'Nightfall PvP', 'primary'],
    ['25567', 'Ashfold Creative', 'primary'],
    ['25568', '—', 'free'],
    ['28015', 'Wipe Wednesday', 'primary'],
    ['28016', 'Wipe Wednesday', 'query']
  ].map(([port, srv, kind]) => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
                <span style="font-family:var(--mono);font-size:11.5px;width:52px;flex:none;color:${kind === 'free' ? 'var(--ink-4)' : 'var(--ink)'}">${port}</span>
                <span style="font-size:11.5px;color:var(--ink-3);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${srv}</span>
                ${kind === 'free' ? badge('free', 'muted') : badge(kind, kind === 'query' ? 'info' : 'accent')}
              </div>`).join('\n                ');

  const main = `        <div style="height:100%;overflow:hidden;padding:22px 32px 26px;display:flex;flex-direction:column;gap:16px">
          <div style="display:flex;align-items:flex-start;gap:16px;flex:none">
            <div style="width:46px;height:46px;border-radius:12px;flex:none;display:grid;place-items:center;color:var(--accent);background:var(--accent-soft);border:1px solid var(--accent-line)">${ic('cpu', 24, 1.6)}</div>
            <div style="min-width:0">
              <div style="display:flex;align-items:center;gap:10px">
                <h1 style="margin:0;font-size:26px;font-weight:600;letter-spacing:-0.025em;font-family:var(--mono)">fra-node-02</h1>
                ${pill('Healthy', 'success')}
              </div>
              <div style="display:flex;align-items:center;gap:14px;margin-top:8px;font-family:var(--mono);font-size:11px;color:var(--ink-4)">
                <span style="display:flex;align-items:center;gap:6px">${ic('globe', 13)}Frankfurt · eu-central</span>
                <span style="display:flex;align-items:center;gap:6px">${ic('network', 13)}10.24.8.2 · 14 ms</span>
                <span style="display:flex;align-items:center;gap:6px">${ic('package', 13)}daemon 2.4.1</span>
                <span style="display:flex;align-items:center;gap:6px">${ic('clock', 13)}up 41 d</span>
              </div>
            </div>
            <div style="margin-left:auto;display:flex;gap:8px;flex:none">
              ${btn('Configure', 'secondary', 'md', 'settings')}
              ${btn('Drain node', 'destructive', 'md', 'download')}
            </div>
          </div>

          <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;flex:none">
            ${gauges}
          </div>

          <div style="display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:16px;flex:1;min-height:0">
            <div style="${cardSt};overflow:hidden;display:flex;flex-direction:column">
              <div style="display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--border);flex:none">
                <h2 style="margin:0;font-size:13.5px;font-weight:600">Servers on this node</h2>
                <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-4)">5 of 9 slots used</span>
                <div style="margin-left:auto;display:flex;gap:6px">
                  ${btn('Filter', 'ghost', 'sm', 'filter')}
                  ${btn('Add server', 'secondary', 'sm', 'plus')}
                </div>
              </div>
              ${tableHead([['Server', 'minmax(0,1fr)'], ['Game', '108px'], ['State', '118px'], ['CPU', '120px'], ['Memory', '72px'], ['Port', '72px', 'right']])}
              <div style="flex:1;min-height:0;overflow:hidden">
              ${hosted}
              </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:16px;min-height:0">
              <div style="${cardSt};padding:18px 20px;flex:none">
                <h2 style="margin:0 0 14px;font-size:13.5px;font-weight:600">Port allocations</h2>
                ${allocations}
                <button type="button" style="display:flex;align-items:center;gap:7px;margin-top:12px;font-size:11.5px;color:var(--accent)">${ic('plus', 13)}Allocate a range</button>
              </div>

              <div style="${cardSt};padding:18px 20px;flex:1;min-height:0">
                <h2 style="margin:0 0 14px;font-size:13.5px;font-weight:600">Daemon</h2>
                ${[
                  ['Version', '2.4.1', 'up to date'],
                  ['SSL', 'Let’s Encrypt', 'renews in 46 d'],
                  ['Docker', '27.2.0', 'overlay2'],
                  ['Last heartbeat', '2 s ago', 'every 5 s']
                ].map(([k, v, s]) => `<div style="display:flex;align-items:baseline;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
                  <span style="font-size:11.5px;color:var(--ink-4);flex:none;width:104px">${k}</span>
                  <span style="font-family:var(--mono);font-size:11.5px;flex:1;min-width:0">${v}</span>
                  <span style="font-family:var(--mono);font-size:9.5px;color:var(--ink-4)">${s}</span>
                </div>`).join('\n                ')}
              </div>
            </div>
          </div>
        </div>`;

  return screen({ active: 'Nodes', crumbs: ['Ashfold', 'Nodes', 'fra-node-02'], main });
}

/* ── 6 · Player management ─────────────────────────────────────── */

export function players() {
  const tabs = ['Online · 23', 'Whitelist · 64', 'Operators · 5', 'Bans · 12'];
  const list = [
    ['thornfield', 'Trusted', 'info', '2 min', '14 ms', '148 h', true],
    ['kestrelbay', 'Member', 'muted', '28 min', '41 ms', '92 h', false],
    ['lumen_verd', 'Member', 'muted', '1 h', '8 ms', '4 h', false],
    ['oakhollow', 'Moderator', 'accent', '1 h', '122 ms', '311 h', false],
    ['mirefen', 'Member', 'muted', '3 h', '3 ms', '58 h', false],
    ['saltmarch', 'Member', 'muted', '4 h', '66 ms', '21 h', false],
    ['brackenfell', 'Trusted', 'info', '5 h', '19 ms', '204 h', false],
    ['dunhollow', 'Member', 'muted', '6 h', '88 ms', '12 h', false],
    ['veilstrand', 'Member', 'muted', '8 h', '34 ms', '77 h', false]
  ].map(([n, role, tone, seen, ping, played, on]) => `<div style="display:grid;grid-template-columns:minmax(0,1fr) 108px 88px 76px 88px 40px;gap:14px;align-items:center;padding:10px 18px;border-bottom:1px solid var(--border);background:${on ? 'var(--accent-soft)' : 'transparent'};transition:background .12s" style-hover="background:var(--card-2)">
                <div style="display:flex;align-items:center;gap:11px;min-width:0">
                  ${cover('SKIN', 28, 7)}
                  <div style="min-width:0">
                    <div style="font-family:var(--mono);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n}</div>
                    <div style="font-family:var(--mono);font-size:9.5px;color:var(--ink-4);margin-top:2px">a4f2…9c1d</div>
                  </div>
                </div>
                <div>${badge(role, tone)}</div>
                <span style="font-size:11.5px;color:var(--ink-4)">${seen}</span>
                <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-3)">${ping}</span>
                <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-3);text-align:right">${played}</span>
                <button type="button" aria-label="Player actions" style="width:26px;height:26px;border-radius:7px;display:grid;place-items:center;color:var(--ink-4);justify-self:end;transition:background .15s,color .15s" style-hover="background:var(--card-2);color:var(--ink)">${ic('dots', 15)}</button>
              </div>`).join('\n              ');

  const main = `        <div style="height:100%;overflow:hidden;padding:22px 32px 26px;display:flex;flex-direction:column;gap:16px">
          ${pageHead('Players', 'Everyone who has ever connected to Aurora SMP, with the moderation history that came with them.', btn('Invite by name', 'secondary', 'md', 'plus') + btn('Import whitelist', 'primary', 'md', 'upload'))}

          <div role="tablist" style="display:flex;gap:2px;border-bottom:1px solid var(--border);flex:none;margin:0 -32px;padding:0 32px">
            ${tabs.map((t, i) => `<button type="button" role="tab" aria-selected="${i === 0}" style="position:relative;padding:11px 15px 13px;font-size:12.5px;font-weight:${i === 0 ? '500' : '400'};color:${i === 0 ? 'var(--ink)' : 'var(--ink-3)'};transition:color .15s" style-hover="color:var(--ink-2)">${t}<span style="position:absolute;left:8px;right:8px;bottom:-1px;height:2px;border-radius:2px;background:${i === 0 ? 'var(--accent)' : 'transparent'}"></span></button>`).join('\n            ')}
          </div>

          <div style="display:grid;grid-template-columns:minmax(0,1fr) 316px;gap:16px;flex:1;min-height:0">
            <div style="${cardSt};overflow:hidden;display:flex;flex-direction:column">
              <div style="display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid var(--border);flex:none">
                <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:8px;background:var(--bg-2);border:1px solid var(--border);width:230px">
                  <span style="color:var(--ink-4);display:grid;place-items:center;flex:none">${ic('search', 13, 1.9)}</span>
                  <span style="flex:1;font-size:11.5px;color:var(--ink-4)">Search by name or UUID…</span>
                </div>
                ${btn('Role: any', 'ghost', 'sm', 'filter')}
                <span style="margin-left:auto;font-family:var(--mono);font-size:10.5px;color:var(--ink-4)">23 online · 64 whitelisted</span>
              </div>
              ${tableHead([['Player', 'minmax(0,1fr)'], ['Role', '108px'], ['Last seen', '88px'], ['Ping', '76px'], ['Playtime', '88px', 'right'], ['', '40px']])}
              <div style="flex:1;min-height:0;overflow:hidden">
              ${list}
              </div>
            </div>

            <div style="${cardSt};overflow:hidden;display:flex;flex-direction:column;min-height:0">
              <div style="padding:20px;border-bottom:1px solid var(--border);display:flex;gap:14px;align-items:center;flex:none">
                ${cover('SKIN', 52, 12)}
                <div style="min-width:0">
                  <div style="font-family:var(--mono);font-size:14px;font-weight:500">thornfield</div>
                  <div style="display:flex;align-items:center;gap:7px;margin-top:8px">${badge('Trusted', 'info')}${pill('Online', 'success')}</div>
                </div>
              </div>
              <div style="flex:1;min-height:0;overflow:hidden;padding:16px 20px">
                ${[
                  ['UUID', 'a4f2b8e0…9c1d'],
                  ['First joined', '14 Mar 2024'],
                  ['Playtime', '148 h 22 m'],
                  ['Sessions', '312'],
                  ['Last IP', '81.**.**.204 · DE'],
                  ['Warnings', '1 · spam, Jun 2025']
                ].map(([k, v]) => `<div style="display:flex;align-items:baseline;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
                  <span style="font-size:11.5px;color:var(--ink-4);flex:none;width:92px">${k}</span>
                  <span style="font-family:var(--mono);font-size:11.5px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v}</span>
                </div>`).join('\n                ')}
                <div style="${tiny};margin:16px 0 10px">recent sessions</div>
                <div style="display:flex;gap:3px;align-items:flex-end;height:44px">
                  ${[18, 26, 12, 34, 30, 8, 40, 22, 36, 28, 16, 42, 24, 38].map(h => `<div style="flex:1;height:${h}px;border-radius:2px;background:var(--accent-soft);border-top:2px solid var(--accent)"></div>`).join('')}
                </div>
                <div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:9.5px;color:var(--ink-4);margin-top:7px"><span>14 d ago</span><span>today</span></div>
              </div>
              <div style="flex:none;padding:14px 20px;border-top:1px solid var(--border);background:var(--bg-2);display:flex;gap:8px">
                ${btn('Message', 'secondary', 'sm', 'send')}
                ${btn('Kick', 'secondary', 'sm')}
                ${btn('Ban', 'destructive', 'sm')}
              </div>
            </div>
          </div>
        </div>`;

  return screen({ active: 'Members', crumbs: ['Ashfold', 'Aurora SMP', 'Players'], main });
}

/* ── 7 · Backups ───────────────────────────────────────────────── */

export function backups() {
  const snaps = [
    ['daily-09-07', 'Scheduled', 'accent', '3.42 GB', 'today 03:00', '23 d', 'Complete', 'success'],
    ['pre-plugin-update', 'Manual', 'muted', '3.38 GB', 'yesterday 21:14', '7 d', 'Complete', 'success'],
    ['daily-09-06', 'Scheduled', 'accent', '3.31 GB', '6 Sep 03:00', '22 d', 'Complete', 'success'],
    ['daily-09-05', 'Scheduled', 'accent', '3.29 GB', '5 Sep 03:00', '21 d', 'Complete', 'success'],
    ['season-4-launch', 'Manual', 'muted', '2.90 GB', '18 Aug 19:02', 'forever', 'Locked', 'info'],
    ['daily-09-04', 'Scheduled', 'accent', '3.27 GB', '4 Sep 03:00', '20 d', 'Verify failed', 'danger']
  ].map(([n, kind, kt, size, when, keep, state, tone], i, a) => `<div style="display:grid;grid-template-columns:minmax(0,1fr) 104px 84px 132px 76px 128px 40px;gap:14px;align-items:center;padding:11px 18px;${i === a.length - 1 ? '' : 'border-bottom:1px solid var(--border);'}transition:background .12s" style-hover="background:var(--card-2)">
                <div style="display:flex;align-items:center;gap:10px;min-width:0">
                  <span style="color:var(--ink-4);display:grid;place-items:center;flex:none">${ic('archive', 15)}</span>
                  <span style="font-family:var(--mono);font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n}</span>
                </div>
                <div>${badge(kind, kt)}</div>
                <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-3)">${size}</span>
                <span style="font-size:11.5px;color:var(--ink-4)">${when}</span>
                <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-4)">${keep}</span>
                <div>${pill(state, tone)}</div>
                <button type="button" aria-label="Snapshot actions" style="width:26px;height:26px;border-radius:7px;display:grid;place-items:center;color:var(--ink-4);justify-self:end;transition:background .15s,color .15s" style-hover="background:var(--card-2);color:var(--ink)">${ic('dots', 15)}</button>
              </div>`).join('\n              ');

  const main = `        <div style="height:100%;overflow:hidden;padding:22px 32px 26px;display:flex;flex-direction:column;gap:16px">
          ${pageHead('Backups', 'Snapshots are taken without pausing ticks and verified against a checksum before the retention clock starts.', btn('Restore from file', 'secondary', 'md', 'upload') + btn('Back up now', 'primary', 'md', 'archive'))}

          <div style="${cardSt};padding:18px 20px;flex:none;border-color:var(--accent-line);background:linear-gradient(180deg,var(--accent-soft),transparent 60%),var(--card)">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
              <span style="width:26px;height:26px;border-radius:8px;display:grid;place-items:center;color:var(--accent);background:var(--accent-soft);flex:none">${ic('archive', 14)}</span>
              <div style="min-width:0">
                <div style="font-size:13px;font-weight:600">Snapshot in progress — daily-09-08</div>
                <div style="font-family:var(--mono);font-size:10.5px;color:var(--ink-4);margin-top:3px">compressing world_nether · 2.1 GB of 3.4 GB</div>
              </div>
              <span style="margin-left:auto;font-family:var(--mono);font-size:16px;font-weight:500;color:var(--accent);font-variant-numeric:tabular-nums">62%</span>
              ${btn('Cancel', 'ghost', 'sm')}
            </div>
            <div style="height:5px;border-radius:99px;background:var(--card-2);overflow:hidden"><div style="height:100%;width:62%;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2));transition:width .8s cubic-bezier(.2,.7,.3,1)"></div></div>
          </div>

          <div style="display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:16px;flex:1;min-height:0">
            <div style="${cardSt};overflow:hidden;display:flex;flex-direction:column">
              <div style="display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid var(--border);flex:none">
                <h2 style="margin:0;font-size:13.5px;font-weight:600">Snapshots</h2>
                <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-4)">6 kept · 251 GB of 400 GB pool</span>
                ${btn('Filter', 'ghost', 'sm', 'filter')}
              </div>
              ${tableHead([['Snapshot', 'minmax(0,1fr)'], ['Trigger', '104px'], ['Size', '84px'], ['Taken', '132px'], ['Keeps', '76px'], ['State', '128px'], ['', '40px']])}
              <div style="flex:1;min-height:0;overflow:hidden">
              ${snaps}
              </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:16px;min-height:0">
              <div style="${cardSt};padding:18px 20px;flex:none">
                <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:14px">
                  <h2 style="margin:0;font-size:13.5px;font-weight:600">Schedule</h2>
                  <a href="#" style="margin-left:auto;font-size:11.5px">Edit</a>
                </div>
                <div style="display:flex;align-items:center;gap:10px;padding:11px 12px;border-radius:10px;background:var(--bg-2);border:1px solid var(--border);margin-bottom:12px">
                  <span style="color:var(--accent);display:grid;place-items:center;flex:none">${ic('clock', 15)}</span>
                  <div style="min-width:0">
                    <div style="font-size:12px;font-weight:500">Every day at 03:00 UTC</div>
                    <div style="font-family:var(--mono);font-size:10px;color:var(--ink-4);margin-top:2px">next in 12 h 34 m</div>
                  </div>
                </div>
                ${[['Keep daily', '7'], ['Keep weekly', '4'], ['Keep monthly', '6'], ['Verify checksum', 'on']].map(([k, v]) => `<div style="display:flex;align-items:baseline;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
                  <span style="font-size:11.5px;color:var(--ink-4);flex:1">${k}</span>
                  <span style="font-family:var(--mono);font-size:11.5px">${v}</span>
                </div>`).join('\n                ')}
              </div>

              <div style="${cardSt};padding:18px 20px;flex:1;min-height:0">
                <h2 style="margin:0 0 16px;font-size:13.5px;font-weight:600">Storage pool</h2>
                <div style="display:flex;align-items:center;gap:18px">
                  <div style="position:relative;width:88px;height:88px;flex:none">
                    <svg viewBox="0 0 100 100" style="width:88px;height:88px;transform:rotate(-90deg)" role="img" aria-label="63% of the backup pool used">
                      <circle cx="50" cy="50" r="40" fill="none" stroke="var(--card-2)" stroke-width="12"/>
                      <circle cx="50" cy="50" r="40" fill="none" stroke="var(--accent)" stroke-width="12" stroke-linecap="round" stroke-dasharray="158 251"/>
                    </svg>
                    <div style="position:absolute;inset:0;display:grid;place-items:center">
                      <span style="font-family:var(--mono);font-size:15px;font-weight:600;font-variant-numeric:tabular-nums">63%</span>
                    </div>
                  </div>
                  <div style="min-width:0;display:flex;flex-direction:column;gap:9px">
                    ${[['Snapshots', '251 GB', 'var(--accent)'], ['Free', '149 GB', 'var(--card-2)']].map(([k, v, c]) => `<div style="display:flex;align-items:center;gap:8px">
                      <span style="width:8px;height:8px;border-radius:2px;background:${c};flex:none"></span>
                      <span style="font-size:11.5px;color:var(--ink-3);flex:1">${k}</span>
                      <span style="font-family:var(--mono);font-size:11px;color:var(--ink-2)">${v}</span>
                    </div>`).join('\n                    ')}
                    <p style="margin:6px 0 0;font-size:11px;color:var(--ink-4);line-height:1.5">Retention frees roughly 3.3 GB a day once the daily window fills.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>`;

  return screen({ active: 'Backups', crumbs: ['Ashfold', 'Aurora SMP', 'Backups'], main });
}

/* ── 8 · Scheduler ─────────────────────────────────────────────── */

export function scheduler() {
  const tasks = [
    ['Nightly snapshot', 'archive', '0 3 * * *', 'Every day · 03:00', 'in 12 h 34 m', 'Succeeded', 'success', true],
    ['Restart before peak', 'restart', '0 17 * * *', 'Every day · 17:00', 'in 2 h 34 m', 'Succeeded', 'success', true],
    ['Broadcast rules', 'send', '*/30 * * * *', 'Every 30 minutes', 'in 4 m', 'Succeeded', 'success', true],
    ['Prune old logs', 'trash', '0 4 * * 0', 'Sundays · 04:00', 'in 3 d', 'Succeeded', 'success', true],
    ['Sync plugin configs', 'branch', '0 5 * * 1', 'Mondays · 05:00', 'in 4 d', 'Failed', 'danger', true],
    ['Seasonal world reset', 'globe', '0 2 1 * *', 'First of the month', 'paused', 'Paused', 'muted', false]
  ].map(([n, icon, cron, cadence, next, state, tone, on], i, a) => `<div style="display:grid;grid-template-columns:minmax(0,1fr) 120px 152px 116px 124px 46px;gap:14px;align-items:center;padding:12px 18px;${i === a.length - 1 ? '' : 'border-bottom:1px solid var(--border);'}transition:background .12s" style-hover="background:var(--card-2)">
                <div style="display:flex;align-items:center;gap:11px;min-width:0">
                  <span style="width:28px;height:28px;border-radius:8px;display:grid;place-items:center;flex:none;color:${on ? 'var(--accent)' : 'var(--ink-4)'};background:${on ? 'var(--accent-soft)' : 'var(--card-2)'}">${ic(icon, 14)}</span>
                  <span style="font-size:12.5px;font-weight:500;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${on ? 'var(--ink)' : 'var(--ink-3)'}">${n}</span>
                </div>
                <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-4)">${cron}</span>
                <span style="font-size:11.5px;color:var(--ink-3)">${cadence}</span>
                <span style="font-family:var(--mono);font-size:10.5px;color:${on ? 'var(--ink-2)' : 'var(--ink-4)'}">${next}</span>
                <div>${pill(state, tone)}</div>
                <span style="width:32px;height:18px;border-radius:99px;flex:none;padding:2px;display:flex;justify-content:${on ? 'flex-end' : 'flex-start'};background:${on ? 'var(--accent)' : 'var(--card-2)'};border:1px solid ${on ? 'var(--accent-line)' : 'var(--border)'};justify-self:end"><span style="width:12px;height:12px;border-radius:50%;background:${on ? 'var(--accent-ink)' : 'var(--ink-4)'}"></span></span>
              </div>`).join('\n              ');

  const hours = ['00', '03', '06', '09', '12', '15', '18', '21'];
  const marks = [[12.5, 'archive', 'accent'], [16, 'trash', 'muted'], [50, 'send', 'info'], [70.8, 'restart', 'warning'], [92, 'send', 'info']];

  const main = `        <div style="height:100%;overflow:hidden;padding:22px 32px 26px;display:flex;flex-direction:column;gap:16px">
          ${pageHead('Scheduler', 'Cron-backed tasks with a real preview of when they will next fire, in your timezone and the server’s.', btn('Run history', 'secondary', 'md', 'history') + btn('New task', 'primary', 'md', 'plus'))}

          <div style="${cardSt};padding:18px 20px;flex:none">
            <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:18px">
              <h2 style="margin:0;font-size:13.5px;font-weight:600">Next 24 hours</h2>
              <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-4)">Europe/Berlin · server runs on UTC</span>
              <span style="margin-left:auto;display:flex;gap:14px">
                ${[['Backup', 'accent'], ['Restart', 'warning'], ['Broadcast', 'info'], ['Cleanup', 'muted']].map(([t, c]) => `<span style="display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:10px;color:var(--ink-4)"><span style="width:7px;height:7px;border-radius:2px;background:${c === 'muted' ? 'var(--ink-4)' : 'var(--' + c + ')'}"></span>${t}</span>`).join('\n                ')}
              </span>
            </div>
            <div style="position:relative;height:56px">
              <div style="position:absolute;left:0;right:0;top:26px;height:2px;border-radius:2px;background:var(--border)"></div>
              <div style="position:absolute;left:0;width:34%;top:26px;height:2px;border-radius:2px;background:var(--accent-line)"></div>
              ${marks.map(([x, i, c]) => `<div style="position:absolute;left:${x}%;top:12px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px">
                <span style="width:30px;height:30px;border-radius:9px;display:grid;place-items:center;color:${c === 'muted' ? 'var(--ink-3)' : 'var(--' + c + ')'};background:var(--card-2);border:1px solid ${c === 'muted' ? 'var(--border)' : 'var(--' + c + '-soft)'};box-shadow:var(--shadow-1)">${ic(i, 14)}</span>
              </div>`).join('\n              ')}
              <div style="position:absolute;left:34%;top:6px;bottom:14px;width:1px;background:var(--accent)"></div>
              <div style="position:absolute;left:34%;top:0;transform:translateX(-50%);font-family:var(--mono);font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:var(--accent)">now</div>
              <div style="position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:space-between;font-family:var(--mono);font-size:9.5px;color:var(--ink-4)">
                ${hours.map(h => `<span>${h}:00</span>`).join('')}
              </div>
            </div>
          </div>

          <div style="${cardSt};overflow:hidden;flex:1;min-height:0;display:flex;flex-direction:column">
            <div style="display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid var(--border);flex:none">
              <h2 style="margin:0;font-size:13.5px;font-weight:600">Tasks</h2>
              <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-4)">6 tasks · 5 enabled</span>
              <span style="margin-left:auto;display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--danger)">${ic('alert', 13)}Sync plugin configs failed twice in a row</span>
            </div>
            ${tableHead([['Task', 'minmax(0,1fr)'], ['Cron', '120px'], ['Cadence', '152px'], ['Next run', '116px'], ['Last result', '124px'], ['On', '46px', 'right']])}
            <div style="flex:1;min-height:0;overflow:hidden">
            ${tasks}
            </div>
          </div>
        </div>`;

  return screen({ active: 'Scheduler', crumbs: ['Ashfold', 'Aurora SMP', 'Scheduler'], main });
}

/* ── 9 · Plugins & marketplace ─────────────────────────────────── */

export function plugins() {
  const cats = [['All plugins', 428, true], ['Administration', 64], ['Performance', 38], ['World editing', 41], ['Economy', 55], ['Protection', 47], ['Chat & social', 72], ['Minigames', 61], ['Developer tools', 50]]
    .map(([t, n, on]) => `<button type="button" style="display:flex;align-items:center;gap:9px;width:100%;padding:7px 10px;border-radius:8px;font-size:12.5px;color:${on ? 'var(--ink)' : 'var(--ink-3)'};background:${on ? 'var(--accent-soft)' : 'transparent'};transition:background .15s" style-hover="background:var(--card-2)">
                <span style="flex:1;text-align:left">${t}</span>
                <span style="font-family:var(--mono);font-size:10px;color:var(--ink-4)">${n}</span>
              </button>`).join('\n              ');

  const cards = [
    ['EssentialsX', 'EssentialsX Team', 'The command set every server ends up needing — homes, warps, kits, moderation.', '2.20.1', '4.2M', 4.9, true, 'accent'],
    ['LuckPerms', 'lucko', 'Permissions with an audit trail, inheritance and a web editor.', '5.4.141', '3.8M', 4.9, true, 'accent'],
    ['Chunky', 'pop4959', 'Pre-generates world chunks so players never wait on terrain.', '1.4.28', '1.9M', 4.7, false, 'muted'],
    ['CoreProtect', 'Intelli', 'Block-level rollback and inspection for grief recovery.', '22.4', '2.6M', 4.8, false, 'muted'],
    ['Spark', 'lucko', 'Profiler for tick lag, memory and thread contention.', '1.10.119', '1.4M', 4.8, false, 'muted'],
    ['ViaVersion', 'ViaVersion', 'Lets newer clients join older server builds without a proxy.', '5.0.3', '3.1M', 4.6, false, 'muted']
  ].map(([n, author, desc, ver, dl, rating, installed, tone]) => `<div style="${cardSt};padding:18px;display:flex;flex-direction:column;gap:12px;transition:border-color .18s,transform .18s cubic-bezier(.2,.7,.3,1)" style-hover="border-color:var(--border-2);transform:translateY(-2px)">
                <div style="display:flex;gap:12px;align-items:flex-start">
                  ${cover('ICON', 40, 10)}
                  <div style="min-width:0;flex:1">
                    <div style="display:flex;align-items:center;gap:8px">
                      <span style="font-size:13.5px;font-weight:600;letter-spacing:-0.01em">${n}</span>
                      ${installed ? badge('installed', 'success') : ''}
                    </div>
                    <div style="font-family:var(--mono);font-size:10px;color:var(--ink-4);margin-top:4px">${author} · ${ver}</div>
                  </div>
                </div>
                <p style="margin:0;font-size:11.5px;color:var(--ink-3);line-height:1.55;flex:1">${desc}</p>
                <div style="display:flex;align-items:center;gap:12px">
                  <span style="display:flex;align-items:center;gap:5px;font-family:var(--mono);font-size:10px;color:var(--ink-4)"><span style="color:var(--accent);display:grid;place-items:center">${ic('star', 12, 2)}</span>${rating}</span>
                  <span style="display:flex;align-items:center;gap:5px;font-family:var(--mono);font-size:10px;color:var(--ink-4)">${ic('download', 12)}${dl}</span>
                  <span style="margin-left:auto">${installed ? btn('Configure', 'secondary', 'sm') : btn('Install', 'primary', 'sm', 'download')}</span>
                </div>
              </div>`).join('\n              ');

  const main = `        <div style="height:100%;overflow:hidden;padding:22px 32px 26px;display:flex;flex-direction:column;gap:16px">
          ${pageHead('Marketplace', 'Version-checked against Paper 1.21.4. Anything incompatible is filtered out before you see it.', btn('Upload a JAR', 'secondary', 'md', 'upload') + btn('Installed · 14', 'primary', 'md', 'package'))}

          <div style="display:grid;grid-template-columns:216px minmax(0,1fr);gap:16px;flex:1;min-height:0">
            <div style="${cardSt};padding:12px;display:flex;flex-direction:column;overflow:hidden">
              <div style="${tiny};padding:6px 10px 10px">categories</div>
              <div style="display:flex;flex-direction:column;gap:1px;flex:1;min-height:0;overflow:hidden">
              ${cats}
              </div>
              <div style="border-top:1px solid var(--border);margin-top:8px;padding:12px 10px 4px">
                <div style="${tiny};margin-bottom:10px">compatibility</div>
                ${['Paper 1.21.4', 'Java 21', 'Folia ready'].map((t, i) => `<div style="display:flex;align-items:center;gap:9px;padding:5px 0">
                  <span style="width:16px;height:16px;border-radius:5px;display:grid;place-items:center;flex:none;background:${i < 2 ? 'var(--accent)' : 'transparent'};border:1px solid ${i < 2 ? 'var(--accent)' : 'var(--border-2)'};color:var(--accent-ink)">${i < 2 ? ic('check', 10, 3.4) : ''}</span>
                  <span style="font-size:11.5px;color:var(--ink-3)">${t}</span>
                </div>`).join('\n                ')}
              </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:14px;min-height:0">
              <div style="display:flex;align-items:center;gap:10px;flex:none">
                <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:9px;background:var(--bg-2);border:1px solid var(--border);flex:1">
                  <span style="color:var(--ink-4);display:grid;place-items:center;flex:none">${ic('search', 14, 1.9)}</span>
                  <span style="flex:1;font-size:12.5px;color:var(--ink-4)">Search 428 compatible plugins…</span>
                  <kbd style="font-family:var(--mono);font-size:9.5px;padding:2px 6px;border-radius:5px;background:var(--card-2);border:1px solid var(--border);color:var(--ink-4)">/</kbd>
                </div>
                <div style="display:inline-flex;gap:1px;background:var(--border);border-radius:9px;padding:1px">
                  ${['Popular', 'Recently updated', 'Top rated'].map((t, i) => `<button type="button" style="padding:7px 13px;border-radius:8px;font-size:11.5px;background:${i === 0 ? 'var(--card-2)' : 'transparent'};color:${i === 0 ? 'var(--ink)' : 'var(--ink-3)'};transition:background .15s,color .15s">${t}</button>`).join('\n                  ')}
                </div>
              </div>
              <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-content:start;flex:1;min-height:0;overflow:hidden">
              ${cards}
              </div>
            </div>
          </div>
        </div>`;

  return screen({ active: 'Marketplace', crumbs: ['Ashfold', 'Marketplace'], main });
}
