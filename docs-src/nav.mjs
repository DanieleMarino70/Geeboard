// The order the site reads in, and the only place that decides it.
//
// The files in docs/ carry no ordering of their own any more: what used to be
// `nav_order` and `parent` in a Jekyll front matter is this list. A page that
// is not in it is not in the navigation, which the build treats as an error
// rather than as a quiet omission.
//
// Three readers, in the order a visitor usually is one: whoever installs it
// and keeps it running (an operator), whoever runs game servers on it (a
// user), and whoever builds on it or changes it (a developer). Installing on
// a server is the first page of the first section because that is what a
// visitor came for; the laptop trial is the hero's second button, not a step.
//
// Each section's first five pages are the home page's card for it, so the
// five a reader of that kind needs first come first.

export const sections = [
  {
    id: 'set-up',
    title: 'Install and run it',
    blurb: 'For whoever installs it: the panel, its nodes, the next release, and what to do when it will not start.',
    pages: [
      { file: 'production.md', title: 'Install Geeboard' },
      { file: 'nodes.md', title: 'Nodes' },
      { file: 'upgrading.md', title: 'Upgrade' },
      { file: 'troubleshooting.md', title: 'When it will not start' },
      { file: 'advanced-install.md', title: 'Advanced installation' },
      { file: 'installation.md', title: 'A checkout, and nodes in depth' },
      { file: 'daemon.md', title: 'The node agent' },
      { file: 'security.md', title: 'Security' },
      { file: 'release-matrix.md', title: 'On real machines' },
      { file: 'field-checks.md', title: 'Field checks' }
    ]
  },
  {
    id: 'run-it',
    title: 'Use it',
    blurb: 'For whoever runs game servers on it: servers, games, backups, and what it does and does not do yet.',
    pages: [
      { file: 'servers.md', title: 'Game servers' },
      { file: 'games.md', title: 'Games' },
      { file: 'backups.md', title: 'Backups' },
      { file: 'versions.md', title: 'Versions' },
      { file: 'notifications.md', title: 'Notifications' },
      { file: 'community-games.md', title: 'Community games' },
      { file: 'what-works.md', title: 'What works today' },
      { file: 'limitations.md', title: 'What does not work yet' },
      { file: 'roadmap.md', title: 'Roadmap' }
    ]
  },
  {
    id: 'how-it-works',
    title: 'Build on it',
    blurb: 'For whoever builds on it or changes it: the API, its promise, the architecture, and how it was built.',
    pages: [
      { file: 'reference.md', title: 'Reference' },
      { file: 'api.md', title: 'HTTP API' },
      { file: 'api-frozen.md', title: 'What the API promises' },
      { file: 'extending.md', title: 'Extending Geeboard' },
      { file: 'architecture.md', title: 'Architecture' },
      { file: 'dns-webhook.md', title: 'A DNS webhook' },
      { file: 'development.md', title: 'Develop' },
      { file: 'contributing.md', title: 'Contributing' },
      { file: 'history.md', title: 'How it was built' }
    ]
  }
];

// The home page is not part of a section: it is the site's root, and its
// primary invitation points at the first page of the first section.
export const home = { file: 'index.md', title: 'Geeboard' };

// The installation path, which is the one sequence in the documentation where
// a reader is mid-journey and needs to see where they are without scrolling.
// Each step names the page it lives on and, where the step is a section of a
// longer page, the anchor it starts at.
export const installPath = [
  { label: 'The panel', href: 'production.html', file: 'production.md' },
  { label: 'A node', href: 'nodes.html#registering-a-node', file: 'nodes.md' },
  { label: 'A game server', href: 'servers.html#creating-one', file: 'servers.md' }
];

// Every page in reading order, which is what "previous" and "next" follow.
export const order = sections.flatMap(section =>
  section.pages.map(page => ({ ...page, section }))
);

export const bySourceFile = new Map(order.map(page => [page.file, page]));
