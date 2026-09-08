import { ic, pill, badge, btn, meter, avatar, cover, cardSt, label, tiny } from './lib.mjs';

function sheet(num, title, intro, sections) {
  return `<div style="width:1240px;background:var(--bg);padding:44px 40px 56px;display:flex;flex-direction:column;gap:40px">
    <header style="display:flex;flex-direction:column;gap:16px">
      <div style="display:flex;align-items:center;gap:11px">
        <div style="width:30px;height:30px;border-radius:9px;background:var(--accent);display:grid;place-items:center;flex:none;color:var(--accent-ink);box-shadow:0 0 0 1px var(--accent-line),0 8px 24px -10px var(--accent)">${ic('zap', 17, 2.4)}</div>
        <div>
          <div style="font-size:14px;font-weight:600;letter-spacing:-0.01em">Geeboard</div>
          <div style="font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-4)">design system · v3.2</div>
        </div>
        <span style="margin-left:auto;font-family:var(--mono);font-size:10.5px;color:var(--accent)">${num}</span>
      </div>
      <div>
        <h1 style="margin:0;font-size:40px;font-weight:600;letter-spacing:-0.04em;line-height:1.05">${title}</h1>
        <p style="margin:16px 0 0;font-size:14.5px;color:var(--ink-2);line-height:1.65;max-width:70ch">${intro}</p>
      </div>
    </header>
    ${sections}
  </div>`;
}

function section(n, title, intro, body) {
  return `<section style="display:flex;flex-direction:column;gap:22px;padding-top:34px;border-top:1px solid var(--border)">
      <div>
        <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:8px">
          <span style="font-family:var(--mono);font-size:10.5px;color:var(--accent)">${n}</span>
          <h2 style="margin:0;font-size:24px;font-weight:600;letter-spacing:-0.025em">${title}</h2>
        </div>
        <p style="margin:0;color:var(--ink-3);font-size:13px;max-width:74ch;line-height:1.6">${intro}</p>
      </div>
      ${body}
    </section>`;
}

function panel(title, meta, body, pad = '22px') {
  return `<div style="${cardSt};overflow:hidden">
        ${title ? `<div style="padding:15px 22px;border-bottom:1px solid var(--border);display:flex;align-items:baseline;gap:10px">
          <h3 style="margin:0;font-size:12.5px;font-weight:600">${title}</h3>
          ${meta ? `<span style="font-family:var(--mono);font-size:10px;color:var(--ink-4)">${meta}</span>` : ''}
        </div>` : ''}
        <div style="padding:${pad}">${body}</div>
      </div>`;
}

/* ── A · Tokens ────────────────────────────────────────────────── */

export function tokens() {
  const COLORS = [
    ['Surfaces', 'five steps of depth, never more', [
      ['--bg', 'hsl(230 16% 5.5%)', 'App background, behind everything'],
      ['--bg-2', 'hsl(230 15% 7.5%)', 'Sidebar, topbar, table footers'],
      ['--surface', 'hsl(230 14% 9.5%)', 'Overlays: palette, dialogs, toasts'],
      ['--card', 'hsl(230 13% 11%)', 'Default card and panel fill'],
      ['--card-2', 'hsl(230 13% 14%)', 'Hover fill, meter troughs, chips']
    ]],
    ['Ink', 'four weights of text, plus two borders', [
      ['--ink', 'hsl(228 22% 97%)', 'Headings and primary values'],
      ['--ink-2', 'hsl(228 12% 78%)', 'Body copy, log messages'],
      ['--ink-3', 'hsl(228 11% 64%)', 'Secondary labels, inactive nav'],
      ['--ink-4', 'hsl(228 10% 56%)', 'Meta and units — the dimmest ink that still clears AA'],
      ['--border', 'hsl(230 11% 18%)', 'Default hairline'],
      ['--border-2', 'hsl(230 11% 26%)', 'Hover and overlay edges']
    ]],
    ['Accent', 'one hue, reserved for the primary path', [
      ['--accent', 'hsl(80 72% 60%)', 'Primary buttons, active nav, charts'],
      ['--accent-2', 'hsl(80 80% 72%)', 'Gradient end, link hover'],
      ['--accent-ink', 'hsl(80 60% 8%)', 'Text on accent fills'],
      ['--accent-soft', 'accent / 13%', 'Selected cards, soft chips'],
      ['--accent-line', 'accent / 30%', 'Selected borders, focus rings']
    ]],
    ['Status', 'never an accent, never decoration', [
      ['--success', 'hsl(166 68% 45%)', 'Running, healthy, verified'],
      ['--warning', 'hsl(38 94% 58%)', 'Starting, degraded, over 65%'],
      ['--danger', 'hsl(4 78% 60%)', 'Crashed, unreachable, destructive'],
      ['--info', 'hsl(218 92% 66%)', 'Player events, memory series, notes'],
      ['--wire', 'hsl(230 10% 22%)', 'Wireframe strokes and fills']
    ]],
    ['Console', 'the terminal maps ANSI onto the semantic palette', [
      ['--con-bg', 'hsl(230 20% 6.5%)', 'Log surface, darker than the app'],
      ['--con-ink', 'hsl(228 16% 86%)', 'Default log message'],
      ['--con-dim', 'hsl(228 10% 54%)', 'Timestamps and INFO level']
    ]]
  ].map(([name, note, items]) => `<div style="display:flex;flex-direction:column;gap:14px">
          <div style="display:flex;align-items:baseline;gap:10px">
            <h3 style="margin:0;font-size:13px;font-weight:600">${name}</h3>
            <span style="font-size:11.5px;color:var(--ink-4)">${note}</span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px">
            ${items.map(([tk, val, use]) => `<div style="border:1px solid var(--border);border-radius:var(--r);overflow:hidden;background:var(--card)">
              <div style="height:56px;background:var(${tk});border-bottom:1px solid var(--border)${tk === '--bg' || tk === '--bg-2' ? ';box-shadow:inset 0 0 0 1px var(--border)' : ''}"></div>
              <div style="padding:11px 13px">
                <div style="font-family:var(--mono);font-size:11px;color:var(--ink)">${tk}</div>
                <div style="font-family:var(--mono);font-size:9.5px;color:var(--ink-4);margin-top:4px">${val}</div>
                <div style="font-size:11px;color:var(--ink-3);margin-top:8px;line-height:1.45">${use}</div>
              </div>
            </div>`).join('\n            ')}
          </div>
        </div>`).join('\n        ');

  const contrast = [
    ['Primary heading on app background', '16.1:1', 'AAA', '--ink on --bg', 'background:var(--bg);color:var(--ink);border:1px solid var(--border)'],
    ['Body copy on a card', '9.8:1', 'AAA', '--ink-2 on --card', 'background:var(--card);color:var(--ink-2);border:1px solid var(--border)'],
    ['Primary button label', '11.2:1', 'AAA', '--accent-ink on --accent', 'background:var(--accent);color:var(--accent-ink);font-weight:600'],
    ['Mono meta and units', '4.9:1', 'AA', '--ink-4 on --card', 'background:var(--card);color:var(--ink-4);font-family:var(--mono);border:1px solid var(--border)']
  ].map(([demo, ratio, grade, pair, st]) => `<div style="border:1px solid var(--border);border-radius:var(--r);padding:16px 18px;background:var(--card)">
            <div style="${st};padding:14px;border-radius:8px;font-size:12.5px">${demo}</div>
            <div style="display:flex;align-items:baseline;gap:8px;margin-top:12px">
              <span style="font-family:var(--mono);font-size:14px;font-weight:500;color:var(--success)">${ratio}</span>
              <span style="font-family:var(--mono);font-size:9.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--ink-4)">${grade}</span>
            </div>
            <div style="font-size:11px;color:var(--ink-4);margin-top:5px">${pair}</div>
          </div>`).join('\n          ');

  const spacing = [['space-1', 4], ['space-2', 8], ['space-3', 12], ['space-4', 16], ['space-6', 24], ['space-8', 32], ['space-11', 44], ['space-16', 64]]
    .map(([n, px]) => `<div style="display:flex;align-items:center;gap:12px">
              <span style="font-family:var(--mono);font-size:10px;color:var(--ink-4);width:52px;flex:none">${n}</span>
              <span style="height:9px;width:${px * 2.2}px;border-radius:3px;background:var(--accent-soft);border:1px solid var(--accent-line)"></span>
              <span style="font-family:var(--mono);font-size:10px;color:var(--ink-3);flex:none">${px}px</span>
            </div>`).join('\n            ');

  const radii = [['sm', 6], ['base', 10], ['lg', 14], ['xl', 20]]
    .map(([n, px]) => `<div style="text-align:center">
              <div style="width:54px;height:54px;border-radius:${px}px;background:var(--card-2);border:1px solid var(--border-2)"></div>
              <div style="font-family:var(--mono);font-size:9.5px;color:var(--ink-3);margin-top:8px">radius-${n}</div>
              <div style="font-family:var(--mono);font-size:9px;color:var(--ink-4)">${px}px</div>
            </div>`).join('\n            ');

  const shadows = [
    ['elev-1', 'var(--shadow-1)', 'Resting cards', 'var(--card)', 'var(--border)'],
    ['elev-2', 'var(--shadow-2)', 'Hovered cards, dropdowns, tooltips', 'var(--card)', 'var(--border)'],
    ['elev-3', 'var(--shadow-3)', 'Focus traps: dialogs, command palette', 'var(--surface)', 'var(--border-2)']
  ].map(([n, sh, use, bg, bd]) => `<div style="display:flex;align-items:center;gap:14px">
              <div style="width:56px;height:40px;border-radius:10px;background:${bg};border:1px solid ${bd};box-shadow:${sh};flex:none"></div>
              <div style="min-width:0">
                <div style="font-family:var(--mono);font-size:10.5px;color:var(--ink-2)">${n}</div>
                <div style="font-size:11px;color:var(--ink-4);margin-top:3px">${use}</div>
              </div>
            </div>`).join('\n            ');

  const opacity = [['opacity-disabled', '.45', 'Disabled controls keep their shape'], ['opacity-muted', '.62', 'Revoked rows, past events'], ['opacity-scrim', '.62', 'Dialog and palette backdrop'], ['opacity-grid', '.28', 'Decorative background rules']]
    .map(([n, v, use]) => `<div style="display:flex;align-items:baseline;gap:12px;padding:9px 0;border-bottom:1px solid var(--border)">
              <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-2);width:136px;flex:none">${n}</span>
              <span style="font-family:var(--mono);font-size:10.5px;color:var(--accent);width:40px;flex:none">${v}</span>
              <span style="font-size:11.5px;color:var(--ink-4)">${use}</span>
            </div>`).join('\n            ');

  const motion = [
    ['duration-instant', '120ms', 'Button press, checkbox, switch knob'],
    ['duration-fast', '180ms', 'Hover, colour and border changes'],
    ['duration-base', '320ms', 'Screen enter, dialog, sidebar collapse'],
    ['duration-slow', '600ms', 'Meter and progress fills'],
    ['ease-out', 'cubic-bezier(.2,.7,.3,1)', 'Everything that enters or lifts'],
    ['ease-loop', 'cubic-bezier(.4,0,.6,1)', 'Indeterminate progress and pulses']
  ].map(([n, v, use]) => `<div style="border:1px solid var(--border);border-radius:var(--r);background:var(--card);padding:16px 18px">
            <div style="font-family:var(--mono);font-size:10.5px;color:var(--ink-2)">${n}</div>
            <div style="font-family:var(--mono);font-size:9.5px;color:var(--ink-4);margin-top:5px;word-break:break-all">${v}</div>
            <div style="font-size:11.5px;color:var(--ink-3);margin-top:10px;line-height:1.5">${use}</div>
          </div>`).join('\n          ');

  const named = `<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--border);border:1px solid var(--border);border-radius:var(--r);overflow:hidden">
          <div style="background:var(--card);padding:22px 18px;display:flex;flex-direction:column;gap:14px;align-items:flex-start">
            <div style="width:100%;height:44px;border-radius:var(--r);background:var(--card-2);border:1px solid var(--border);transition:transform .18s cubic-bezier(.2,.7,.3,1),border-color .18s" style-hover="transform:translateY(-3px);border-color:var(--border-2)"></div>
            <div><div style="font-family:var(--mono);font-size:10px;color:var(--ink-2)">card-lift</div><div style="font-size:11px;color:var(--ink-4);margin-top:3px">−3px, 180 ms</div></div>
          </div>
          <div style="background:var(--card);padding:22px 18px;display:flex;flex-direction:column;gap:14px;align-items:flex-start">
            <button type="button" style="padding:11px 18px;border-radius:var(--r);background:var(--accent);color:var(--accent-ink);font-size:13px;font-weight:600;transition:transform .12s cubic-bezier(.2,.7,.3,1),filter .15s" style-hover="filter:brightness(1.08)" style-active="transform:translateY(1px) scale(.98)">Press me</button>
            <div><div style="font-family:var(--mono);font-size:10px;color:var(--ink-2)">button-press</div><div style="font-size:11px;color:var(--ink-4);margin-top:3px">scale .98, 120 ms</div></div>
          </div>
          <div style="background:var(--card);padding:22px 18px;display:flex;flex-direction:column;gap:14px;align-items:flex-start">
            <div style="display:flex;align-items:center;gap:10px;height:44px">
              <span style="width:9px;height:9px;border-radius:50%;background:var(--warning);color:var(--warning);animation:gbPulse 2.2s ease-out infinite"></span>
              <span style="font-family:var(--mono);font-size:11px;color:var(--warning)">starting</span>
            </div>
            <div><div style="font-family:var(--mono);font-size:10px;color:var(--ink-2)">status-pulse</div><div style="font-size:11px;color:var(--ink-4);margin-top:3px">2.2 s loop, transitional states only</div></div>
          </div>
          <div style="background:var(--card);padding:22px 18px;display:flex;flex-direction:column;gap:14px;align-items:flex-start">
            <div style="width:100%;height:44px;display:flex;align-items:center">
              <div style="width:100%;height:5px;border-radius:99px;background:var(--card-2);overflow:hidden"><div style="height:100%;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2));animation:gbBar 3.2s cubic-bezier(.4,0,.6,1) infinite"></div></div>
            </div>
            <div><div style="font-family:var(--mono);font-size:10px;color:var(--ink-2)">progress-fill</div><div style="font-size:11px;color:var(--ink-4);margin-top:3px">width only, no shimmer</div></div>
          </div>
        </div>`;

  const breakpoints = [
    ['mobile', '&lt; 640px', 'Bottom bar of five items. One card per row, stat cards become a 2×2 grid, tables collapse to key–value blocks. Console is a full-height route with the command bar pinned above the keyboard.'],
    ['tablet', '640 – 899px', 'Bottom bar retained. Two-column card grid, charts keep full width, the wizard step rail wraps to two lines.'],
    ['laptop', '900 – 1279px', 'Sidebar appears, collapsed to 68px icons by default. Right rails move below the primary column.'],
    ['desktop', '≥ 1280px', 'Sidebar expanded to 252px, content capped at 1560px, dashboard right rail sits beside the server grid.']
  ].map(([n, range, note]) => `<div style="display:flex;gap:20px;padding:16px 22px;border-bottom:1px solid var(--border);align-items:baseline">
            <span style="font-family:var(--mono);font-size:11px;color:var(--ink);width:88px;flex:none">${n}</span>
            <span style="font-family:var(--mono);font-size:10.5px;color:var(--accent);width:112px;flex:none">${range}</span>
            <span style="font-size:12px;color:var(--ink-3);flex:1;line-height:1.55">${note}</span>
          </div>`).join('\n          ');

  const grid = `<div style="display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:16px">
            ${Array.from({ length: 12 }, () => '<div style="height:76px;border-radius:6px;background:var(--accent-soft);border:1px solid var(--accent-line)"></div>').join('\n            ')}
          </div>
          <div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:10px;color:var(--ink-4);margin-top:12px">
            <span>12 columns</span><span>16px gutter</span><span>32px page padding</span><span>1560px max content width</span>
          </div>`;

  return sheet('01 · foundations', 'Design tokens', 'Everything the panel paints with, declared in HSL so hue, saturation and lightness stay independently tunable. Dark is the primary experience; the light map re-derives every token rather than inverting it.', [
    section('01', 'Colour', 'Status hues never double as the accent, so a green button can never be mistaken for a healthy state. Soft variants are the same hue at 13–14% alpha, which keeps chips legible on every surface in the ramp.',
      `<div style="display:flex;flex-direction:column;gap:30px">${COLORS}</div>
      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:8px">${contrast}</div>`),

    section('02', 'Space, radius, elevation, opacity', 'One 8px rhythm with two half-steps for dense controls. Radius grows with the size of the surface: 6px on a chip, 20px on a wizard shell. Elevation has three levels and the third is reserved for things that trap focus.',
      `<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;align-items:start">
        ${panel('Spacing', '8px rhythm', `<div style="display:flex;flex-direction:column;gap:10px">${spacing}</div>`)}
        ${panel('Radius', 'grows with the surface', `<div style="display:flex;flex-wrap:wrap;gap:14px">${radii}</div>`)}
        ${panel('Elevation', 'three levels only', `<div style="display:flex;flex-direction:column;gap:18px">${shadows}</div>`)}
        ${panel('Opacity', 'four fixed values', opacity)}
      </div>`),

    section('03', 'Motion', 'Motion exists to explain a change of state, never to decorate. Nothing animates for longer than 320 ms except a status indicator that has to keep signalling, and every rule collapses to zero under <span style="font-family:var(--mono);font-size:12px">prefers-reduced-motion</span>.',
      `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px">${motion}</div>
      ${panel('Named interactions', 'hover a tile to see it', named, '0')}`),

    section('04', 'Grid & breakpoints', 'Below 900px the panel is not a narrower desktop. The sidebar becomes a five-item bottom bar, cards become full-width rows, and tables collapse into stacked key–value blocks.',
      `${panel('12-column grid', 'desktop', grid)}
      <div style="${cardSt};overflow:hidden">${breakpoints}</div>`)
  ].join('\n    '));
}

/* ── B · Typography ────────────────────────────────────────────── */

export function typography() {
  const scale = [
    ['display', '58 / 1.02 / −4%', 'Aurora SMP', 'Marketing and empty hero only', 'font-size:50px;font-weight:600;letter-spacing:-0.04em;line-height:1.02'],
    ['heading', '30 / 1.1 / −2.5%', 'Good afternoon, Mara', 'Page title, one per screen', 'font-size:30px;font-weight:600;letter-spacing:-0.025em;line-height:1.1'],
    ['title', '16 / 1.3 / −1.5%', 'Resource usage', 'Card and dialog headings', 'font-size:16px;font-weight:600;letter-spacing:-0.015em'],
    ['subtitle', '13.5 / 1.4 / 600', 'Node health', 'Section headings inside cards', 'font-size:13.5px;font-weight:600'],
    ['body', '13.5 / 1.6', 'Three of four servers are up and holding 19.8 ticks per second.', 'Descriptions and prose', 'font-size:13.5px;color:var(--ink-2);line-height:1.6'],
    ['caption', '11.5 / 1.5', 'vs 34 players last Saturday', 'Supporting meta under values', 'font-size:11.5px;color:var(--ink-4)'],
    ['label', 'mono 10 / .1em / caps', 'SERVERS ONLINE', 'Metric and column labels', 'font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-4)'],
    ['metric', '30 / 600 / tabular', '99.98%', 'Any number that updates live', 'font-size:30px;font-weight:600;letter-spacing:-0.03em;font-variant-numeric:tabular-nums'],
    ['console', 'mono 12 / 1.85', '[14:26:03 INFO]: Autosave complete · 1.2 GB', 'Log output, addresses, tokens', 'font-family:var(--mono);font-size:12px;color:var(--ink-2)']
  ].map(([n, spec, sample, use, st]) => `<div style="display:flex;align-items:baseline;gap:24px;padding:22px;border-bottom:1px solid var(--border)">
          <div style="width:112px;flex:none">
            <div style="font-family:var(--mono);font-size:10.5px;color:var(--ink-2)">${n}</div>
            <div style="font-family:var(--mono);font-size:9.5px;color:var(--ink-4);margin-top:4px">${spec}</div>
          </div>
          <div style="${st};min-width:0;flex:1">${sample}</div>
          <div style="font-size:11px;color:var(--ink-4);width:180px;flex:none">${use}</div>
        </div>`).join('\n        ');

  const weights = [400, 500, 600, 700].map(w => `<div style="border:1px solid var(--border);border-radius:var(--r);background:var(--card);padding:20px">
          <div style="font-size:30px;font-weight:${w};letter-spacing:-0.025em;line-height:1">Aa</div>
          <div style="font-family:var(--mono);font-size:10px;color:var(--ink-4);margin-top:14px">Geist ${w}</div>
          <div style="font-size:11px;color:var(--ink-3);margin-top:6px">${['Body copy and long prose', 'Emphasis, active nav, table values', 'Headings, buttons, metrics', 'Reserved — display only'][[400, 500, 600, 700].indexOf(w)]}</div>
        </div>`).join('\n        ');

  const numerals = `<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0;border:1px solid var(--border);border-radius:var(--r);overflow:hidden">
          <div style="padding:22px;border-right:1px solid var(--border);background:var(--card)">
            <div style="${tiny};margin-bottom:14px">tabular · correct</div>
            <div style="font-family:var(--mono);font-size:22px;font-variant-numeric:tabular-nums;line-height:1.5">
              <div>19.8 TPS</div><div>11.1 TPS</div><div>20.0 TPS</div>
            </div>
            <p style="margin:14px 0 0;font-size:11px;color:var(--ink-4);line-height:1.55">Digits keep the same advance width, so a live metric never jitters as it updates.</p>
          </div>
          <div style="padding:22px;background:var(--card);opacity:.72">
            <div style="${tiny};margin-bottom:14px">proportional · wrong here</div>
            <div style="font-size:22px;line-height:1.5">
              <div>19.8 TPS</div><div>11.1 TPS</div><div>20.0 TPS</div>
            </div>
            <p style="margin:14px 0 0;font-size:11px;color:var(--ink-4);line-height:1.55">Fine in prose. In a metric it shifts the decimal point on every tick.</p>
          </div>
        </div>`;

  const consoleColours = `<div style="background:var(--con-bg);border:1px solid var(--border);border-radius:var(--r);overflow:hidden">
          <div style="padding:11px 18px;border-bottom:1px solid var(--border);background:var(--bg-2);font-family:var(--mono);font-size:10.5px;color:var(--ink-3)">ansi → semantic mapping</div>
          <div style="padding:18px;font-family:var(--mono);font-size:11.5px;line-height:1.95">
            ${[
              ['14:22:16', 'INFO', 'Done (11.482s)! For help, type "help"', 'var(--con-dim)', 'var(--con-ink)'],
              ['14:24:31', 'JOIN', 'thornfield joined the game (23 online)', 'var(--info)', 'var(--con-ink)'],
              ['14:25:02', 'CMD', '/whitelist add lumen_verd', 'var(--accent)', 'var(--accent)'],
              ['14:25:44', 'WARN', "Can't keep up! Running 2481ms behind", 'var(--warning)', 'var(--warning)'],
              ['14:25:47', 'ERROR', 'Chunk file at [-12,41] is missing block state', 'var(--danger)', 'var(--danger)'],
              ['14:26:03', 'INFO', 'Autosave complete · 1.2 GB written in 840ms', 'var(--con-dim)', 'var(--con-ink)']
            ].map(([t, lvl, msg, lc, mc]) => `<div style="display:flex;gap:12px">
              <span style="color:var(--con-dim);flex:none;font-size:10.5px;padding-top:1px">${t}</span>
              <span style="color:${lc};flex:none;width:46px;font-size:10.5px;letter-spacing:.04em">${lvl}</span>
              <span style="color:${mc};min-width:0">${msg}</span>
            </div>`).join('\n            ')}
          </div>
          <div style="display:flex;gap:16px;padding:11px 18px;border-top:1px solid var(--border);background:var(--bg-2);font-family:var(--mono);font-size:9.5px;color:var(--ink-4)">
            <span>INFO → con-ink</span><span>WARN → warning</span><span>ERROR → danger</span><span>JOIN → info</span><span>CMD → accent</span>
          </div>
        </div>`;

  return sheet('02 · foundations', 'Typography', 'Geist for interface text, JetBrains Mono for anything a machine produced — addresses, timestamps, log output, token names, metric values. Two families, nine roles, no exceptions.', [
    section('01', 'The ramp', 'Every role below has one job. If a new piece of text does not fit one of them, the answer is almost always a different layout rather than a tenth size.',
      `<div style="${cardSt};overflow:hidden">${scale}</div>`),
    section('02', 'Weight', 'Geist ships four weights and the panel uses three. 700 exists for display type on marketing surfaces and is never used inside the product.',
      `<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px">${weights}</div>`),
    section('03', 'Numerals', 'Any number that can change while you are looking at it is tabular. That is metrics, meters, ping, player counts, sizes and timers.', numerals),
    section('04', 'Console type', 'The console maps ANSI severity onto the semantic palette rather than raw terminal colours, so output stays readable in light mode. Level sits in a fixed 46px gutter so messages align regardless of severity.', consoleColours)
  ].join('\n    '));
}

/* ── C · Component library ─────────────────────────────────────── */

export function components() {
  const buttonRows = [
    ['primary', [btn('Create server', 'primary', 'md'), btn('Small', 'primary', 'sm'), btn('Large', 'primary', 'lg'), btn('With icon', 'primary', 'md', 'plus')]],
    ['secondary', [btn('Restart', 'secondary', 'md'), btn('Small', 'secondary', 'sm'), btn('Large', 'secondary', 'lg'), btn('With icon', 'secondary', 'md', 'restart')]],
    ['ghost', [btn('Cancel', 'ghost', 'md'), btn('Filters', 'ghost', 'sm'), btn('With icon', 'ghost', 'md', 'filter')]],
    ['destructive', [btn('Stop server', 'destructive', 'md'), btn('Delete', 'destructive', 'sm'), btn('With icon', 'destructive', 'md', 'trash')]]
  ].map(([n, items]) => `<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
            <span style="font-family:var(--mono);font-size:10px;color:var(--ink-4);width:82px;flex:none">${n}</span>
            ${items.join('\n            ')}
          </div>`).join('\n          ');

  const states = `<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:20px">
            <span style="font-family:var(--mono);font-size:10px;color:var(--ink-4);width:82px;flex:none">states</span>
            <button type="button" style="padding:9px 16px;border-radius:9px;background:var(--accent);color:var(--accent-ink);font-size:13px;font-weight:600">Default</button>
            <button type="button" style="padding:9px 16px;border-radius:9px;background:var(--accent);color:var(--accent-ink);font-size:13px;font-weight:600;filter:brightness(1.08)">Hover</button>
            <button type="button" style="padding:9px 16px;border-radius:9px;background:var(--accent);color:var(--accent-ink);font-size:13px;font-weight:600;transform:translateY(1px) scale(.985)">Active</button>
            <button type="button" style="padding:9px 16px;border-radius:9px;background:var(--accent);color:var(--accent-ink);font-size:13px;font-weight:600;outline:2px solid var(--accent);outline-offset:2px">Focus</button>
            <button type="button" style="display:flex;align-items:center;gap:8px;padding:9px 16px;border-radius:9px;background:var(--accent);color:var(--accent-ink);font-size:13px;font-weight:600;opacity:.9">
              <span style="width:12px;height:12px;border-radius:50%;border:2px solid var(--accent-ink);border-top-color:transparent;animation:gbSpin .7s linear infinite"></span>Working
            </button>
            <button type="button" disabled="disabled" style="padding:9px 16px;border-radius:9px;background:var(--card-2);color:var(--ink-4);font-size:13px;font-weight:600;cursor:not-allowed;opacity:.45">Disabled</button>
          </div>`;

  const inputs = `<div style="display:flex;flex-direction:column;gap:20px">
            <div>
              <label style="display:block;font-size:12px;font-weight:500;margin-bottom:7px">Server name</label>
              <div style="width:100%;padding:10px 12px;border-radius:9px;background:var(--bg-2);border:1px solid var(--border);font-size:13px">Aurora SMP</div>
              <p style="margin:7px 0 0;font-size:11px;color:var(--ink-4)">Shown to players in the server list.</p>
            </div>
            <div>
              <label style="display:block;font-size:12px;font-weight:500;margin-bottom:7px">Focused</label>
              <div style="width:100%;padding:10px 12px;border-radius:9px;background:var(--bg-2);border:1px solid var(--accent-line);outline:2px solid var(--accent);outline-offset:2px;font-size:13px">Nightwatch<span style="display:inline-block;width:1.5px;height:14px;background:var(--accent);margin-left:1px;vertical-align:-2px;animation:gbCaret 1.05s step-end infinite"></span></div>
            </div>
            <div>
              <label style="display:block;font-size:12px;font-weight:500;margin-bottom:7px">Startup flags</label>
              <div style="display:flex;align-items:center;gap:9px;padding:10px 12px;border-radius:9px;background:var(--bg-2);border:1px solid var(--border)">
                <span style="font-family:var(--mono);font-size:11px;color:var(--ink-4);flex:none">java</span>
                <span style="flex:1;min-width:0;font-family:var(--mono);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">-Xms4G -Xmx8G -XX:+UseG1GC</span>
              </div>
            </div>
            <div>
              <label style="display:block;font-size:12px;font-weight:500;margin-bottom:7px">Port</label>
              <div style="width:100%;padding:10px 12px;border-radius:9px;background:var(--bg-2);border:1px solid var(--danger);font-family:var(--mono);font-size:12.5px">25565</div>
              <p style="margin:7px 0 0;font-size:11px;color:var(--danger)">Already allocated on fra-node-02.</p>
            </div>
            <div>
              <span style="display:block;font-size:12px;font-weight:500;margin-bottom:7px;color:var(--ink-4)">Region (locked)</span>
              <div style="width:100%;padding:10px 12px;border-radius:9px;background:var(--card-2);border:1px solid var(--border);font-size:13px;color:var(--ink-4);opacity:.7">Frankfurt · eu-central</div>
            </div>
            <div>
              <label style="display:block;font-size:12px;font-weight:500;margin-bottom:7px">Search</label>
              <div style="display:flex;align-items:center;gap:9px;padding:10px 12px;border-radius:9px;background:var(--bg-2);border:1px solid var(--border)">
                <span style="color:var(--ink-4);display:grid;place-items:center;flex:none">${ic('search', 14, 1.9)}</span>
                <span style="flex:1;font-size:12.5px;color:var(--ink-4)">Search or jump…</span>
                <kbd style="font-family:var(--mono);font-size:10px;padding:2px 5px;border-radius:5px;background:var(--card-2);border:1px solid var(--border);color:var(--ink-4)">⌘K</kbd>
              </div>
            </div>
          </div>`;

  const selects = `<div style="display:flex;flex-direction:column;gap:22px">
            <div>
              <span style="display:block;font-size:12px;font-weight:500;margin-bottom:7px">Node · combobox open</span>
              <div style="display:flex;align-items:center;gap:9px;padding:10px 12px;border-radius:9px;background:var(--bg-2);border:1px solid var(--accent-line)">
                <span style="font-family:var(--mono);font-size:12.5px;flex:1">fra-node-02 · Frankfurt</span>
                <span style="color:var(--ink-4);display:grid;place-items:center">${ic('down', 14, 2)}</span>
              </div>
              <div style="margin-top:6px;border-radius:9px;background:var(--surface);border:1px solid var(--border-2);box-shadow:var(--shadow-2);overflow:hidden">
                ${[['fra-node-02 · Frankfurt', '14 ms', true], ['ash-node-01 · Ashburn', '92 ms', false], ['sgp-node-01 · Singapore', 'full', false]].map(([t, meta, on]) => `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:${on ? 'var(--accent-soft)' : 'transparent'};color:${on ? 'var(--ink)' : 'var(--ink-2)'}">
                  <span style="font-family:var(--mono);font-size:12px;flex:1">${t}</span>
                  <span style="font-family:var(--mono);font-size:10px;color:var(--ink-4)">${meta}</span>
                  ${on ? `<span style="color:var(--accent);display:grid;place-items:center">${ic('check', 13, 2.6)}</span>` : ''}
                </div>`).join('\n                ')}
              </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:14px;border-top:1px solid var(--border);padding-top:20px">
              ${[['Autosave every 5 minutes', 'Writes the world to disk without pausing ticks', true], ['Whitelist only', 'Rejects anyone not on the allow list', false], ['Notify me on crash', 'Email plus a push to the mobile app', true]].map(([lbl, note, on]) => `<div style="display:flex;align-items:center;gap:12px">
                <span style="width:36px;height:20px;border-radius:99px;flex:none;padding:2px;display:flex;justify-content:${on ? 'flex-end' : 'flex-start'};background:${on ? 'var(--accent)' : 'var(--card-2)'};border:1px solid ${on ? 'var(--accent-line)' : 'var(--border)'};transition:background .18s"><span style="width:14px;height:14px;border-radius:50%;background:${on ? 'var(--accent-ink)' : 'var(--ink-4)'};transition:background .18s"></span></span>
                <span style="min-width:0;flex:1">
                  <span style="display:block;font-size:12.5px;font-weight:500">${lbl}</span>
                  <span style="display:block;font-size:11px;color:var(--ink-4);margin-top:2px">${note}</span>
                </span>
              </div>`).join('\n              ')}
            </div>

            <div style="display:flex;flex-direction:column;gap:12px;border-top:1px solid var(--border);padding-top:20px">
              ${[['Stop the server before restoring', true], ['Keep existing plugin configs', false], ['Notify players 60 seconds ahead', true]].map(([lbl, on]) => `<div style="display:flex;align-items:flex-start;gap:11px">
                <span style="width:17px;height:17px;border-radius:5px;flex:none;display:grid;place-items:center;margin-top:1px;background:${on ? 'var(--accent)' : 'transparent'};border:1px solid ${on ? 'var(--accent)' : 'var(--border-2)'};color:var(--accent-ink);transition:background .12s,border-color .12s">${on ? ic('check', 11, 3.4) : ''}</span>
                <span style="font-size:12.5px;color:var(--ink-2)">${lbl}</span>
              </div>`).join('\n              ')}
              <div style="display:flex;gap:18px;margin-top:6px">
                ${['Replace the world', 'Restore alongside'].map((t, i) => `<div style="display:flex;align-items:center;gap:10px">
                  <span style="width:17px;height:17px;border-radius:50%;flex:none;display:grid;place-items:center;border:1px solid ${i === 0 ? 'var(--accent)' : 'var(--border-2)'}">${i === 0 ? '<span style="width:8px;height:8px;border-radius:50%;background:var(--accent)"></span>' : ''}</span>
                  <span style="font-size:12.5px;color:var(--ink-2)">${t}</span>
                </div>`).join('\n                ')}
              </div>
            </div>

            <div style="border-top:1px solid var(--border);padding-top:20px">
              <span style="display:block;font-size:12px;font-weight:500;margin-bottom:12px">Memory · slider</span>
              <div style="position:relative;height:16px;display:flex;align-items:center">
                <div style="height:4px;border-radius:99px;background:var(--card-2);width:100%"></div>
                <div style="position:absolute;left:0;height:4px;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2));width:24%"></div>
                <div style="position:absolute;left:24%;transform:translateX(-50%);width:16px;height:16px;border-radius:50%;background:var(--accent);border:2px solid var(--bg);box-shadow:0 0 0 1px var(--accent-line),0 4px 10px -4px var(--accent)"></div>
              </div>
              <div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:9.5px;color:var(--ink-4);margin-top:8px"><span>1 GB</span><span style="color:var(--ink-2)">8 GB</span><span>32 GB</span></div>
            </div>
          </div>`;

  const navBits = `<div style="display:flex;flex-direction:column;gap:26px">
            <div>
              <div style="${tiny};margin-bottom:12px">tabs</div>
              <div role="tablist" style="display:flex;gap:2px;border-bottom:1px solid var(--border)">
                ${['Overview', 'Console', 'Files', 'Backups'].map((t, i) => `<button type="button" role="tab" aria-selected="${i === 0}" style="position:relative;padding:11px 15px 13px;font-size:12.5px;font-weight:${i === 0 ? '500' : '400'};color:${i === 0 ? 'var(--ink)' : 'var(--ink-3)'}">${t}<span style="position:absolute;left:8px;right:8px;bottom:-1px;height:2px;border-radius:2px;background:${i === 0 ? 'var(--accent)' : 'transparent'}"></span></button>`).join('\n                ')}
              </div>
            </div>
            <div>
              <div style="${tiny};margin-bottom:12px">segmented</div>
              <div style="display:inline-flex;gap:1px;background:var(--border);border-radius:9px;padding:1px">
                ${['Dark', 'Light', 'System'].map((t, i) => `<button type="button" style="padding:6px 14px;border-radius:8px;font-size:12px;background:${i === 0 ? 'var(--card-2)' : 'transparent'};color:${i === 0 ? 'var(--ink)' : 'var(--ink-3)'}">${t}</button>`).join('')}
              </div>
            </div>
            <div>
              <div style="${tiny};margin-bottom:12px">breadcrumb</div>
              <div style="display:flex;align-items:center;gap:7px">
                ${['Geeboard', 'Aurora SMP', 'Files'].map((c, i, a) => `<span style="font-size:12.5px;color:${i === a.length - 1 ? 'var(--ink)' : 'var(--ink-3)'};font-weight:${i === a.length - 1 ? '500' : '400'}">${c}</span>${i === a.length - 1 ? '' : `<span style="color:var(--ink-4);display:grid;place-items:center">${ic('right', 13, 2)}</span>`}`).join('')}
              </div>
            </div>
            <div>
              <div style="${tiny};margin-bottom:12px">pagination</div>
              <div style="display:flex;align-items:center;gap:4px">
                <button type="button" aria-label="Previous" style="width:30px;height:30px;border-radius:8px;display:grid;place-items:center;border:1px solid var(--border);color:var(--ink-4)">${ic('left', 14, 2)}</button>
                ${['1', '2', '3', '…', '24'].map((p, i) => `<button type="button" style="min-width:30px;height:30px;padding:0 8px;border-radius:8px;font-family:var(--mono);font-size:11.5px;background:${i === 1 ? 'var(--accent-soft)' : 'transparent'};border:1px solid ${i === 1 ? 'var(--accent-line)' : 'transparent'};color:${i === 1 ? 'var(--accent)' : 'var(--ink-3)'}">${p}</button>`).join('')}
                <button type="button" aria-label="Next" style="width:30px;height:30px;border-radius:8px;display:grid;place-items:center;border:1px solid var(--border);color:var(--ink-2)">${ic('right', 14, 2)}</button>
              </div>
            </div>
            <div>
              <div style="${tiny};margin-bottom:12px">tooltip &amp; context menu</div>
              <div style="display:flex;gap:22px;align-items:flex-start">
                <div>
                  <div style="display:inline-block;padding:7px 10px;border-radius:8px;background:var(--surface);border:1px solid var(--border-2);box-shadow:var(--shadow-2);font-size:11.5px;color:var(--ink-2);max-width:190px">Restarts after the current tick finishes. Players see a 10-second warning.</div>
                  <div style="width:8px;height:8px;background:var(--surface);border-right:1px solid var(--border-2);border-bottom:1px solid var(--border-2);transform:rotate(45deg);margin:-4px 0 0 22px"></div>
                </div>
                <div style="border-radius:10px;background:var(--surface);border:1px solid var(--border-2);box-shadow:var(--shadow-2);padding:5px;min-width:186px">
                  ${[['terminal', 'Open console', '⌘⇧C', null], ['archive', 'Create snapshot', '⌘B', null], ['copy', 'Duplicate server', '', null], ['trash', 'Delete server', '⌫', 'var(--danger)']].map(m => `<div style="display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:7px;font-size:12.5px;color:${m[3] || 'var(--ink-2)'}">
                    <span style="display:grid;place-items:center;flex:none;color:${m[3] || 'var(--ink-4)'}">${ic(m[0], 14)}</span>
                    <span style="flex:1">${m[1]}</span>
                    <span style="font-family:var(--mono);font-size:9.5px;color:var(--ink-4)">${m[2]}</span>
                  </div>`).join('\n                  ')}
                </div>
              </div>
            </div>
          </div>`;

  const indicators = `<div style="display:flex;flex-direction:column;gap:26px">
            <div>
              <div style="${tiny};margin-bottom:12px">server &amp; node states</div>
              <div style="display:flex;flex-wrap:wrap;gap:9px">
                ${pill('Running', 'success')}${pill('Starting', 'warning', true)}${pill('Stopping', 'warning', true)}${pill('Stopped', 'muted')}${pill('Crashed', 'danger')}${pill('Unreachable', 'danger', true)}${pill('Draining', 'info', true)}${pill('Suspended', 'muted')}
              </div>
            </div>
            <div>
              <div style="${tiny};margin-bottom:12px">badges</div>
              <div style="display:flex;flex-wrap:wrap;gap:9px">
                ${badge('Recommended', 'accent')}${badge('LTS', 'success')}${badge('Experimental', 'warning')}${badge('Deprecated', 'danger')}${badge('Admin', 'info')}${badge('Beta', 'muted')}
              </div>
            </div>
            <div>
              <div style="${tiny};margin-bottom:12px">progress</div>
              <div style="display:flex;flex-direction:column;gap:16px">
                ${[['Backup · compressing', '62%', 'var(--accent)', 'height:100%;width:62%;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2))'],
                   ['Memory', '78%', 'var(--warning)', 'height:100%;width:78%;border-radius:99px;background:var(--warning)'],
                   ['Upload · world.zip', 'indeterminate', 'var(--ink-4)', 'height:100%;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2));animation:gbBar 3.2s cubic-bezier(.4,0,.6,1) infinite']]
                  .map(([lbl, pct, tone, bar]) => `<div>
                  <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:7px">
                    <span style="font-size:11.5px;color:var(--ink-2)">${lbl}</span>
                    <span style="font-family:var(--mono);font-size:10.5px;color:${tone}">${pct}</span>
                  </div>
                  <div style="height:5px;border-radius:99px;background:var(--card-2);overflow:hidden"><div style="${bar}"></div></div>
                </div>`).join('\n                ')}
              </div>
            </div>
            <div>
              <div style="${tiny};margin-bottom:12px">avatars &amp; presence</div>
              <div style="display:flex;align-items:center;gap:18px">
                <div style="display:flex">
                  ${['MK', 'DV', 'TR', 'AL'].map((a, i) => `<span style="margin-left:${i ? '-8px' : '0'};border-radius:50%;box-shadow:0 0 0 2px var(--card)">${avatar(a, 30)}</span>`).join('')}
                  <span style="margin-left:-8px;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:var(--card-2);border:1px solid var(--border);box-shadow:0 0 0 2px var(--card);font-family:var(--mono);font-size:10px;color:var(--ink-3)">+7</span>
                </div>
                <div style="position:relative">${avatar('MK', 34)}<span style="position:absolute;right:0;bottom:0;width:10px;height:10px;border-radius:50%;background:var(--success);box-shadow:0 0 0 2px var(--card)"></span></div>
                <div style="position:relative">${avatar('DV', 34)}<span style="position:absolute;right:0;bottom:0;width:10px;height:10px;border-radius:50%;background:var(--ink-4);box-shadow:0 0 0 2px var(--card)"></span></div>
              </div>
            </div>
          </div>`;

  return sheet('03 · library', 'Components', 'Every control the panel is built from, in the states it actually ships. Four button intents and no more — destructive actions are always outlined rather than filled, so a red block never sits where a primary action would.', [
    section('01', 'Buttons', 'Intent carries meaning: filled accent is the one forward path on a screen, outlined red is the one destructive path, and everything else is secondary or ghost.',
      panel('Buttons', 'intent × size × state', `<div style="display:flex;flex-direction:column;gap:20px">${buttonRows}${states}</div>`, '24px 22px')),
    section('02', 'Fields', 'Inputs sit on <span style="font-family:var(--mono);font-size:12px">--bg-2</span>, one step below the card they live in, so a form reads as a set of wells rather than a set of boxes.',
      `<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start">
        ${panel('Text fields', null, inputs)}
        ${panel('Select, toggles, radio, slider', null, selects)}
      </div>`),
    section('03', 'Navigation & indicators', 'Status is never colour alone: every state carries a word, and transitional states carry motion. That keeps the panel legible to colour-blind operators and readable in a screenshot pasted into a support thread.',
      `<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start">
        ${panel('Navigation', null, navBits)}
        ${panel('Indicators', null, indicators)}
      </div>`)
  ].join('\n    '));
}

/* ── D · Domain components ─────────────────────────────────────── */

export function domainCards() {
  const permCols = ['View', 'Console', 'Files', 'Delete'];
  const permRows = [
    ['Server: Aurora SMP', [1, 1, 1, 0]],
    ['Server: Wipe Wednesday', [1, 1, 0, -1]],
    ['Backups', [1, 0, 1, -1]],
    ['Scheduler', [1, 0, 0, 0]],
    ['Members', [1, 0, 0, -1]]
  ];
  const permTone = v => v === 1
    ? ['var(--success)', 'var(--success-soft)', 'hsl(166 68% 45% / .26)', '✓']
    : v === -1 ? ['var(--danger)', 'var(--danger-soft)', 'hsl(4 78% 60% / .26)', '✕']
      : ['var(--ink-4)', 'transparent', 'var(--border)', '–'];

  const permEditor = `<div style="${cardSt};overflow:hidden">
          <div style="display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--border)">
            <span style="font-size:12.5px;font-weight:600">Role: Moderator</span>
            <span style="font-family:var(--mono);font-size:10px;color:var(--ink-4)">3 overrides vs preset</span>
            <div style="margin-left:auto;display:flex;gap:14px;font-family:var(--mono);font-size:9.5px;color:var(--ink-4)"><span>inherit</span><span style="color:var(--success)">allow</span><span style="color:var(--danger)">deny</span></div>
          </div>
          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr>
                <th scope="col" style="text-align:left;${tiny};font-weight:400;padding:11px 20px;border-bottom:1px solid var(--border)">Resource</th>
                ${permCols.map(c => `<th scope="col" style="text-align:center;${tiny};font-weight:400;padding:11px 8px;border-bottom:1px solid var(--border);width:80px">${c}</th>`).join('\n                ')}
              </tr>
            </thead>
            <tbody>
              ${permRows.map(([name, cells]) => `<tr style="transition:background .15s" style-hover="background:var(--bg-2)">
                <td style="padding:11px 20px;border-bottom:1px solid var(--border);font-size:12.5px">${name}</td>
                ${cells.map((v, ci) => {
                  const T = permTone(v);
                  return `<td style="padding:9px 8px;border-bottom:1px solid var(--border);text-align:center">
                  <button type="button" aria-label="${name} · ${permCols[ci]} · ${v === 1 ? 'allow' : v === -1 ? 'deny' : 'inherit'}" style="width:28px;height:28px;border-radius:8px;display:grid;place-items:center;font-family:var(--mono);font-size:12px;color:${T[0]};background:${T[1]};border:1px solid ${T[2]};transition:background .15s,color .15s,border-color .15s">${T[3]}</button>
                </td>`;
                }).join('\n                ')}
              </tr>`).join('\n              ')}
            </tbody>
          </table>
        </div>`;

  const statCard = `<div style="${cardSt};padding:20px">
          <div style="${label};margin-bottom:14px">Players now</div>
          <div style="display:flex;align-items:flex-end;gap:8px"><span style="font-size:30px;font-weight:600;letter-spacing:-0.03em;line-height:1;font-variant-numeric:tabular-nums">41</span><span style="font-size:12px;color:var(--ink-4);padding-bottom:3px">peak 58</span></div>
          <div style="display:flex;align-items:center;gap:7px;margin-top:12px"><span style="font-family:var(--mono);font-size:10.5px;padding:2px 6px;border-radius:5px;color:var(--success);background:var(--success-soft)">+21%</span><span style="font-size:11.5px;color:var(--ink-4)">vs last Saturday</span></div>
        </div>`;

  const serverCard = `<div style="${cardSt};overflow:hidden">
          <div style="padding:18px;display:flex;gap:13px">
            ${cover('MC<br>ART')}
            <div style="min-width:0">
              <div style="font-size:14.5px;font-weight:600;letter-spacing:-0.015em">Aurora SMP</div>
              <div style="font-family:var(--mono);font-size:10px;color:var(--ink-4);margin-top:4px">1.21.4 · Paper</div>
              <div style="display:flex;align-items:center;gap:7px;margin-top:9px">
                ${pill('Running', 'success')}
                <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-3)">23 / 40</span>
              </div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--border);border-top:1px solid var(--border)">
            ${[['CPU', '34%', 34, 'var(--accent)'], ['RAM', '62%', 62, 'var(--info)'], ['DISK', '41%', 41, 'var(--ink-4)']].map(([k, v, pct, c]) => `<div style="background:var(--card);padding:11px 13px">
              <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="font-family:var(--mono);font-size:9px;letter-spacing:.07em;text-transform:uppercase;color:var(--ink-4)">${k}</span><span style="font-family:var(--mono);font-size:10px;color:var(--ink-2)">${v}</span></div>
              ${meter(pct, c, 3)}
            </div>`).join('\n            ')}
          </div>
        </div>`;

  const nodeCard = `<div style="${cardSt};padding:20px">
          <div style="display:flex;align-items:center;gap:9px;margin-bottom:16px">
            <span style="width:6px;height:6px;border-radius:50%;background:var(--success)"></span>
            <span style="font-family:var(--mono);font-size:12px;font-weight:500">fra-node-02</span>
            <span style="font-size:11px;color:var(--ink-4)">Frankfurt</span>
            <span style="margin-left:auto;font-family:var(--mono);font-size:10.5px;color:var(--ink-3)">14 ms</span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
            ${[['CPU', '48%', 48], ['RAM', '61%', 61], ['Disk', '39%', 39]].map(([k, v, pct]) => `<div>
              <div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:9.5px;color:var(--ink-4);margin-bottom:6px"><span>${k}</span><span style="color:var(--ink-2)">${v}</span></div>
              ${meter(pct, 'var(--accent)', 3)}
            </div>`).join('\n            ')}
          </div>
          <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border);display:flex;justify-content:space-between;font-family:var(--mono);font-size:10px;color:var(--ink-4)"><span>9 servers</span><span>daemon 2.4.1</span></div>
        </div>`;

  const userCard = `<div style="${cardSt};padding:20px">
          <div style="display:flex;align-items:center;gap:12px">
            ${avatar('DV', 38, '11px')}
            <div style="min-width:0;flex:1">
              <div style="font-size:13.5px;font-weight:600">Devi Vasquez</div>
              <div style="font-family:var(--mono);font-size:10.5px;color:var(--ink-4);margin-top:3px">devi@ashfold.gg</div>
            </div>
            ${badge('Admin', 'info')}
          </div>
          <div style="display:flex;gap:16px;margin-top:16px;padding-top:14px;border-top:1px solid var(--border);font-family:var(--mono);font-size:10px;color:var(--ink-4)"><span>2 servers</span><span>2FA on</span><span>last seen 4 h</span></div>
        </div>`;

  const timeline = `<div style="${cardSt};padding:22px">
          <h3 style="margin:0 0 18px;font-size:12.5px;font-weight:600">Timeline</h3>
          ${[
            ['thornfield', 'joined Aurora SMP', '2 min ago', 'var(--info)'],
            ['Scheduler', 'ran the nightly backup', '38 min ago', 'var(--accent)'],
            ['Mara', 'changed Java flags', '1 h ago', 'var(--ink-4)'],
            ['Watchdog', 'recovered a tick overload', '1 h ago', 'var(--warning)'],
            ['Devi', 'revoked an API key', '3 h ago', 'var(--danger)']
          ].map(([who, what, when, c], i, a) => `<div style="display:flex;gap:14px;padding-bottom:${i === a.length - 1 ? '0' : '16px'}">
            <div style="position:relative;flex:none;width:9px;display:flex;justify-content:center;padding-top:5px">
              <span style="width:7px;height:7px;border-radius:50%;background:${c};z-index:1;flex:none;box-shadow:0 0 0 3px var(--card)"></span>
              ${i === a.length - 1 ? '' : '<span style="position:absolute;top:12px;bottom:-14px;width:1px;background:var(--border)"></span>'}
            </div>
            <div style="min-width:0;flex:1">
              <div style="font-size:12.5px;line-height:1.45;color:var(--ink-2)"><span style="font-weight:500;color:var(--ink)">${who}</span> ${what}</div>
              <div style="font-family:var(--mono);font-size:10px;color:var(--ink-4);margin-top:3px">${when}</div>
            </div>
          </div>`).join('\n          ')}
        </div>`;

  const logViewer = `<div style="background:var(--con-bg);border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden">
          <div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border);background:var(--bg-2)">
            <span style="color:var(--ink-4);display:grid;place-items:center">${ic('terminal', 14)}</span>
            <span style="font-family:var(--mono);font-size:10.5px;color:var(--ink-3)">log viewer · 46px level gutter</span>
            <span style="margin-left:auto;display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:9.5px;color:var(--success)"><span style="width:5px;height:5px;border-radius:50%;background:currentColor;animation:gbPulse 2.2s ease-out infinite"></span>live</span>
          </div>
          <div style="padding:14px 16px;font-family:var(--mono);font-size:11.5px;line-height:1.95">
            ${[
              ['14:22:16', 'INFO', 'Done (11.482s)! For help, type "help"', 'var(--con-dim)', 'var(--con-ink)'],
              ['14:24:31', 'JOIN', 'thornfield joined the game (23 online)', 'var(--info)', 'var(--con-ink)'],
              ['14:25:02', 'CMD', '/whitelist add lumen_verd', 'var(--accent)', 'var(--accent)'],
              ['14:25:44', 'WARN', "Can't keep up! Running 2481ms behind", 'var(--warning)', 'var(--warning)'],
              ['14:25:47', 'ERROR', 'Chunk file at [-12,41] is missing block state', 'var(--danger)', 'var(--danger)']
            ].map(([t, lvl, msg, lc, mc]) => `<div style="display:flex;gap:12px">
              <span style="color:var(--con-dim);flex:none;font-size:10.5px;padding-top:1px">${t}</span>
              <span style="color:${lc};flex:none;width:46px;font-size:10.5px;letter-spacing:.04em">${lvl}</span>
              <span style="color:${mc};min-width:0">${msg}</span>
            </div>`).join('\n            ')}
          </div>
        </div>`;

  return sheet('04 · library', 'Domain components', 'The five cards the panel is actually built out of, plus the permission editor and the log viewer. Cover art is a striped placeholder until real artwork is supplied.', [
    section('01', 'Cards', 'Each card answers one question at a glance and hides the rest behind a click. The server card is the only one with a footer, because it is the only one with actions you take without opening anything.',
      `<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;align-items:start">
        <div><div style="${tiny};margin-bottom:10px">stat card</div>${statCard}</div>
        <div><div style="${tiny};margin-bottom:10px">server card</div>${serverCard}</div>
        <div><div style="${tiny};margin-bottom:10px">node card</div>${nodeCard}</div>
        <div><div style="${tiny};margin-bottom:10px">user card</div>${userCard}</div>
      </div>`),
    section('02', 'Permission editor', 'Three states per cell — inherit, allow, deny — cycled by clicking. Inherit is deliberately the quietest, because most cells should stay that way and a wall of green teaches an operator nothing.',
      permEditor),
    section('03', 'Log viewer & timeline', 'Both are chronological, and both put the machine-generated part in mono and the human-readable part in Geist. The log gutter is fixed at 46px so messages align regardless of severity.',
      `<div style="display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:16px;align-items:start">
        ${logViewer}
        ${timeline}
      </div>`)
  ].join('\n    '));
}

/* ── E · Screen states ─────────────────────────────────────────── */

export function states() {
  const skelLine = (w, delay) => `<div style="height:8px;width:${w};border-radius:5px;background:linear-gradient(90deg,var(--card-2) 25%,var(--border) 45%,var(--card-2) 65%);background-size:260% 100%;animation:gbSheen 1.5s ease-in-out ${delay} infinite"></div>`;

  const skeleton = `<div style="${cardSt};padding:20px">
          <div style="display:flex;gap:13px;margin-bottom:18px">
            <div style="width:46px;height:46px;border-radius:11px;flex:none;background:linear-gradient(90deg,var(--card-2) 25%,var(--border) 45%,var(--card-2) 65%);background-size:260% 100%;animation:gbSheen 1.5s ease-in-out infinite"></div>
            <div style="flex:1;display:flex;flex-direction:column;gap:8px;justify-content:center">
              ${skelLine('58%', '0s')}${skelLine('36%', '.1s')}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:9px">
            ${skelLine('92%', '.15s')}${skelLine('78%', '.2s')}${skelLine('86%', '.25s')}
          </div>
        </div>`;

  const empty = `<div style="${cardSt};padding:34px 22px;text-align:center">
          <div style="width:44px;height:44px;margin:0 auto 16px;border-radius:13px;border:1px dashed var(--border-2);display:grid;place-items:center;color:var(--ink-4)">${ic('archive', 20, 1.6)}</div>
          <div style="font-size:13.5px;font-weight:600">No snapshots yet</div>
          <p style="margin:8px auto 18px;font-size:12px;color:var(--ink-4);max-width:34ch;line-height:1.55">Take one now, or set a schedule and forget about it.</p>
          <div style="display:flex;gap:8px;justify-content:center">
            ${btn('Back up now', 'primary', 'sm')}${btn('Set a schedule', 'secondary', 'sm')}
          </div>
        </div>`;

  const error = `<div style="background:var(--card);border:1px solid hsl(4 78% 60% / .3);border-radius:var(--r-lg);padding:22px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
            <span style="width:26px;height:26px;border-radius:8px;display:grid;place-items:center;color:var(--danger);background:var(--danger-soft);flex:none">${ic('alert', 14)}</span>
            <div style="font-size:13px;font-weight:600">Daemon unreachable</div>
          </div>
          <p style="margin:0 0 16px;font-size:12px;color:var(--ink-3);line-height:1.55">fra-node-02 stopped answering 41 seconds ago. Your server is probably still running — the panel just can't see it.</p>
          <div style="font-family:var(--mono);font-size:10.5px;color:var(--ink-4);padding:10px 12px;border-radius:8px;background:var(--bg-2);border:1px solid var(--border);margin-bottom:14px">ECONNREFUSED 10.24.8.2:8080</div>
          <div style="display:flex;gap:8px">${btn('Retry now', 'destructive', 'sm')}${btn('View node', 'secondary', 'sm')}</div>
        </div>`;

  const success = `<div style="${cardSt};padding:34px 22px;text-align:center;border-color:var(--accent-line);background:linear-gradient(180deg,var(--accent-soft),transparent 60%),var(--card)">
          <div style="width:48px;height:48px;margin:0 auto 16px;border-radius:50%;display:grid;place-items:center;color:var(--accent-ink);background:var(--accent);box-shadow:0 0 0 6px var(--accent-soft)">${ic('check', 24, 3)}</div>
          <div style="font-size:14px;font-weight:600;letter-spacing:-0.015em">Nightwatch is live</div>
          <p style="margin:8px auto 18px;font-size:12px;color:var(--ink-3);max-width:36ch;line-height:1.55">The world generated in 38 seconds. DNS is propagating and will resolve within the minute.</p>
          <div style="display:inline-flex;align-items:center;gap:9px;padding:9px 13px;border-radius:9px;background:var(--bg-2);border:1px solid var(--border);margin-bottom:16px">
            <span style="font-family:var(--mono);font-size:11.5px">nightwatch.ashfold.gg:25568</span>
            <span style="color:var(--ink-4);display:grid;place-items:center">${ic('copy', 13)}</span>
          </div>
          <div style="display:flex;gap:8px;justify-content:center">${btn('Open console', 'primary', 'sm')}${btn('Invite players', 'secondary', 'sm')}</div>
        </div>`;

  const loading = `<div style="${cardSt};padding:34px 22px;text-align:center">
          <div style="width:44px;height:44px;margin:0 auto 16px;position:relative">
            <span style="position:absolute;inset:0;border-radius:50%;border:3px solid var(--card-2);border-top-color:var(--accent);animation:gbSpin .9s linear infinite"></span>
          </div>
          <div style="font-size:13.5px;font-weight:600">Starting Nightfall PvP</div>
          <p style="margin:8px auto 0;font-size:12px;color:var(--ink-4);max-width:34ch;line-height:1.55">Preparing the spawn area — 84%. This usually takes about forty seconds.</p>
          <div style="margin:16px auto 0;max-width:240px">${meter(84, 'linear-gradient(90deg,var(--accent),var(--accent-2))', 5)}</div>
        </div>`;

  const offline = `<div style="${cardSt};padding:34px 22px;text-align:center;opacity:.9">
          <div style="width:44px;height:44px;margin:0 auto 16px;border-radius:13px;display:grid;place-items:center;color:var(--warning);background:var(--warning-soft)">${ic('network', 20, 1.6)}</div>
          <div style="font-size:13.5px;font-weight:600">You are offline</div>
          <p style="margin:8px auto 18px;font-size:12px;color:var(--ink-4);max-width:34ch;line-height:1.55">The panel is showing the last state it received, 2 minutes ago. Actions are disabled until the connection returns.</p>
          ${btn('Retry connection', 'secondary', 'sm', 'refresh')}
        </div>`;

  const dialog = `<div style="background:var(--surface);border:1px solid var(--border-2);border-radius:var(--r-lg);box-shadow:var(--shadow-3);max-width:460px;overflow:hidden">
          <div style="padding:24px 24px 0">
            <h3 style="margin:0;font-size:16px;font-weight:600;letter-spacing:-0.015em">Delete Wipe Wednesday?</h3>
            <p style="margin:10px 0 18px;font-size:12.5px;color:var(--ink-3);line-height:1.6">This removes the container, all 11.2 GB of world data and every snapshot. It cannot be undone.</p>
            <label style="display:block;font-size:12px;font-weight:500;margin-bottom:7px">Type the server name to confirm</label>
            <div style="width:100%;padding:10px 12px;border-radius:9px;background:var(--bg-2);border:1px solid var(--border);font-family:var(--mono);font-size:12.5px;color:var(--ink-4)">Wipe Wednesday</div>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;padding:20px 24px;margin-top:20px;border-top:1px solid var(--border);background:var(--bg-2)">
            ${btn('Cancel', 'secondary', 'md')}${btn('Delete permanently', 'destructive', 'md')}
          </div>
        </div>`;

  const toasts = `<div style="display:flex;flex-direction:column;gap:10px">
          ${[['check', 'success', 'Snapshot complete', 'aurora · daily-09-07 · 3.4 GB in 41s'],
             ['alert', 'warning', 'Memory above 90%', 'Aurora SMP has hit its heap ceiling twice this hour.'],
             ['x', 'danger', 'Restore failed', 'Snapshot pre-wipe is missing two region files.']]
            .map(([i, tone, title, body]) => `<div style="display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border-radius:var(--r);background:var(--surface);border:1px solid var(--border-2);box-shadow:var(--shadow-2)">
            <span style="width:24px;height:24px;border-radius:7px;display:grid;place-items:center;flex:none;color:var(--${tone});background:var(--${tone}-soft)">${ic(i, 13, 2.4)}</span>
            <div style="min-width:0">
              <div style="font-size:12.5px;font-weight:600">${title}</div>
              <div style="font-size:11.5px;color:var(--ink-3);margin-top:3px;line-height:1.5">${body}</div>
            </div>
          </div>`).join('\n          ')}
        </div>`;

  return sheet('05 · patterns', 'Screen states', 'Every list, chart and panel has six states designed, not three. Skeletons mirror the real layout so nothing shifts when data lands, and no state is ever a bare spinner on an empty page.', [
    section('01', 'Waiting and arriving', 'A skeleton is used when the shape of the answer is known. A spinner is used only when it is not — a server starting, a world generating — and it always carries a sentence saying what is happening.',
      `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:start">
        <div><div style="${tiny};margin-bottom:10px">skeleton</div>${skeleton}</div>
        <div><div style="${tiny};margin-bottom:10px">loading · determinate</div>${loading}</div>
        <div><div style="${tiny};margin-bottom:10px">success</div>${success}</div>
      </div>`),
    section('02', 'Nothing, broken, disconnected', 'An empty state always offers the two things you would have gone looking for. An error always shows the machine detail — operators paste it into support threads — but never leads with it.',
      `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:start">
        <div><div style="${tiny};margin-bottom:10px">empty</div>${empty}</div>
        <div><div style="${tiny};margin-bottom:10px">error</div>${error}</div>
        <div><div style="${tiny};margin-bottom:10px">offline</div>${offline}</div>
      </div>`),
    section('03', 'Confirmation and feedback', 'Destructive dialogs ask you to type the name — not because it stops mistakes entirely, but because it makes the object of the sentence unambiguous. Toasts never carry the only copy of an important message.',
      `<div style="display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:16px;align-items:start">
        <div><div style="${tiny};margin-bottom:10px">dialog · destructive confirmation</div>${dialog}</div>
        <div><div style="${tiny};margin-bottom:10px">toasts</div>${toasts}</div>
      </div>`)
  ].join('\n    '));
}
