import type { ConfigField, GameDefinition } from "../types";

/* One of the world modifiers as the server takes it, `-modifier <name>
   <value>`, a part of SERVER_ARGS after the preset. The labels and help
   are the game's own words, from its English texts in resources.assets
   (menu_combat_tooltip, menu_death_*_tooltip and the rest), shortened. */
function modifier(name: string, label: string, values: Array<[string, string]>, help: string): ConfigField {
  return {
    key: name === "deathpenalty" ? "deathPenalty" : name,
    label,
    type: "enum",
    target: { kind: "env", name: "SERVER_ARGS", joined: true },
    default: "",
    options: [{ value: "", label: "As the preset sets it" }, ...values.map(([value, text]) => ({ value: `-modifier ${name} ${value}`, label: text }))],
    group: "World modifiers",
    help,
    restartRequired: true,
  };
}

/* One of the world modifier checkboxes, `-setkey <key>`. There is no way
   to turn one off that a preset turned on — Hammer's no build cost,
   Hardcore's no map — so the choice is the preset's or on. */
function setkey(key: string, label: string, help: string): ConfigField {
  return {
    key,
    label,
    type: "enum",
    target: { kind: "env", name: "SERVER_ARGS", joined: true },
    default: "",
    options: [
      { value: "", label: "As the preset sets it" },
      { value: `-setkey ${key}`, label: "On" },
    ],
    group: "World modifiers",
    help,
    advanced: true,
    restartRequired: true,
  };
}

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
  // It promised BepInEx, which nothing in this definition turns on.
  blurb: "Dedicated worlds with crossplay and the game's world modifiers. Mods are not installed from the panel.",

  portBase: 2456,
  portSpan: 120,
  ports: [
    { id: "game", label: "Game", offset: 0, protocol: "udp", primary: true },
    { id: "query", label: "Query", offset: 1, protocol: "udp" },
  ],

  defaults: { memoryGb: 4, cpuLimit: 200, diskGb: 30, playersMax: 10 },
  // The disk floor counts the 4.1 GB of game the node keeps for it; see cachePaths.
  limits: { memoryGb: [2, 16], cpuLimit: [100, 400], diskGb: [10, 100] },
  requirements: {
    memoryGbMin: 2,
    cpuPctMin: 100,
    diskGbMin: 10,
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

  /* The game itself, which the image installs into /opt/valheim on first
     start: 2.2 GB from Steam, and the image keeps a download copy beside
     the installed one, so 4.1 GB on the node's disk. With only /config
     mounted that went into the workload and was fetched again for every
     new one — and every Valheim setting is an environment variable, so
     every settings change is a new workload.

     Measured on the bare image, September 2026, with this directory
     mounted from the node: 565 seconds to "Game server connected" the
     first time, 98 seconds for a second workload on the same mount, with
     no download at all — the image's `app_update … validate` checks what
     is there and finds it whole. Kept by the node beside the server's
     data, out of every backup, and removed with the server. It does not
     travel with a move; the other node downloads its own. */
  cachePaths: ["/opt/valheim"],

  install: {
    kind: "steamcmd",
    appId: 896660,
    anonymous: true,
    /* The image backs the world up on its own cron, into the same
       directory Geeboard archives. Left on, every Geeboard snapshot
       would carry three days of the image's snapshots inside it, and the
       world size on the server page would count them. Geeboard does the
       backups.

       UPDATE_CRON is emptied for a worse reason. Left alone, the image
       asks Steam for a new build every fifteen minutes and, finding one
       while nobody is connected, installs it and restarts the server — an
       update nobody asked for, with no backup before it, that the panel
       sees as a server that went away and came back. Empty, the image
       checks only when a workload starts. That is still not a pinned
       version: Steam hands an anonymous login the current build and
       nothing older, so a start after Iron Gate ships is an update. It is
       now at least one a person caused. */
    env: { BACKUPS: "false", SERVER_PASS: "", UPDATE_CRON: "" },
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
      secret: true,
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
      help: "Shows the server in the game's community list. Off, players join by address. A listed server needs a password.",
    },
    {
      key: "crossplay",
      label: "Crossplay",
      type: "boolean",
      // The image reads CROSSPLAY and adds -crossplay itself.
      target: { kind: "env", name: "CROSSPLAY" },
      default: true,
      group: "Players",
      help: "Lets Xbox and Game Pass players join beside Steam ones. Off, only Steam players can.",
      restartRequired: true,
    },
    {
      key: "preset",
      label: "World modifier",
      type: "enum",
      /* There is no PRESET variable: the image appends SERVER_ARGS to
         the server's command line, unquoted, so the flag is the value. The
         single modifiers below are parts of the same variable, after this
         one: the game's own manual (Valheim Dedicated Server Manual.pdf,
         which Steam installs beside the server) says a preset "will
         overwrite any other previous modifiers", and a modifier combined
         with a preset "should be set after". */
      target: { kind: "env", name: "SERVER_ARGS", joined: true },
      default: "-preset normal",
      // The manual's list, which has three this did not offer: Easy, Immersive and Hammer.
      options: [
        { value: "-preset casual", label: "Casual" },
        { value: "-preset easy", label: "Easy" },
        { value: "-preset normal", label: "Normal" },
        { value: "-preset hard", label: "Hard" },
        { value: "-preset hardcore", label: "Hardcore" },
        { value: "-preset immersive", label: "Immersive" },
        { value: "-preset hammer", label: "Hammer" },
      ],
      group: "World",
      /* Not fixedAfterCreation: the server applies it on every start, to
         the world it already has. On lloesche/valheim-server, October
         2026, a world made with -preset hard and started again with
         -preset casual logged "Setting world modifier preset: casual",
         kept its seed, and saved casual's keys over hard's in its .fwl2
         (playerdamage 85 and enemydamage 150 became 125 and 50). The
         help said an existing world kept its modifier; it does not. */
      help: "The game's own presets for combat, death penalty, resources, raids and portals. Applied on every start, so changing it changes the rules of the world the server has.",
      restartRequired: true,
    },
    /* The single modifiers, each a `-modifier <name> <value>` after the
       preset, and the checkbox keys, each a `-setkey <key>`. Names and
       values are the manual's, and its list is the game's: these are the
       names of the WorldModifiers and WorldModifierOption enums in
       assembly_valheim.dll (build 25730807, October 2026), which the
       server parses the arguments into. Left empty, nothing is written
       and the preset's choice stands.

       Run on the image with this definition's SERVER_ARGS, October 2026:
       `-preset hard -modifier combat veryeasy -modifier raids none -setkey
       nomap -saveinterval 300` logged "Setting world modifier preset:
       hard", then "combat->veryeasy" and "raids->none", saved a world
       whose .fwl2 holds combat_veryeasy, raids_none and nomap over hard's
       keys, and saved it 300 seconds after it started and every 300
       seconds after that. */
    modifier(
      "combat",
      "Combat",
      [["veryeasy", "Very easy"], ["easy", "Easy"], ["hard", "Hard"], ["veryhard", "Very hard"]],
      "How much damage players give and take, and how often they meet stronger enemies.",
    ),
    modifier(
      "deathpenalty",
      "Death penalty",
      [
        ["casual", "Casual: equipped gear is kept"],
        ["veryeasy", "Very easy: items dropped, skills barely reduced"],
        ["easy", "Easy: items dropped, skills reduced less"],
        ["hard", "Hard: only equipped items dropped, the rest lost"],
        ["hardcore", "Hardcore: every item and skill lost"],
      ],
      "What happens when a player dies. The game's own is that every item is dropped where they fell and skills are reduced.",
    ),
    modifier(
      "resources",
      "Resource rate",
      [["muchless", "Much less"], ["less", "Less"], ["more", "More"], ["muchmore", "Much more"], ["most", "Most"]],
      "How much players gain from the world and from enemies.",
    ),
    modifier(
      "raids",
      "Raid rate",
      [["none", "None"], ["muchless", "Much less"], ["less", "Less"], ["more", "More"], ["muchmore", "Much more"]],
      "How often enemies raid the players' bases.",
    ),
    modifier(
      "portals",
      "Portals",
      [["casual", "Every item can go through"], ["hard", "None while a boss is active"], ["veryhard", "No portals"]],
      "What portals let through. The game's own keeps metals and some other items out.",
    ),
    setkey("nobuildcost", "No build cost", "Build pieces need no materials. Recipes still have to be discovered."),
    setkey("playerevents", "Player based raids", "Raids follow each player's own progress rather than which bosses have been killed on the server."),
    setkey("passivemobs", "Passive enemies", "Enemies do not attack until they are provoked."),
    setkey("nomap", "No map", "Players have no map and no minimap."),
    {
      key: "saveInterval",
      label: "Save every",
      type: "enum",
      // The manual's -saveinterval, in seconds; 1800 when it is not given.
      target: { kind: "env", name: "SERVER_ARGS", joined: true },
      default: "",
      options: [
        { value: "", label: "30 minutes, the game's own" },
        { value: "-saveinterval 300", label: "5 minutes" },
        { value: "-saveinterval 600", label: "10 minutes" },
        { value: "-saveinterval 900", label: "15 minutes" },
        { value: "-saveinterval 3600", label: "1 hour" },
      ],
      group: "World",
      help: "How often the world is written to disk. Valheim has no console to ask it to save, so a backup of a running server holds the world as it was at the last save.",
      restartRequired: true,
    },
  ],

  /* A2S is asked only of a listed server without crossplay. Measured on
     the real image: listed, the query port answers a bare A2S_INFO with a
     challenge in about thirty milliseconds; unlisted, the same port is
     bound and says nothing, to the node or to anything else. With
     crossplay on — this definition's default — the server logs in to
     PlayFab instead and does not answer A2S even when listed; measured
     too. So most Valheim servers are judged on their log alone, and the
     report says the query was not asked. */
  health: {
    probes: [
      {
        kind: "query",
        protocol: "source-a2s",
        when: [
          { key: "public", equals: true },
          { key: "crossplay", equals: false },
        ],
      },
      { kind: "log", pattern: "Game server connected" },
    ],
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
