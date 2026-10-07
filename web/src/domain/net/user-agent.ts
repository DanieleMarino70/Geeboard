/* Who the panel says it is to a server it calls.

   Four clients each wrote their own: the version providers said "geeboard/0.1 (+https://github.com/geeboard)" (a version this project has not
   been for a long time, and an address that is not its), the DNS client said "geeboard", the notification sender and the DNS webhook said
   "Geeboard/<version>". The services the panel asks (GitHub's API, Steam's mirror, Mojang) see one client with one name and a page to read, and
   a new provider copies this and not whichever string it finds first. The version is the release this panel was built from, as lib/version.ts
   reads it. */
export const PROJECT_URL = "https://github.com/DanieleMarino70/Geeboard";

export function userAgent(): string {
  return `Geeboard/${process.env.GEEBOARD_VERSION || "unknown"} (+${PROJECT_URL})`;
}
