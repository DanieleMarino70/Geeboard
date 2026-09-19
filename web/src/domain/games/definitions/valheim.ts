import type { GameDefinition } from "../types";

/* Valheim.

   Steam app 896660, run through lloesche/valheim-server, which downloads
   the 2.2 GB server itself on first boot and takes about four minutes to
   come up on this machine.

   Its password rules belong here, with the game: at least five
   characters, never containing the world name, and required when the
   server is listed publicly. The image also defaults an unset SERVER_PASS
   to the literal "secret", which is why this sets it to empty explicitly
   — a server nobody gave a password to must not quietly have one that
   everybody knows. */

export const VALHEIM: GameDefinition = {
  id: "valheim",
  name: "Valheim",
  family: "Valheim",
  art: "VALHEIM",
  official: false,
  blurb: "Dedicated worlds with BepInEx mod loading.",

  portBase: 2456,
  portSpan: 120,
  ports: [
    { id: "game", label: "Game", offset: 0, protocol: "udp", primary: true },
    { id: "query", label: "Query", offset: 1, protocol: "udp" },
  ],

  defaults: { memoryGb: 4, cpuLimit: 200, diskGb: 30, playersMax: 10 },
  limits: { memoryGb: [2, 16], cpuLimit: [100, 400], diskGb: [5, 100] },
  requirements: {
    memoryGbMin: 2,
    cpuPctMin: 100,
    diskGbMin: 5,
    os: ["linux"],
    arch: ["x64"],
    capabilities: ["docker", "steamcmd"],
  },

  /* The image keeps worlds in /config/worlds_local and installs the
     server itself into /opt/valheim. Mounting the server's directory at
     /data, as every other game here does, left the world inside the
     container: nothing to browse, nothing to back up, and gone on the
     next rebuild. */
  dataPath: "/config",

  install: {
    kind: "steamcmd",
    appId: 896660,
    anonymous: true,
    /* The image backs the world up on its own cron, into the same
       directory Geeboard archives. Left on, every Geeboard snapshot
       would carry three days of the image's snapshots inside it, and the
       world size on the server page would count them. Geeboard does the
       backups. */
    env: { BACKUPS: "false", SERVER_PASS: "" },
  },

  config: [
    {
      key: "serverName",
      label: "Server name",
      type: "string",
      target: { kind: "env", name: "SERVER_NAME" },
      default: "Geeboard",
      maxLength: 60,
      group: "Presentation",
      restartRequired: true,
    },
    {
      key: "worldName",
      label: "World name",
      type: "string",
      target: { kind: "env", name: "WORLD_NAME" },
      default: "geeboard",
      maxLength: 40,
      group: "World",
      help: "Names the save file. Changing it starts a new world rather than renaming the old one.",
      restartRequired: true,
    },
    {
      key: "password",
      label: "Server password",
      type: "string",
      target: { kind: "env", name: "SERVER_PASS" },
      default: "",
      maxLength: 60,
      minLength: 5,
      /* Valheim's own rules, and it refuses to start if either is
         broken: a listed server must have a password, and the password
         may not contain the world name. */
      requiredWhen: { key: "public", equals: true },
      mustNotContain: "worldName",
      group: "Players",
      help: "At least five characters, and it must not contain the world name. Required when the server is listed publicly.",
      restartRequired: true,
    },
    {
      key: "public",
      label: "List publicly",
      type: "boolean",
      target: { kind: "env", name: "SERVER_PUBLIC" },
      default: false,
      group: "Players",
    },
    {
      key: "crossplay",
      label: "Crossplay",
      type: "boolean",
      // The image reads CROSSPLAY and adds -crossplay itself.
      target: { kind: "env", name: "CROSSPLAY" },
      default: true,
      group: "Players",
      restartRequired: true,
    },
    {
      key: "preset",
      label: "World modifier",
      type: "enum",
      /* There is no PRESET variable: the image appends SERVER_ARGS to
         the server's command line, so the flag is the value. */
      target: { kind: "env", name: "SERVER_ARGS" },
      default: "-preset normal",
      options: [
        { value: "-preset casual", label: "Casual" },
        { value: "-preset normal", label: "Normal" },
        { value: "-preset hard", label: "Hard" },
        { value: "-preset hardcore", label: "Hardcore" },
      ],
      group: "World",
      help: "Applies when the world is generated. An existing world keeps the modifier it was made with.",
      restartRequired: true,
    },
  ],

  health: {
    probes: [{ kind: "query", protocol: "source-a2s" }, { kind: "log", pattern: "Game server connected" }],
    bootGraceSeconds: 600,
    readyPattern: "Game server connected",
    crashPattern: "(Fatal error|Segmentation fault)",
  },

  console: {
    /* Valheim's dedicated server has no console command language — it is
       driven entirely by signals, so a stop is a stop and there is
       nothing useful to type at it. */
    examples: [],
    /* Its log names a character only on arrival — "Got character ZDOID
       from Bob : 123:1" — and a departure only by the connection's Steam
       id, "Closing socket 7656…". The connection is announced by that id
       first, "Got connection SteamID 7656…", so the poller pairs the id
       with the character named next, and a closing socket is that
       character leaving. A respawn prints the ZDOID line again; a second
       join for a name already on is ignored. Written from the server's
       known output, not yet seen with a real client connected. */
    players: {
      connect: "Got connection SteamID (?<id>\\d{5,20})",
      join: "Got character ZDOID from (?<name>.{1,32}?) : -?\\d+:\\d+$",
      leave: "Closing socket (?<id>\\d{5,20})",
    },
  },

  versionSources: [{ provider: "static" }, { provider: "steam", appId: 896660 }],

  versions: [
    {
      id: "valheim-stable",
      steamBranch: "public",
      label: "Valheim stable",
      image: "lloesche/valheim-server:latest",
      note: "The public branch, with crossplay on",
      released: "2025-07-22",
      channel: "stable",
      recommended: true,
    },
  ],

  templates: [
    {
      id: "normal",
      name: "Normal",
      blurb: "The world as shipped, not listed publicly.",
      summary: "Normal modifier, unlisted, no password until you set one",
      config: { preset: "-preset normal", public: false, worldName: "geeboard" },
    },
    {
      id: "hardmode",
      name: "Hard",
      blurb: "Tougher enemies and slower resources, for a group that has done it before.",
      summary: "Hard modifier, unlisted, no password until you set one",
      config: { preset: "-preset hard", public: false, worldName: "geeboard" },
    },
  ],
};
