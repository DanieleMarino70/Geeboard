import type { GameDefinition } from "../types";

/* Garry's Mod.

   Run through ceifa/garrysmod, the `debian-x64` tag: the dedicated server
   (Steam app 4020) on the 64-bit branch, with Counter-Strike: Source's
   content mounted beside it, which is what Trouble in Terrorist Town's
   weapons and the CS:S maps need. The server is in the image; every start
   asks Steam for a newer build and fetches it if there is one.

   What was measured on this PC, October 2026, against the real image
   (PatchVersion 2026.04.29), and decided what follows:

     - Without a terminal the server writes nothing to its output: its
       console is buffered whole, and a container killed after ten minutes
       had printed one line. Run under `script`, which gives it a terminal
       of its own, every line arrives as it is printed and a line written to
       its input is read as a command. That is the last step of START. A
       terminal also gets colours (24-bit escapes on every warning) and a
       carriage return on every line, which the panel's console would show
       as they are, so both are taken off on the way out; pipefail keeps the
       server's exit code the container's. SteamCMD colours its lines too,
       and goes through the same sed.
     - It ignores SIGTERM: stopped by Docker, it was killed after sixty
       seconds, exit 137. `quit` on its console exits at once, exit 0.
     - `+hostname` on the command line keeps the first word of a name with
       spaces in it ("Geeboard probe" became "Geeboard"), so the name is a
       line of server.cfg, which is quoted, like the password.
     - The Workshop wiki's `cfg/srcds_workshop_ids.txt` is not in any build
       Steam hands out (the string is in neither the public nor the x86-64
       binaries; "new with 2026.09.22" is the dev branch). A loose `.gma` in
       `addons/` is not mounted either. What a server does mount is a folder
       in `addons/`, and that is what START makes: it fetches each item
       with SteamCMD, anonymously, and unpacks it with the `gmad` the image
       ships. An item uploaded before the .gma format arrives as an LZMA
       `_legacy.bin`; xz unpacks it (installed on the first start that needs
       it), and complains about bytes after the stream, so the result is
       checked against the size the file's own header gives. A legacy TTT
       map and Wiremod were mounted this way and the map loaded. */

/* The start of every workload, run by the image's entrypoint as root
   (GMOD_USER below). It links the panel's two files into the places the
   game reads them, keeps the cache and the server's folder the game's
   own, updates the game, fetches and unpacks the server's Workshop items,
   and starts the server as `steam` under a terminal of its own.

   Written as one line because it reaches Docker as arguments, and the
   agent refuses a line break in one and anything over 512 characters: it
   is cut into pieces below and put back together by `eval "$(printf %s
   "$@")"`. Nothing in it comes from a setting or from the Mods tab; the
   list of items is read from a file, and only the lines that are a number
   are taken from it. */
const START = [
  "d=/home/gmod/server; g=$d/garrysmod; w=$g/data/geeboard; m=/home/gmod/workshop/steamapps/workshop; c=$m/content/4000; x=$m/geeboard; s=/home/gmod/steamcmd/steamcmd.sh;",
  "q='s/\\x1b\\[[0-9;]*m//g';",
  "mkdir -p $w $g/addons $g/lua/autorun/server $x; cd $w; touch server.cfg workshop.txt workshop.lua;",
  "ln -sf $w/server.cfg $g/cfg/server.cfg; ln -sf $w/workshop.lua $g/lua/autorun/server/geeboard_workshop.lua;",
  "chown -R steam:steam $g/data $g/addons /home/gmod/workshop;",
  'gosu steam $s +force_install_dir $d +login anonymous +app_update 4020 -beta x86-64 +quit | sed -u "$q";',
  "ids=$(grep -oE '^[0-9]{1,20}$' workshop.txt);",
  '[ -n "$ids" ] && gosu steam $s +force_install_dir /home/gmod/workshop +login anonymous $(for i in $ids; do echo +workshop_download_item 4000 $i; done) +quit | sed -u "$q";',
  "rm -f $g/addons/geeboard-*; n=0;",
  "for i in $ids; do n=$((n+1));",
  "f=$(ls $c/$i/*.gma 2>/dev/null | head -1); b=$(ls $c/$i/*_legacy.bin 2>/dev/null | head -1);",
  'if [ -z "$f" ] && [ -n "$b" ]; then f=$x/$i.gma;',
  "if [ ! -s $f ] || [ $b -nt $f ]; then",
  "command -v xz >/dev/null || { apt-get -qq update && apt-get -qq -y install xz-utils >/dev/null; };",
  "xz -dc --format=lzma $b > $f.part 2>/dev/null;",
  `if [ "$(stat -c %s $f.part)" = "$(od -An -j5 -N8 -t u8 $b | tr -d ' ')" ]; then mv $f.part $f; else rm -f $f.part; fi; fi; fi;`,
  'if [ -s "$f" ]; then',
  "if [ ! -d $x/$i ] || [ $f -nt $x/$i ]; then rm -rf $x/$i; (cd $d/bin/linux64 && LD_LIBRARY_PATH=. ./gmad extract -file $f -out $x/$i -quiet >/dev/null); fi;",
  "chown -R steam:steam $x; ln -sfn $x/$i $g/addons/geeboard-$(printf %03d $n)-$i;",
  'echo "Geeboard: Workshop item $i is mounted";',
  'else echo "Geeboard: Workshop item $i was not downloaded"; fi; done;',
  `exec gosu steam bash -c 'set -o pipefail; script -qfec /home/gmod/start.sh /dev/null | sed -u -e "s/\\x1b\\[[0-9;]*m//g" -e "s/\\r$//"'`,
].join(" ");

/* START as arguments: pieces of at most 200 characters, joined again by the shell. The agent takes 512; 200 is what a
   manifest may carry, and a definition Geeboard ships is held to pass as one (test/manifest.test.ts). */
function startArgs(script: string): string[] {
  const pieces: string[] = [];
  for (let at = 0; at < script.length; at += 200) pieces.push(script.slice(at, at + 200));
  return ["bash", "-c", 'eval "$(printf %s "$@")"', "geeboard", ...pieces];
}

/* The file the game runs on every map load, in the server's folder so it
   is in the Files page and in every backup. Linked into cfg/ by START. */
const SERVER_CFG = "geeboard/server.cfg";

export const GARRYS_MOD: GameDefinition = {
  id: "garrys-mod",
  name: "Garry's Mod",
  family: "Garry's Mod",
  art: "GARRY'S\nMOD",
  official: false,
  blurb: "Sandbox, Trouble in Terrorist Town and any gamemode from the Workshop, with Workshop addons from the Mods tab.",

  portBase: 27015,
  portSpan: 200,
  /* One to one, host to container: the image binds whatever PORT says,
     and a server tells the Steam master which port it is on. The client
     port (27005) is the server's own way out and is not published. RCON
     shares the game port over TCP; it is off without an rcon_password and
     is not published either. */
  ports: [{ id: "game", label: "Game", offset: 0, protocol: "udp", primary: true }],

  defaults: { memoryGb: 3, cpuLimit: 200, diskGb: 20, playersMax: 16 },
  limits: { memoryGb: [1, 16], cpuLimit: [100, 800], diskGb: [10, 200] },
  requirements: {
    memoryGbMin: 1,
    cpuPctMin: 100,
    diskGbMin: 10,
    os: ["linux"],
    arch: ["x64"],
    capabilities: ["docker"],
  },

  /* What the server keeps: sv.db (its own database, which the image links
     here), what addons and gamemodes save with file.Write, and the panel's
     two files under geeboard/. The rest of the game is the image's. */
  dataPath: "/home/gmod/server/garrysmod/data",

  /* The Workshop: what SteamCMD downloads (content/4000/<id>/), what was
     unpacked from it (geeboard/<id>/, which addons/ links to), and the
     legacy items made into .gma files on the way. Re-downloadable, so kept
     out of every backup; kept across workloads, so a settings change is
     not every addon again. */
  cachePaths: ["/home/gmod/workshop/steamapps/workshop"],

  /* Workshop addons, fetched and unpacked by START before the server
     starts (see above for why not the server's own Workshop client).
     There is no load list: an addon on the list is mounted whole, and a
     gamemode or a map from the Workshop is then a setting, by its name.
     Players' games are told the same items through resource.AddWorkshop,
     so they can show the models and maps the server loads; a gamemode and
     the map being played are sent to them by the game anyway. */
  mods: {
    provider: "steam-workshop",
    appId: 4000,
    contentPath: "/home/gmod/workshop/steamapps/workshop/content/4000",
    items: { kind: "id-lines", file: "geeboard/workshop.txt" },
    clients: { kind: "lua-add-workshop", file: "geeboard/workshop.lua" },
    downloads: "archive",
    // The Workshop also holds saves, dupes and demos, which no server mounts.
    requiredTags: ["Addon"],
    /* The addon types of Garry's Mod's Workshop browse page, read off it on 10 October 2026, as Steam spells them on
       an item ("Addon", "map"); the style tags after them (Fun, Roleplay…) are left out. */
    categories: [
      { tag: "gamemode", label: "Gamemode" },
      { tag: "map", label: "Map" },
      { tag: "weapon", label: "Weapon" },
      { tag: "vehicle", label: "Vehicle" },
      { tag: "npc", label: "NPC" },
      { tag: "tool", label: "Tool" },
      { tag: "entity", label: "Entity" },
      { tag: "effects", label: "Effects" },
      { tag: "model", label: "Model" },
      { tag: "servercontent", label: "Server content" },
    ],
  },

  resourceEnv: {
    ports: { game: "PORT" },
  },

  install: {
    kind: "image",
    env: {
      /* Without the gdb wrapper and Lua hot-reload the image runs in
         development, which is for somebody editing Lua on the server. */
      PRODUCTION: "1",
      /* The image's own update verifies all 6.8 GB of the game on every
         start: eight minutes, measured. START updates without verifying,
         which takes seconds when there is nothing new. */
      AUTOUPDATE: "0",
      /* The entrypoint then runs START as root, which is what lets it
         install xz and give the mounts to `steam`; the server itself is
         started as `steam`, as the image does. */
      GMOD_USER: "root",
    },
  },

  config: [
    {
      key: "serverName",
      label: "Server name",
      type: "string",
      target: { kind: "cvar", file: SERVER_CFG, name: "hostname" },
      default: "Geeboard",
      maxLength: 60,
      pattern: { regex: '^[^"]*$', message: "A server name cannot contain a double quote." },
      group: "Presentation",
      help: "What the server browser shows.",
      // server.cfg is run when a map loads: a restart, or the next changelevel.
      restartRequired: true,
    },
    {
      key: "gamemode",
      label: "Gamemode",
      type: "string",
      target: { kind: "env", name: "GAMEMODE" },
      default: "sandbox",
      maxLength: 40,
      pattern: { regex: "^[a-z0-9_]+$", message: "A gamemode is its folder's name: lowercase letters, digits and underscores." },
      group: "Game",
      help: "sandbox and terrortown (Trouble in Terrorist Town) come with the game. Any other — prop_hunt, murder, zombiesurvival — is added on the Mods tab first, then named here by its folder.",
      restartRequired: true,
    },
    {
      key: "map",
      label: "Map",
      type: "string",
      target: { kind: "env", name: "MAP" },
      default: "gm_construct",
      maxLength: 64,
      pattern: { regex: "^[A-Za-z0-9_.-]+$", message: "A map is its file's name, without .bsp." },
      group: "Game",
      help: "gm_construct and gm_flatgrass come with the game, and the Counter-Strike: Source maps (cs_office, de_dust2…) are mounted. A map from the Workshop is added on the Mods tab first.",
      restartRequired: true,
    },
    {
      key: "maxPlayers",
      label: "Max players",
      type: "number",
      target: { kind: "env", name: "MAXPLAYERS" },
      default: 16,
      min: 2,
      max: 128,
      group: "Players",
      restartRequired: true,
    },
    {
      key: "password",
      label: "Server password",
      type: "string",
      target: { kind: "cvar", file: SERVER_CFG, name: "sv_password" },
      default: "",
      maxLength: 60,
      secret: true,
      pattern: { regex: '^[^"]*$', message: "A password cannot contain a double quote." },
      group: "Players",
      help: "Left empty, anyone who finds the server can join.",
      restartRequired: true,
    },
    {
      key: "loadingUrl",
      label: "Loading screen",
      type: "string",
      target: { kind: "cvar", file: SERVER_CFG, name: "sv_loadingurl" },
      default: "",
      maxLength: 200,
      pattern: { regex: '^(https?://[^"\\s]+)?$', message: "An http or https address." },
      group: "Presentation",
      help: "A web page players see while they load in. Empty: the game's own.",
      advanced: true,
      restartRequired: true,
    },
    {
      key: "allowClientLua",
      label: "Players may run their own Lua",
      type: "boolean",
      target: { kind: "cvar", file: SERVER_CFG, name: "sv_allowcslua" },
      default: false,
      group: "Players",
      help: "On, a player's game runs Lua the server did not send it: wallhacks and aimbots, on a server with anyone on it.",
      advanced: true,
      restartRequired: true,
    },
    {
      key: "loginToken",
      label: "Game server login token",
      type: "string",
      target: { kind: "env", name: "GSLT" },
      default: "",
      maxLength: 64,
      secret: true,
      pattern: { regex: "^[A-Fa-f0-9]*$", message: "A token is the hex string Steam gives you." },
      group: "Players",
      help: "Optional. A token for app 4000 from steamcommunity.com/dev/managegameservers gives the server a lasting identity on Steam.",
      advanced: true,
      restartRequired: true,
    },
  ],

  health: {
    probes: [
      { kind: "query", protocol: "source-a2s", port: "game" },
      { kind: "log", pattern: "Connection to Steam servers successful" },
    ],
    /* A first start downloads the server's addons before the game begins;
       a large list on a slow line is minutes. Measured: 158 seconds from
       the container to the ready line with a 20 MB addon and a legacy map. */
    bootGraceSeconds: 900,
    readyPattern: "Connection to Steam servers successful",
    crashPattern: "Segmentation fault",
    failures: [
      {
        pattern: "map load failed: \\S{1,64} not found or invalid",
        reason:
          "The map is not on this server, and nobody can join a server with no map. Choose one it has in Settings, or add the map on the Mods tab, apply the list and restart.",
      },
    ],
  },

  console: {
    stopCommand: "quit",
    broadcastCommand: "say %s",
    examples: ["status", "changelevel gm_flatgrass", "say <text>", "kick <name>", "bot"],
    /* The engine's own lines. A player who types in chat is printed as
       "<name>: <text>", so anchored at the start a chat line cannot add or
       remove anybody. The leave line was seen, for a bot kicked from the
       console ("Dropped Bot01 (0) from server (Kicked from server)"); a bot
       prints no join line, and the join line is the engine's documented
       one, not yet seen with a real client connected. */
    players: {
      join: '^Client "(?<name>[^"]{1,32})" connected',
      leave: "^Dropped (?<name>.{1,32}?) \\([^)]{0,40}\\) from server",
    },
  },

  versionSources: [{ provider: "static" }, { provider: "steam", appId: 4020, branches: ["x86-64"] }],

  versions: [
    {
      id: "gmod-x64",
      steamBranch: "x86-64",
      label: "Garry's Mod (64-bit)",
      image: "ceifa/garrysmod:debian-x64",
      note: "The 64-bit branch, updated from Steam on every start. Not yet joined from this panel with a player's game.",
      released: "2026-09-22",
      channel: "stable",
      recommended: true,
      args: startArgs(START),
    },
  ],

  templates: [
    {
      id: "sandbox",
      name: "Sandbox",
      blurb: "Build, spawn and fool around on gm_construct.",
      summary: "sandbox on gm_construct, 16 players",
      config: { gamemode: "sandbox", map: "gm_construct", maxPlayers: 16 },
    },
    {
      id: "ttt",
      name: "Trouble in Terrorist Town",
      blurb: "Innocents, traitors and a detective, on a Counter-Strike: Source map. Add TTT maps from the Workshop later.",
      summary: "terrortown on cs_office, 16 players",
      config: { gamemode: "terrortown", map: "cs_office", maxPlayers: 16 },
    },
  ],
};
