// The order the site reads in, and the only place that decides it.
//
// The files in docs/ carry no ordering of their own any more: what used to be
// `nav_order` and `parent` in a Jekyll front matter is this list. A page that
// is not in it is not in the navigation, which the build treats as an error
// rather than as a quiet omission.
//
// Three levels of reading, in the order somebody meets them: put it up, run
// it, understand it. Installing on a server is the first page of the first
// section because that is what a visitor came for.

export const sections = [
  {
    id: 'set-up',
    title: 'Set it up',
    blurb: 'From a machine you already own to a panel you can sign in to.',
    pages: [
      { file: 'production.md', title: 'Install Geeboard' },
      { file: 'nodes.md', title: 'Add a node' },
      { file: 'installation.md', title: 'A checkout to try it' },
      { file: 'advanced-install.md', title: 'Advanced installation' },
      { file: 'daemon.md', title: 'The node agent' },
      { file: 'troubleshooting.md', title: 'When it will not start' }
    ]
  },
  {
    id: 'run-it',
    title: 'Run it day to day',
    blurb: 'Servers, their files, their backups, and the games on offer.',
    pages: [
      { file: 'servers.md', title: 'Game servers' },
      { file: 'backups.md', title: 'Backups' },
      { file: 'versions.md', title: 'Versions' },
      { file: 'games.md', title: 'Games' },
      { file: 'upgrading.md', title: 'Upgrade' }
    ]
  },
  {
    id: 'how-it-works',
    title: 'Know how it is built',
    blurb: 'The API, the security model, the architecture, and what is missing.',
    pages: [
      { file: 'reference.md', title: 'Reference' },
      { file: 'api.md', title: 'HTTP API' },
      { file: 'security.md', title: 'Security' },
      { file: 'architecture.md', title: 'Architecture' },
      { file: 'what-works.md', title: 'What works today' },
      { file: 'limitations.md', title: 'What does not work yet' },
      { file: 'roadmap.md', title: 'Roadmap' },
      { file: 'development.md', title: 'Develop' },
      { file: 'contributing.md', title: 'Contributing' },
      { file: 'field-checks.md', title: 'Field checks' }
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
