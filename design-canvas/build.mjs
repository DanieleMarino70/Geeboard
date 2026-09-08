import { writeFileSync } from 'node:fs';
import { doc } from './lib.mjs';
import { dashboard, serverDetail, consoleScreen, files } from './screens-core.mjs';
import { nodeDetail, players, backups, scheduler, plugins } from './screens-infra.mjs';
import { analytics, settings, auditLog, apiKeys } from './screens-org.mjs';
import { notifications, overlays, wizardGame, wizardResources, wizardReview, auth, authAlt } from './screens-flows.mjs';
import { tokens, typography, components, domainCards, states } from './sheets.mjs';
import { mobile } from './mobile.mjs';

const SCREEN = { w: 1440, h: 900 };

const artboards = [
  // ── page 1 · the product ──────────────────────────────────────
  { file: 'Main.dc.html', body: dashboard(), ...SCREEN, page: 'page-1', x: 0, y: 0, title: 'Dashboard' },
  { file: 'ServerDetail.dc.html', body: serverDetail(), ...SCREEN, page: 'page-1', x: 1560, y: 0, title: 'Server detail' },
  { file: 'Console.dc.html', body: consoleScreen(), ...SCREEN, page: 'page-1', x: 3120, y: 0, title: 'Console' },
  { file: 'Files.dc.html', body: files(), ...SCREEN, page: 'page-1', x: 4680, y: 0, title: 'File manager' },

  { file: 'NodeDetail.dc.html', body: nodeDetail(), ...SCREEN, page: 'page-1', x: 0, y: 1080, title: 'Node detail' },
  { file: 'Players.dc.html', body: players(), ...SCREEN, page: 'page-1', x: 1560, y: 1080, title: 'Player management' },
  { file: 'Backups.dc.html', body: backups(), ...SCREEN, page: 'page-1', x: 3120, y: 1080, title: 'Backups' },
  { file: 'Scheduler.dc.html', body: scheduler(), ...SCREEN, page: 'page-1', x: 4680, y: 1080, title: 'Scheduler' },

  { file: 'Marketplace.dc.html', body: plugins(), ...SCREEN, page: 'page-1', x: 0, y: 2160, title: 'Plugins & marketplace' },
  { file: 'Analytics.dc.html', body: analytics(), ...SCREEN, page: 'page-1', x: 1560, y: 2160, title: 'Analytics' },
  { file: 'Settings.dc.html', body: settings(), ...SCREEN, page: 'page-1', x: 3120, y: 2160, title: 'Settings' },
  { file: 'AuditLog.dc.html', body: auditLog(), ...SCREEN, page: 'page-1', x: 4680, y: 2160, title: 'Audit log' },

  { file: 'ApiKeys.dc.html', body: apiKeys(), ...SCREEN, page: 'page-1', x: 0, y: 3240, title: 'API keys' },
  { file: 'Notifications.dc.html', body: notifications(), ...SCREEN, page: 'page-1', x: 1560, y: 3240, title: 'Notifications' },
  { file: 'Overlays.dc.html', body: overlays(), ...SCREEN, page: 'page-1', x: 3120, y: 3240, title: 'Command palette & overlays' },
  { file: 'SignIn.dc.html', body: auth(), ...SCREEN, page: 'page-1', x: 4680, y: 3240, title: 'Sign in' },

  // ── page 2 · foundations ──────────────────────────────────────
  { file: 'Tokens.dc.html', body: tokens(), w: 1240, h: 3800, page: 'page-2', x: 0, y: 0, print: 'flow', title: 'Design tokens' },
  { file: 'Typography.dc.html', body: typography(), w: 1240, h: 2700, page: 'page-2', x: 1360, y: 0, print: 'flow', title: 'Typography' },
  { file: 'Components.dc.html', body: components(), w: 1240, h: 3000, page: 'page-2', x: 2720, y: 0, print: 'flow', title: 'Component library' },
  { file: 'DomainCards.dc.html', body: domainCards(), w: 1240, h: 2000, page: 'page-2', x: 4080, y: 0, print: 'flow', title: 'Domain components' },
  { file: 'States.dc.html', body: states(), w: 1240, h: 2000, page: 'page-2', x: 5440, y: 0, print: 'flow', title: 'Screen states' },

  // ── page 3 · flows & responsive ───────────────────────────────
  { file: 'WizardGame.dc.html', body: wizardGame(), ...SCREEN, page: 'page-3', x: 0, y: 0, title: 'Wizard · step 1 game' },
  { file: 'WizardResources.dc.html', body: wizardResources(), ...SCREEN, page: 'page-3', x: 1560, y: 0, title: 'Wizard · step 4 resources' },
  { file: 'WizardReview.dc.html', body: wizardReview(), ...SCREEN, page: 'page-3', x: 3120, y: 0, title: 'Wizard · step 5 review' },
  { file: 'SignUp.dc.html', body: authAlt(), w: 1000, h: 640, page: 'page-3', x: 4680, y: 0, title: 'Register & password reset' },
  { file: 'Mobile.dc.html', body: mobile(), w: 1360, h: 1320, page: 'page-3', x: 0, y: 1080, title: 'Mobile' }
];

for (const a of artboards) {
  writeFileSync(a.file, doc({ w: a.w, h: a.h, body: a.body }), 'utf8');
}

const canvas = {
  pages: [
    { id: 'page-1', name: 'Product' },
    { id: 'page-2', name: 'Foundations' },
    { id: 'page-3', name: 'Flows & responsive' }
  ],
  artboards: artboards.map(a => {
    const o = { file: a.file, x: a.x, y: a.y, w: a.w, h: a.h, page: a.page, title: a.title };
    if (a.print) o.print = a.print;
    return o;
  }),
  annotations: [
    {
      id: 'note-product',
      page: 'page-1',
      x: 0,
      y: -190,
      w: 620,
      text: 'PRODUCT — sixteen desktop screens at 1440 × 900.\nEvery value is lifted from the Geeboard handoff bundle: Geist + JetBrains Mono, the lime accent at hsl(80 72% 60%), the five-step surface ramp, 6/10/14/20 radii. Nothing here invents a new token.'
    },
    {
      id: 'note-foundations',
      page: 'page-2',
      x: 0,
      y: -190,
      w: 620,
      text: 'FOUNDATIONS — the system the screens are made of.\nColour, type, space, motion, grid, the full component library, the domain cards, and the six screen states every list and panel has designed for it.'
    },
    {
      id: 'note-flows',
      page: 'page-3',
      x: 0,
      y: -190,
      w: 620,
      text: 'FLOWS & RESPONSIVE — the create-server wizard (steps 1, 4 and 5), the auth screens, and the phone layouts.\nMobile is a different layout, not a narrower desktop: bottom bar, stacked cards, 44px minimum targets, no painted status bar or keyboard.'
    },
    {
      id: 'note-accent',
      page: 'page-2',
      x: 660,
      y: -190,
      w: 500,
      text: 'Every artboard carries two tweaks: theme (dark / light) and accent. Dark is the primary experience; the light map re-derives each token rather than inverting it.'
    }
  ],
  launch: { view: 'canvas', page: 'page-1' }
};

writeFileSync('canvas.json', JSON.stringify(canvas, null, 2), 'utf8');
console.log('wrote ' + artboards.length + ' artboards + canvas.json');
