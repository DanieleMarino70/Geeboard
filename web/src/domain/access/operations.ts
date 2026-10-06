import type { Permission } from "./permissions";

/* What each operation on one server asks of whoever runs it.

   lib/server-ops.ts reads this table at every call of `authorize`, and
   test/server-authorization.test.ts holds it, with the permission matrix,
   to a written-out list of who may do what: an operation that quietly asks
   for a lesser permission, or none, is the mistake that let a member who
   owned a server delete it and type into its console. */
export const SERVER_OPERATION_PERMISSION = {
  start: "server.start",
  stop: "server.stop",
  restart: "server.restart",
  toggleTask: "server.schedule.write",
  runTask: "server.schedule.write",
  saveSettings: "server.settings.write",
  delete: "server.delete",
  consoleCommand: "server.console.write",
} as const satisfies Record<string, Permission>;

export type ServerOperation = keyof typeof SERVER_OPERATION_PERMISSION;
