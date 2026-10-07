# Repository rulesets

These are GitHub repository settings, kept here as the JSON the API takes so that what the repository enforces is
something a person can read and review. **Nothing in this directory is applied by a push.** A repository admin applies
one with:

```bash
gh api repos/DanieleMarino70/Geeboard/rulesets -X POST --input .github/rulesets/release-tags.json
```

- `release-tags.json`: a published `v*` tag cannot be moved or deleted. `v0.3.5` was moved once, and the community games
  repository pins `GEEBOARD_REF` to a tag precisely because a tag is supposed not to move. The repository admin role
  (`actor_id` 5) keeps a bypass for an emergency, which is a decision somebody makes and not something a typo can do.

Apply it **after** the last tag of a release has been pushed: it also stops a tag from being re-pushed to fix a mistake,
which is the point and is inconvenient on the day.
