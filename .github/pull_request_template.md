## What this changes, and why

<!-- A sentence for what, a sentence for why. The commit message has the rest. -->

## The bar

From [docs/contributing.md](../docs/contributing.md#the-bar). Tick what is true; say why for what is not.

- [ ] It went in the right layer (panel, node, game definition or runtime)
- [ ] Validation exists, and refuses with a message that says what to fix
- [ ] Authorization goes through `can()`, not a role comparison
- [ ] Errors are `PlatformError`s with codes
- [ ] Tests: unit for domain logic, a verify script for anything that needs a database
- [ ] The documentation is updated, including what still does not work
- [ ] `npm run test:unit`, `npm run build` and `npm run verify` pass (CI runs the last on every push)
- [ ] Security was considered, and is said here if it was touched

## Anything a person upgrading has to do

<!-- A changed command, a file to edit, a port to open, a step on the way up: it goes in CHANGELOG.md too. -->
