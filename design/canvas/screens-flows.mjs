import { ic, pill, badge, btn, meter, avatar, cover, cardSt, label, tiny } from './lib.mjs';
import { screen, sidebar, topbar } from './chrome.mjs';

/* ── 14 · Notifications & activity inbox ───────────────────────── */

export function notifications() {
  function row(icon, tone, title, body, when, unread) {
    return `<div style="display:flex;gap:13px;padding:14px 18px;border-bottom:1px solid var(--border);background:${unread ? 'var(--accent-soft)' : 'transparent'};transition:background .12s" style-hover="background:var(--card-2)">
                <span style="width:30px;height:30px;border-radius:9px;display:grid;place-items:center;flex:none;color:var(--${tone});background:var(--${tone}-soft)">${ic(icon, 15)}</span>
                <div style="min-width:0;flex:1">
                  <div style="display:flex;align-items:baseline;gap:10px">
                    <span style="font-size:12.5px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${title}</span>
                    <span style="font-family:var(--mono);font-size:10px;color:var(--ink-4);margin-left:auto;flex:none">${when}</span>
                  </div>
                  <p style="margin:5px 0 0;font-size:11.5px;color:var(--ink-3);line-height:1.55">${body}</p>
                </div>
                ${unread ? '<span style="width:7px;height:7px;border-radius:50%;background:var(--accent);flex:none;margin-top:6px"></span>' : ''}
              </div>`;
  }

  const today = [
    row('alert', 'warning', 'Singapore node at 91% memory', 'sgp-node-01 has been above its memory watermark for 22 minutes. Draining it will move three servers to Frankfurt.', '14:31', true),
    row('key', 'danger', 'API key revoked', 'Devi Vasquez revoked ci-deploy-key. Two pipelines reference it and will start failing on their next run.', '14:02', true),
    row('archive', 'success', 'Snapshot complete', 'aurora · daily-09-07 · 3.42 GB written and verified in 41 seconds.', '03:00', false)
  ].join('\n              ');

  const earlier = [
    row('restart', 'warning', 'Aurora SMP recovered a tick overload', 'The watchdog restarted the main thread after 2,481 ms behind. No players were disconnected.', 'yesterday', false),
    row('users', 'info', 'oakhollow was promoted to Moderator', 'Mara Kessler changed the role. Console and file access came with it.', 'yesterday', false),
    row('package', 'accent', 'Three plugin updates available', 'EssentialsX 2.20.1, LuckPerms 5.4.141 and Spark 1.10.119 are all compatible with Paper 1.21.4.', '2 d ago', false)
  ].join('\n              ');

  const prefs = [
    ['Server crashed', true, true],
    ['Node degraded', true, true],
    ['Backup failed', true, false],
    ['Backup completed', false, false],
    ['Plugin update available', false, true],
    ['Member role changed', true, false]
  ].map(([k, email, push]) => `<div style="display:grid;grid-template-columns:minmax(0,1fr) 44px 44px;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
                  <span style="font-size:11.5px;color:var(--ink-2);min-width:0">${k}</span>
                  ${[email, push].map(on => `<span style="width:32px;height:18px;border-radius:99px;padding:2px;display:flex;justify-content:${on ? 'flex-end' : 'flex-start'};background:${on ? 'var(--accent)' : 'var(--card-2)'};border:1px solid ${on ? 'var(--accent-line)' : 'var(--border)'};justify-self:center"><span style="width:12px;height:12px;border-radius:50%;background:${on ? 'var(--accent-ink)' : 'var(--ink-4)'}"></span></span>`).join('\n                  ')}
                </div>`).join('\n                ');

  const main = `        <div style="height:100%;overflow:hidden;padding:22px 32px 26px;display:flex;flex-direction:column;gap:16px">
          <div style="display:flex;align-items:flex-end;gap:16px;flex:none">
            <div style="min-width:0">
              <h1 style="margin:0;font-size:24px;font-weight:600;letter-spacing:-0.025em">Notifications</h1>
              <p style="margin:7px 0 0;font-size:12.5px;color:var(--ink-3)">Two unread. Anything that pages you also lands here.</p>
            </div>
            <div style="margin-left:auto;display:flex;gap:8px;flex:none">
              ${btn('Mark all read', 'ghost', 'md', 'check')}
              ${btn('Preferences', 'secondary', 'md', 'settings')}
            </div>
          </div>

          <div style="display:flex;align-items:center;gap:10px;flex:none">
            <div style="display:inline-flex;gap:1px;background:var(--border);border-radius:9px;padding:1px">
              ${['All · 42', 'Unread · 2', 'Alerts · 9', 'Mentions · 0'].map((t, i) => `<button type="button" style="padding:7px 14px;border-radius:8px;font-size:11.5px;background:${i === 0 ? 'var(--card-2)' : 'transparent'};color:${i === 0 ? 'var(--ink)' : 'var(--ink-3)'};transition:background .15s,color .15s">${t}</button>`).join('\n              ')}
            </div>
            ${btn('Any server', 'secondary', 'sm', 'filter')}
          </div>

          <div style="display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:16px;flex:1;min-height:0">
            <div style="${cardSt};overflow:hidden;display:flex;flex-direction:column">
              <div style="padding:11px 18px;border-bottom:1px solid var(--border);background:var(--bg-2);flex:none;${tiny}">today</div>
              ${today}
              <div style="padding:11px 18px;border-bottom:1px solid var(--border);background:var(--bg-2);flex:none;${tiny}">earlier</div>
              <div style="flex:1;min-height:0;overflow:hidden">
              ${earlier}
              </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:16px;min-height:0">
              <div style="${cardSt};padding:18px 20px;flex:none">
                <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:6px">
                  <h2 style="margin:0;font-size:13.5px;font-weight:600">Delivery</h2>
                  <span style="margin-left:auto;display:flex;gap:12px;${tiny}"><span style="width:44px;text-align:center">email</span><span style="width:44px;text-align:center">push</span></span>
                </div>
                ${prefs}
              </div>

              <div style="${cardSt};padding:18px 20px;flex:1;min-height:0">
                <h2 style="margin:0 0 12px;font-size:13.5px;font-weight:600">Quiet hours</h2>
                <div style="display:flex;align-items:center;gap:12px;padding:12px 13px;border-radius:10px;background:var(--bg-2);border:1px solid var(--border)">
                  <span style="color:var(--accent);display:grid;place-items:center;flex:none">${ic('clock', 15)}</span>
                  <div style="min-width:0;flex:1">
                    <div style="font-size:12px;font-weight:500">23:00 → 07:00</div>
                    <div style="font-family:var(--mono);font-size:10px;color:var(--ink-4);margin-top:2px">Europe/Berlin</div>
                  </div>
                  <span style="width:36px;height:20px;border-radius:99px;padding:2px;display:flex;justify-content:flex-end;background:var(--accent);border:1px solid var(--accent-line);flex:none"><span style="width:14px;height:14px;border-radius:50%;background:var(--accent-ink)"></span></span>
                </div>
                <p style="margin:12px 0 0;font-size:11px;color:var(--ink-4);line-height:1.6">Crashes and node failures always break through quiet hours. Everything else waits until morning.</p>
              </div>
            </div>
          </div>
        </div>`;

  return screen({ active: 'Activity', crumbs: ['Ashfold', 'Notifications'], main });
}

/* ── 15 · Overlays: command palette, toasts, context menu ──────── */

export function overlays() {
  const paletteGroup = (heading, items) => `<div>
              <div style="${tiny};padding:12px 18px 6px">${heading}</div>
              ${items.map(([icon, t, meta, kbd, on]) => `<div style="display:flex;align-items:center;gap:12px;padding:9px 18px;background:${on ? 'var(--accent-soft)' : 'transparent'};transition:background .12s" style-hover="background:var(--card-2)">
                <span style="display:grid;place-items:center;flex:none;color:${on ? 'var(--accent)' : 'var(--ink-4)'}">${ic(icon, 15)}</span>
                <span style="flex:1;font-size:13px;color:${on ? 'var(--ink)' : 'var(--ink-2)'};min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t}</span>
                ${meta ? `<span style="font-family:var(--mono);font-size:10px;color:var(--ink-4)">${meta}</span>` : ''}
                ${kbd ? `<kbd style="font-family:var(--mono);font-size:9.5px;padding:2px 6px;border-radius:5px;background:var(--card-2);border:1px solid var(--border);color:var(--ink-4)">${kbd}</kbd>` : ''}
              </div>`).join('\n              ')}
            </div>`;

  const palette = `<div role="dialog" aria-modal="true" aria-label="Command palette" style="position:absolute;inset:0;z-index:80;background:hsl(230 30% 3% / .62);backdrop-filter:blur(4px);display:flex;align-items:flex-start;justify-content:center;padding:108px 20px 20px">
          <div style="width:600px;max-width:100%;background:var(--surface);border:1px solid var(--border-2);border-radius:var(--r-xl);box-shadow:var(--shadow-3);overflow:hidden;animation:gbRise .16s cubic-bezier(.2,.7,.3,1) both">
            <div style="display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid var(--border)">
              <span style="color:var(--ink-4);display:grid;place-items:center;flex:none">${ic('search', 17, 1.9)}</span>
              <span style="flex:1;font-size:14px;color:var(--ink-2)">restart<span style="display:inline-block;width:1.5px;height:15px;background:var(--accent);margin-left:2px;vertical-align:-2px;animation:gbCaret 1.05s step-end infinite"></span></span>
              <button type="button" aria-label="Close" style="font-family:var(--mono);font-size:9.5px;color:var(--ink-4);border:1px solid var(--border);border-radius:5px;padding:2px 6px">ESC</button>
            </div>
            <div style="max-height:392px;overflow:hidden;padding-bottom:6px">
              ${paletteGroup('Actions', [
                ['restart', 'Restart Aurora SMP', null, '⌘R', true],
                ['restart', 'Restart Ashfold Creative', null, null, false],
                ['clock', 'Schedule a restart before peak', null, null, false]
              ])}
              ${paletteGroup('Servers', [
                ['server', 'Aurora SMP', 'Running', null, false],
                ['server', 'Nightfall PvP', 'Starting', null, false],
                ['server', 'Wipe Wednesday', 'Stopped', null, false]
              ])}
              ${paletteGroup('Go to', [
                ['terminal', 'Console', null, '⌘⇧C', false],
                ['archive', 'Backups', null, '⌘B', false]
              ])}
            </div>
            <div style="display:flex;align-items:center;gap:16px;padding:10px 18px;border-top:1px solid var(--border);background:var(--bg-2)">
              ${[['↑↓', 'navigate'], ['↵', 'run'], ['⌘↵', 'run in background'], ['esc', 'dismiss']].map(([k, t]) => `<span style="display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--ink-4)"><kbd style="font-family:var(--mono);font-size:9.5px;padding:2px 5px;border-radius:4px;background:var(--card-2);border:1px solid var(--border)">${k}</kbd>${t}</span>`).join('\n              ')}
              <span style="margin-left:auto;font-family:var(--mono);font-size:9.5px;color:var(--ink-4)">8 results</span>
            </div>
          </div>
        </div>`;

  const toasts = `<div aria-live="polite" style="position:absolute;right:24px;bottom:24px;z-index:90;display:flex;flex-direction:column;gap:10px;width:340px">
          ${[
            ['check', 'success', 'Snapshot complete', 'aurora · daily-09-07 · 3.4 GB in 41 s'],
            ['alert', 'warning', 'Memory above 90%', 'Aurora SMP hit its heap ceiling twice this hour.']
          ].map(([icon, tone, title, body]) => `<div style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border-radius:var(--r);background:var(--surface);border:1px solid var(--border-2);box-shadow:var(--shadow-3);animation:gbRise .2s cubic-bezier(.2,.7,.3,1) both">
            <span style="width:24px;height:24px;border-radius:7px;display:grid;place-items:center;flex:none;color:var(--${tone});background:var(--${tone}-soft)">${ic(icon, 13, 2.4)}</span>
            <div style="min-width:0;flex:1">
              <div style="font-size:12.5px;font-weight:600">${title}</div>
              <div style="font-size:11.5px;color:var(--ink-3);margin-top:3px;line-height:1.5">${body}</div>
            </div>
            <button type="button" aria-label="Dismiss" style="color:var(--ink-4);flex:none;margin-top:1px;display:grid;place-items:center" style-hover="color:var(--ink)">${ic('x', 13)}</button>
          </div>`).join('\n          ')}
        </div>`;

  const menu = `<div role="menu" style="position:absolute;left:392px;top:436px;z-index:70;border-radius:10px;background:var(--surface);border:1px solid var(--border-2);box-shadow:var(--shadow-3);padding:5px;width:212px">
          ${[
            ['terminal', 'Open console', '⌘⇧C', null],
            ['restart', 'Restart', '⌘R', null],
            ['archive', 'Create snapshot', '⌘B', null],
            ['copy', 'Duplicate server', '', null],
            null,
            ['trash', 'Delete server', '⌫', 'var(--danger)']
          ].map(m => m === null
            ? '<div style="height:1px;background:var(--border);margin:5px 8px"></div>'
            : `<div role="menuitem" style="display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:7px;font-size:12.5px;color:${m[3] || 'var(--ink-2)'};transition:background .12s" style-hover="background:var(--card-2)">
            <span style="display:grid;place-items:center;flex:none;color:${m[3] || 'var(--ink-4)'}">${ic(m[0], 14)}</span>
            <span style="flex:1">${m[1]}</span>
            <span style="font-family:var(--mono);font-size:9.5px;color:var(--ink-4)">${m[2]}</span>
          </div>`).join('\n          ')}
        </div>`;

  // A muted stand-in for the page underneath, so the overlays read as overlays.
  const backdrop = `<div style="height:100%;padding:26px 32px;display:flex;flex-direction:column;gap:20px;filter:saturate(.7)">
          <div style="display:flex;align-items:flex-end;gap:20px;flex:none">
            <div>
              <h1 style="margin:0;font-size:30px;font-weight:600;letter-spacing:-0.025em;line-height:1.1">Good afternoon, Mara</h1>
              <p style="margin:8px 0 0;font-size:13.5px;color:var(--ink-3)">Three of four servers are up and holding 19.8 ticks per second.</p>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;flex:none">
            ${[['Servers online', '3'], ['Players now', '41'], ['Median TPS', '19.8'], ['Storage used', '412']].map(([k, v]) => `<div style="${cardSt};padding:20px">
              <div style="${label};margin-bottom:14px">${k}</div>
              <div style="font-size:30px;font-weight:600;letter-spacing:-0.03em;line-height:1;font-variant-numeric:tabular-nums;color:var(--ink-3)">${v}</div>
            </div>`).join('\n            ')}
          </div>
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;flex:1;min-height:0;align-content:start">
            ${[1, 2, 3, 4].map(() => `<div style="${cardSt};height:186px"></div>`).join('\n            ')}
          </div>
        </div>`;

  const body = `<div style="width:1440px;height:900px;display:flex;overflow:hidden;background:var(--bg);position:relative">
    ${sidebar('Dashboard')}
    <div style="flex:1;min-width:0;display:flex;flex-direction:column">
      ${topbar(['Ashfold', 'Dashboard'])}
      <main style="flex:1;min-height:0;overflow:hidden">
${backdrop}
      </main>
    </div>
    ${menu}
    ${palette}
    ${toasts}
  </div>`;

  return body;
}

/* ── 16 · Create-server wizard ─────────────────────────────────── */

function wizardShell(step, title, sub, content, footer) {
  const steps = ['Game', 'Version', 'Template', 'Resources', 'Review'];
  const rail = steps.map((s, i) => {
    const n = i + 1;
    const done = n < step;
    const on = n === step;
    return `<div style="display:flex;align-items:center;gap:10px;${i === steps.length - 1 ? '' : 'flex:1;'}min-width:0">
              <span style="width:26px;height:26px;border-radius:50%;display:grid;place-items:center;flex:none;font-family:var(--mono);font-size:11px;font-weight:500;color:${done ? 'var(--accent-ink)' : on ? 'var(--accent)' : 'var(--ink-4)'};background:${done ? 'var(--accent)' : on ? 'var(--accent-soft)' : 'var(--card-2)'};border:1px solid ${done || on ? 'var(--accent-line)' : 'var(--border)'}">${done ? ic('check', 12, 3.2) : n}</span>
              <span style="font-size:12.5px;font-weight:${on ? '500' : '400'};color:${on ? 'var(--ink)' : done ? 'var(--ink-3)' : 'var(--ink-4)'};white-space:nowrap">${s}</span>
              ${i === steps.length - 1 ? '' : `<span style="flex:1;height:1px;background:${done ? 'var(--accent-line)' : 'var(--border)'};margin:0 4px;min-width:16px"></span>`}
            </div>`;
  }).join('\n            ');

  return `<div style="width:1440px;height:900px;overflow:hidden;background:var(--bg);display:flex;flex-direction:column;position:relative">
    <div aria-hidden="true" style="position:absolute;top:-220px;left:50%;transform:translateX(-50%);width:820px;height:420px;border-radius:50%;background:radial-gradient(closest-side,var(--accent-soft),transparent);pointer-events:none"></div>

    <header style="flex:none;display:flex;align-items:center;gap:12px;padding:0 40px;height:60px;border-bottom:1px solid var(--border);position:relative">
      <div style="width:26px;height:26px;border-radius:8px;background:var(--accent);display:grid;place-items:center;flex:none;color:var(--accent-ink)">${ic('zap', 15, 2.4)}</div>
      <span style="font-size:13.5px;font-weight:600;letter-spacing:-0.01em">Geeboard</span>
      <span style="width:1px;height:18px;background:var(--border);margin:0 4px"></span>
      <span style="font-size:13px;color:var(--ink-3)">Create a server</span>
      <span style="margin-left:auto;font-family:var(--mono);font-size:10.5px;color:var(--ink-4)">draft saved</span>
      <button type="button" aria-label="Cancel" style="width:32px;height:32px;border-radius:9px;display:grid;place-items:center;color:var(--ink-4);border:1px solid var(--border);margin-left:12px;transition:color .15s,border-color .15s" style-hover="color:var(--ink);border-color:var(--border-2)">${ic('x', 15)}</button>
    </header>

    <div style="flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;padding:28px 40px 0;position:relative">
      <div style="width:100%;max-width:1000px;display:flex;flex-direction:column;gap:26px;flex:1;min-height:0">
        <div style="display:flex;align-items:center;gap:10px;flex:none">
            ${rail}
        </div>
        <div style="flex:none">
          <h1 style="margin:0;font-size:28px;font-weight:600;letter-spacing:-0.03em;line-height:1.1">${title}</h1>
          <p style="margin:10px 0 0;font-size:13.5px;color:var(--ink-2);line-height:1.6;max-width:64ch">${sub}</p>
        </div>
        <div style="flex:1;min-height:0;overflow:hidden">
${content}
        </div>
      </div>
    </div>

    <footer style="flex:none;border-top:1px solid var(--border);background:var(--bg-2);padding:16px 40px;display:flex;align-items:center;gap:12px;position:relative">
      <div style="width:100%;max-width:1000px;margin:0 auto;display:flex;align-items:center;gap:12px">${footer}</div>
    </footer>
  </div>`;
}

export function wizardGame() {
  const games = [
    ['Minecraft: Java Edition', 'MC<br>JAVA', 'Paper, Purpur, Fabric, Forge and vanilla. The whole modded ecosystem.', '2.1M servers', true, true],
    ['Minecraft: Bedrock', 'MC<br>BEDROCK', 'Console and mobile crossplay, with add-on support.', '840k servers', true, false],
    ['Rust', 'RUST', 'Wipe cycles, Oxide plugins and a scheduler built around them.', '96k servers', true, false],
    ['Valheim', 'VALHEIM', 'Dedicated worlds with BepInEx mod loading.', '61k servers', false, false],
    ['Palworld', 'PALWORLD', 'Up to 32 players with automatic world compaction.', '58k servers', false, false],
    ['Satisfactory', 'SATIS-<br>FACTORY', 'Dedicated factories with blueprint sync.', '22k servers', false, false]
  ].map(([n, art, desc, pop, official, on]) => `<div style="background:var(--card);border:1px solid ${on ? 'var(--accent)' : 'var(--border)'};border-radius:var(--r-lg);padding:18px;display:flex;flex-direction:column;gap:14px;box-shadow:${on ? '0 0 0 3px var(--accent-soft),var(--shadow-2)' : 'var(--shadow-1)'};transition:border-color .18s,transform .18s cubic-bezier(.2,.7,.3,1)" style-hover="border-color:var(--border-2);transform:translateY(-3px)">
                <div style="display:flex;gap:14px;align-items:flex-start">
                  ${cover(art, 56, 13)}
                  <div style="min-width:0;flex:1">
                    <div style="display:flex;align-items:center;gap:7px">
                      <span style="font-size:14px;font-weight:600;letter-spacing:-0.015em;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n}</span>
                      ${official ? `<span title="Official image" style="color:var(--accent);display:grid;place-items:center;flex:none">${ic('shield', 14, 2)}</span>` : ''}
                    </div>
                    <div style="font-family:var(--mono);font-size:10px;color:var(--ink-4);margin-top:5px">${pop}</div>
                  </div>
                  <span style="width:18px;height:18px;border-radius:50%;flex:none;display:grid;place-items:center;background:${on ? 'var(--accent)' : 'transparent'};border:1px solid ${on ? 'var(--accent)' : 'var(--border-2)'};color:var(--accent-ink)">${on ? ic('check', 11, 3.4) : ''}</span>
                </div>
                <p style="margin:0;font-size:11.5px;color:var(--ink-3);line-height:1.55">${desc}</p>
              </div>`).join('\n              ');

  const content = `          <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-content:start">
              ${games}
          </div>`;

  const footer = `<span style="font-size:12px;color:var(--ink-4)">Step 1 of 5</span>
        <span style="margin-left:auto;display:flex;gap:8px">${btn('Cancel', 'ghost', 'md')}${btn('Choose a version', 'primary', 'md')}</span>`;

  return wizardShell(1, 'What are you hosting?', 'Pick the game and Geeboard sets the container image, the port layout and the sensible defaults that come with it. You can change all of them later.', content, footer);
}

export function wizardResources() {
  const slider = (lbl, hint, value, pct, minL, maxL, note) => `<div>
                  <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:12px">
                    <span style="font-size:13px;font-weight:500">${lbl}</span>
                    <span style="font-size:11.5px;color:var(--ink-4)">${hint}</span>
                    <span style="margin-left:auto;font-family:var(--mono);font-size:15px;font-weight:500;font-variant-numeric:tabular-nums">${value}</span>
                  </div>
                  <div style="position:relative;height:16px;display:flex;align-items:center">
                    <div style="height:4px;border-radius:99px;background:var(--card-2);width:100%"></div>
                    <div style="position:absolute;left:0;height:4px;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2));width:${pct}%"></div>
                    <div style="position:absolute;left:${pct}%;transform:translateX(-50%);width:16px;height:16px;border-radius:50%;background:var(--accent);border:2px solid var(--bg);box-shadow:0 0 0 1px var(--accent-line),0 4px 10px -4px var(--accent)"></div>
                  </div>
                  <div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:9.5px;color:var(--ink-4);margin-top:8px">
                    <span>${minL}</span><span style="color:var(--ink-3)">${note}</span><span>${maxL}</span>
                  </div>
                </div>`;

  const content = `          <div style="display:grid;grid-template-columns:minmax(0,1fr) 324px;gap:20px;align-items:start">
            <div style="${cardSt};padding:24px;display:flex;flex-direction:column;gap:24px">
              ${slider('CPU limit', 'percent of one core', '300%', 33, '50%', '800%', 'three cores')}
              ${slider('Memory', 'hard container ceiling', '8 GB', 24, '1 GB', '32 GB', 'recommended for 40 players')}
              ${slider('Storage', 'SSD quota, snapshots excluded', '60 GB', 22, '5 GB', '250 GB', 'world grows ~1 GB a week')}

              <div style="border-top:1px solid var(--border);padding-top:22px">
                <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:14px">
                  <span style="font-size:13px;font-weight:500">Ports</span>
                  <span style="font-size:11.5px;color:var(--ink-4)">allocated on fra-node-02</span>
                  <button type="button" style="margin-left:auto;display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--accent)">${ic('plus', 13)}Add a port</button>
                </div>
                <div style="display:flex;flex-direction:column;gap:8px">
                  ${[['Game', '25568', 'TCP + UDP', true], ['Query', '25569', 'UDP', false], ['RCON', '25570', 'TCP · private', false]].map(([k, port, proto, primary]) => `<div style="display:flex;align-items:center;gap:12px;padding:11px 13px;border-radius:10px;background:var(--bg-2);border:1px solid var(--border)">
                    <span style="font-size:12px;color:var(--ink-2);width:56px;flex:none">${k}</span>
                    <span style="font-family:var(--mono);font-size:12.5px;flex:none">${port}</span>
                    <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-4)">${proto}</span>
                    ${primary ? `<span style="margin-left:auto">${badge('primary', 'accent')}</span>` : `<button type="button" aria-label="Remove port" style="margin-left:auto;color:var(--ink-4);display:grid;place-items:center" style-hover="color:var(--danger)">${ic('x', 14)}</button>`}
                  </div>`).join('\n                  ')}
                </div>
              </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:16px">
              <div style="${cardSt};padding:20px">
                <h2 style="margin:0 0 14px;font-size:13px;font-weight:600">Placement</h2>
                <div style="display:flex;flex-direction:column;gap:8px">
                  ${[['fra-node-02', 'Frankfurt', '14 ms', '61% used', true], ['ash-node-01', 'Ashburn', '92 ms', '40% used', false], ['sgp-node-01', 'Singapore', '211 ms', 'full', false]].map(([n, city, ping, used, on]) => `<div style="display:flex;align-items:center;gap:11px;padding:11px 12px;border-radius:10px;background:${on ? 'var(--accent-soft)' : 'var(--bg-2)'};border:1px solid ${on ? 'var(--accent-line)' : 'var(--border)'};opacity:${used === 'full' ? '.5' : '1'}">
                    <span style="width:6px;height:6px;border-radius:50%;background:${used === 'full' ? 'var(--warning)' : 'var(--success)'};flex:none"></span>
                    <div style="min-width:0;flex:1">
                      <div style="font-family:var(--mono);font-size:11.5px">${n}</div>
                      <div style="font-size:10.5px;color:var(--ink-4);margin-top:2px">${city} · ${used}</div>
                    </div>
                    <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-3)">${ping}</span>
                  </div>`).join('\n                  ')}
                </div>
              </div>

              <div style="${cardSt};padding:20px">
                <h2 style="margin:0 0 12px;font-size:13px;font-weight:600">What this leaves</h2>
                ${[['CPU on node', 51, 'var(--accent)', '3 of 16 vCPU taken'], ['Memory on node', 67, 'var(--accent)', '8 GB of 128 GB taken'], ['Storage pool', 41, 'var(--accent)', '60 GB of 3.5 TB taken']].map(([k, pct, c, sub]) => `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
                  <div style="display:flex;justify-content:space-between;margin-bottom:7px"><span style="font-size:11.5px;color:var(--ink-3)">${k}</span><span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-2)">${pct}%</span></div>
                  ${meter(pct, c, 4)}
                  <div style="font-family:var(--mono);font-size:9.5px;color:var(--ink-4);margin-top:6px">${sub}</div>
                </div>`).join('\n                ')}
              </div>
            </div>
          </div>`;

  const footer = `<span style="font-size:12px;color:var(--ink-4)">Step 4 of 5</span>
        <span style="margin-left:auto;display:flex;gap:8px">${btn('Back', 'secondary', 'md')}${btn('Review', 'primary', 'md')}</span>`;

  return wizardShell(4, 'How much of the node does it get?', 'These are hard ceilings, not reservations — the container can burst up to them and no further. Everything here can be changed after the server exists.', content, footer);
}

export function wizardReview() {
  const rows = [
    ['Game', 'Minecraft: Java Edition', 'Paper server image · official'],
    ['Version', 'Paper 1.21.4 · build 218', 'Recommended · released 12 Aug 2025'],
    ['Template', 'Survival', 'Whitelist on, keep-inventory off, hard difficulty'],
    ['Resources', '8 GB memory · 300% CPU', '60 GB SSD quota'],
    ['Node', 'fra-node-02', 'Frankfurt · eu-central · 14 ms'],
    ['Address', 'nightwatch.ashfold.gg:25568', 'DNS propagates in about 60 seconds'],
    ['Backups', 'Daily at 03:00 UTC', 'Keep 7 daily, 4 weekly, 6 monthly']
  ].map(([k, v, s], i, a) => `<div style="display:flex;align-items:baseline;gap:20px;padding:15px 22px;${i === a.length - 1 ? '' : 'border-bottom:1px solid var(--border)'}">
                <span style="font-size:12px;color:var(--ink-4);width:104px;flex:none">${k}</span>
                <div style="min-width:0;flex:1">
                  <div style="font-size:13px;font-weight:500">${v}</div>
                  <div style="font-family:var(--mono);font-size:10.5px;color:var(--ink-4);margin-top:4px">${s}</div>
                </div>
                <button type="button" style="font-size:11.5px;color:var(--accent);flex:none">Change</button>
              </div>`).join('\n              ');

  const content = `          <div style="display:grid;grid-template-columns:minmax(0,1fr) 324px;gap:20px;align-items:start">
            <div style="${cardSt};overflow:hidden">
              <div style="padding:16px 22px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;background:var(--bg-2)">
                ${cover('MC<br>JAVA', 38, 10)}
                <div style="min-width:0">
                  <div style="font-size:14px;font-weight:600;letter-spacing:-0.015em">Nightwatch</div>
                  <div style="font-family:var(--mono);font-size:10px;color:var(--ink-4);margin-top:3px">new server · not yet created</div>
                </div>
                <span style="margin-left:auto">${pill('Ready to build', 'accent')}</span>
              </div>
              ${rows}
            </div>

            <div style="display:flex;flex-direction:column;gap:16px">
              <div style="${cardSt};padding:20px">
                <h2 style="margin:0 0 12px;font-size:13px;font-weight:600">What happens next</h2>
                ${[
                  ['Allocate the container on fra-node-02', 'about 4 seconds'],
                  ['Pull the Paper 1.21.4 image', 'cached · instant'],
                  ['Generate the world and spawn area', 'about 40 seconds'],
                  ['Point DNS at the allocation', 'about 60 seconds']
                ].map(([t, when], i, a) => `<div style="display:flex;gap:13px;padding-bottom:${i === a.length - 1 ? '0' : '14px'}">
                  <div style="position:relative;flex:none;width:9px;display:flex;justify-content:center;padding-top:5px">
                    <span style="width:7px;height:7px;border-radius:50%;background:var(--accent);z-index:1;flex:none;box-shadow:0 0 0 3px var(--card)"></span>
                    ${i === a.length - 1 ? '' : '<span style="position:absolute;top:12px;bottom:-12px;width:1px;background:var(--border)"></span>'}
                  </div>
                  <div style="min-width:0;flex:1">
                    <div style="font-size:12px;color:var(--ink-2);line-height:1.45">${t}</div>
                    <div style="font-family:var(--mono);font-size:9.5px;color:var(--ink-4);margin-top:3px">${when}</div>
                  </div>
                </div>`).join('\n                ')}
              </div>

              <div style="${cardSt};padding:18px 20px;border-color:var(--accent-line);background:linear-gradient(180deg,var(--accent-soft),transparent 70%),var(--card)">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:9px">
                  <span style="width:24px;height:24px;border-radius:7px;display:grid;place-items:center;color:var(--accent);background:var(--accent-soft);flex:none">${ic('info', 13)}</span>
                  <span style="font-size:12.5px;font-weight:600">Nothing is charged yet</span>
                </div>
                <p style="margin:0;font-size:11.5px;color:var(--ink-3);line-height:1.6">The node has the headroom for this. If you delete the server within an hour, no usage is recorded.</p>
              </div>
            </div>
          </div>`;

  const footer = `<span style="font-size:12px;color:var(--ink-4)">Step 5 of 5</span>
        <span style="margin-left:auto;display:flex;gap:8px">${btn('Back', 'secondary', 'md')}${btn('Create Nightwatch', 'primary', 'md', 'zap')}</span>`;

  return wizardShell(5, 'One last look before it exists.', 'Everything below is editable after creation except the node. Creating takes about a minute and you can watch it happen in the console.', content, footer);
}

/* ── 17 · Auth ─────────────────────────────────────────────────── */

export function auth() {
  const field = (lbl, value, aside, dim) => `<div>
              <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:7px">
                <label style="font-size:12px;font-weight:500">${lbl}</label>
                ${aside ? `<a href="#" style="margin-left:auto;font-size:11.5px">${aside}</a>` : ''}
              </div>
              <div style="width:100%;padding:11px 13px;border-radius:9px;background:var(--bg-2);border:1px solid ${dim ? 'var(--border)' : 'var(--accent-line)'};font-size:13px;color:${dim ? 'var(--ink-4)' : 'var(--ink)'};transition:border-color .15s">${value}</div>
            </div>`;

  return `<div style="width:1440px;height:900px;display:flex;overflow:hidden;background:var(--bg)">
    <div style="flex:1;min-width:0;position:relative;background:var(--bg-2);border-right:1px solid var(--border);display:flex;flex-direction:column;justify-content:space-between;padding:48px 56px;overflow:hidden">
      <div aria-hidden="true" style="position:absolute;bottom:-260px;left:-120px;width:720px;height:640px;border-radius:50%;background:radial-gradient(closest-side,var(--accent-soft),transparent);pointer-events:none"></div>
      <div aria-hidden="true" style="position:absolute;inset:0;background-image:linear-gradient(var(--border) 1px,transparent 1px),linear-gradient(90deg,var(--border) 1px,transparent 1px);background-size:64px 64px;opacity:.28;pointer-events:none"></div>

      <div style="display:flex;align-items:center;gap:11px;position:relative">
        <div style="width:30px;height:30px;border-radius:9px;background:var(--accent);display:grid;place-items:center;flex:none;color:var(--accent-ink);box-shadow:0 0 0 1px var(--accent-line),0 8px 24px -10px var(--accent)">${ic('zap', 17, 2.4)}</div>
        <span style="font-size:15px;font-weight:600;letter-spacing:-0.01em">Geeboard</span>
      </div>

      <div style="position:relative;max-width:34ch">
        <h1 style="margin:0;font-size:46px;font-weight:600;letter-spacing:-0.04em;line-height:1.04">Run the server. Not the server software.</h1>
        <p style="margin:22px 0 0;font-size:15px;color:var(--ink-2);line-height:1.65;max-width:44ch">Snapshots that verify themselves, a console that keeps up with a busy world, and permissions your moderators can actually understand.</p>
        <div style="display:flex;gap:32px;margin-top:36px">
          ${[['99.98%', 'panel uptime, 90 days'], ['2.1M', 'servers under management'], ['14 ms', 'median node latency']].map(([v, k]) => `<div>
            <div style="font-size:22px;font-weight:600;letter-spacing:-0.03em;font-variant-numeric:tabular-nums">${v}</div>
            <div style="font-size:11.5px;color:var(--ink-4);margin-top:5px">${k}</div>
          </div>`).join('\n          ')}
        </div>
      </div>

      <div style="position:relative;display:flex;align-items:center;gap:14px;font-family:var(--mono);font-size:10.5px;color:var(--ink-4)">
        <span>v3.2 · community</span><span style="width:3px;height:3px;border-radius:50%;background:var(--ink-4)"></span><span>status: all systems normal</span>
      </div>
    </div>

    <div style="width:560px;flex:none;display:flex;align-items:center;justify-content:center;padding:48px">
      <div style="width:100%;max-width:376px">
        <div style="${tiny};margin-bottom:14px">sign in</div>
        <h2 style="margin:0;font-size:28px;font-weight:600;letter-spacing:-0.03em;line-height:1.1">Welcome back</h2>
        <p style="margin:12px 0 30px;font-size:13px;color:var(--ink-3);line-height:1.6">Use your Geeboard account. Passkeys work in every browser we ship.</p>

        <div style="display:flex;flex-direction:column;gap:18px">
          ${field('Email', 'mara@ashfold.gg', null, false)}
          ${field('Password', '••••••••••••', 'Forgot?', true)}
          <div style="display:flex;align-items:center;gap:11px">
            <span style="width:17px;height:17px;border-radius:5px;flex:none;display:grid;place-items:center;background:var(--accent);border:1px solid var(--accent);color:var(--accent-ink)">${ic('check', 11, 3.4)}</span>
            <span style="font-size:12.5px;color:var(--ink-2)">Keep me signed in on this device</span>
          </div>
          <button type="button" style="width:100%;padding:12px 18px;border-radius:10px;background:var(--accent);color:var(--accent-ink);font-size:13.5px;font-weight:600;box-shadow:0 10px 26px -16px var(--accent);transition:filter .15s,transform .12s" style-hover="filter:brightness(1.07)" style-active="transform:translateY(1px) scale(.99)">Sign in</button>

          <div style="display:flex;align-items:center;gap:14px;margin:2px 0">
            <span style="flex:1;height:1px;background:var(--border)"></span>
            <span style="font-family:var(--mono);font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-4)">or</span>
            <span style="flex:1;height:1px;background:var(--border)"></span>
          </div>

          <div style="display:flex;flex-direction:column;gap:8px">
            ${[['lock', 'Continue with a passkey'], ['branch', 'Continue with GitHub']].map(([i, t]) => `<button type="button" style="display:flex;align-items:center;justify-content:center;gap:9px;width:100%;padding:11px 18px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--ink-2);font-size:13px;font-weight:500;transition:border-color .15s" style-hover="border-color:var(--border-2)">${ic(i, 15)}${t}</button>`).join('\n            ')}
          </div>
        </div>

        <p style="margin:28px 0 0;font-size:11.5px;color:var(--ink-4);line-height:1.6;text-align:center">No account? Ask your server owner for an invite.</p>
      </div>
    </div>
  </div>`;
}

export function authAlt() {
  const card = (tag, title, sub, fields, cta, foot) => `<div style="width:440px;flex:none;background:var(--card);border:1px solid var(--border);border-radius:var(--r-xl);box-shadow:var(--shadow-2);padding:34px 34px 30px;display:flex;flex-direction:column">
      <div style="${tiny};margin-bottom:12px">${tag}</div>
      <h2 style="margin:0;font-size:23px;font-weight:600;letter-spacing:-0.025em;line-height:1.15">${title}</h2>
      <p style="margin:11px 0 26px;font-size:12.5px;color:var(--ink-3);line-height:1.6">${sub}</p>
      <div style="display:flex;flex-direction:column;gap:16px;flex:1">
        ${fields.map(([lbl, ph, aside]) => `<div>
          <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:7px">
            <label style="font-size:12px;font-weight:500">${lbl}</label>
            ${aside ? `<a href="#" style="margin-left:auto;font-size:11.5px">${aside}</a>` : ''}
          </div>
          <div style="width:100%;padding:11px 13px;border-radius:9px;background:var(--bg-2);border:1px solid var(--border);font-size:13px;color:var(--ink-4)">${ph}</div>
        </div>`).join('\n        ')}
      </div>
      <button type="button" style="width:100%;margin-top:26px;padding:12px 18px;border-radius:10px;background:var(--accent);color:var(--accent-ink);font-size:13.5px;font-weight:600;box-shadow:0 10px 26px -16px var(--accent);transition:filter .15s,transform .12s" style-hover="filter:brightness(1.07)" style-active="transform:translateY(1px) scale(.99)">${cta}</button>
      <p style="margin:16px 0 0;font-size:11px;color:var(--ink-4);line-height:1.6;text-align:center">${foot}</p>
    </div>`;

  return `<div style="width:1000px;height:640px;display:flex;align-items:stretch;justify-content:center;gap:32px;padding:32px;background:var(--bg)">
    ${card('register', 'Create your panel', 'One account manages every server you own or help run.', [['Display name', 'Mara Kessler', null], ['Email', 'you@example.com', null], ['Password', '12 characters minimum', null]], 'Create account', 'By continuing you accept the acceptable-use policy.')}
    ${card('recover', 'Reset your password', 'We send a single-use link. It expires after fifteen minutes.', [['Email', 'you@example.com', null]], 'Send reset link', 'Still locked out? Recovery codes work here too.')}
  </div>`;
}
