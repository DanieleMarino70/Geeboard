# Security policy

## Reporting a vulnerability

Please report it privately, not in a public issue: use **[Report a vulnerability](https://github.com/DanieleMarino70/Geeboard/security/advisories/new)**
on the repository's Security tab. Only the maintainers see it.

Say what you did, what you expected and what happened, and which version (the footer of the panel, or `GET /version` on an agent).
If you can reproduce it against a throw-away installation, say how; if you cannot, say that.

What to expect: an acknowledgement within a week, a fix or a plan within a month for anything that lets someone who is not
signed in, or is signed in with less than they should have, do something to a panel or a node, and credit in the release notes
unless you would rather not have it.

## What counts

The panel (sign-in, sessions, the permission rules, the API and its keys), the node agent and the channel between them, the
installers, and the images published to `ghcr.io/danielemarino70/geeboard-panel` and `…/geeboard-agent`. Not in scope: a game
server's own vulnerabilities, a community game's image (the panel runs only what an owner approved, and says so), and anything
that needs an owner's account to begin with.

[docs/security.md](../docs/security.md) says what the panel does and does not defend against, including the limits that are
written down on purpose (the plain-HTTP channel between a panel and its nodes, for one). A report about something listed there as
a known limit is still welcome; say that you have read it.

## Supported versions

Until 1.0, the **latest minor release** (0.9.x, then 0.10.x, …) and no other: a fix lands there, and the way to take it is to go
straight to it ([docs/upgrading.md](../docs/upgrading.md)). From 1.0, the latest two minors.
