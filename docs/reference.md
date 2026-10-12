# Reference

The pages that answer "how does this actually work", rather than "how do I do
this".

| | |
| --- | --- |
| [HTTP API](api.md) | Every route, its scope, its body and what it answers. The same operations the panel's buttons call |
| [What the API promises](api-frozen.md) | Every name a client of `/api/v1` meets, frozen from 1.0, and the old names still read through 1.x |
| [A DNS webhook](dns-webhook.md) and [a notification webhook](notifications.md#what-a-webhook-receives) | The two bodies the panel sends to a receiver you run, and what may change in them |
| [Security](security.md) | Sign-in, two-factor, permissions, API keys, the node token, and how a server's files are kept inside its own directory |
| [Architecture](architecture.md) | The four processes, what each one owns, and which decisions live where |
| [Extending Geeboard](extending.md) | What it takes to add a game, a node, a DNS provider, a storage, a channel, a scope, a field, a health check or a version source — and the edge of what 1.0 promises |
| [How it was built](history.md) | Why things are the way they are: each phase and each release, with what it cost and what it found |

Two more belong here in spirit and are filed under the section they are used
from: [Versions](versions.md), on the five different things "latest" means, and
[Games](games.md), on what a game definition contains and how to add one.
