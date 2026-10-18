import type { ConfigField, GameDefinition } from "../types";

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

   Two more links, from 1.1.0. cfg/server.vdf is where the game keeps a
   variable that was changed in it — from its console, `ulx rcon`, or
   TTT2's admin menu — and it is not in the server's folder: it was lost
   with the container at every rebuild, and in no backup. Linked into
   geeboard/, it is both. Measured on the image in October 2026: with the
   link dangling, the game made the file through it on its first save and
   kept the link, and a new container read `ttt_minimum_players 3` back
   from it. And with the map rotation on (MAPCYCLE, below), cfg/mapcycle.txt
   is geeboard/mapcycle.txt, made at every start from the TTT maps the
   addons brought, shuffled: TTT loads the next map of that file once a
   map's rounds are played, and with the image's empty one it loads the
   same map again. Seen on the image: one round on gm_flatgrass, then
   `CHANGE LEVEL: gm_construct`.

   The update, from 1.1.0, is tried again whole when Steam refuses it.
   Once Facepunch ships a build the image does not have, SteamCMD asks
   for the manifests of the build that is installed, to update from it,
   and is refused them anonymously ('Access Denied' in its content log):
   `Error! App '4020' state is 0x6 after update job` at every start, and
   the game never got past the image's build. `validate` asks for the same
   manifests and fails the same way. Measured in October 2026 with the
   image's build 25464522 and Steam's 25936627: with the install's record
   taken off (steamapps/*.acf), SteamCMD fetched the new build whole — 3.56
   GB, 163 seconds on an EC2 machine — and the next start was `already up
   to date` in 4. So a start whose update said `Error!` does that, once a
   container, and writes the game afresh into it.

   Written as one line because it reaches Docker as arguments, and the
   agent refuses a line break in one and anything over 512 characters: it
   is cut into pieces below and put back together by `eval "$(printf %s
   "$@")"`. It fills the twelve pieces a manifest's sixteen arguments
   leave to within a few characters, which is why it is written tight:
   /dev/null is $v, and giving files to `steam` is $o. One setting reaches
   it, MAPCYCLE, and only to be tested for being set. The list of items is
   read from a file, and only the lines that are a number are taken from
   it. */
const START = [
  'h=/home/gmod;d=$h/server;g=$d/garrysmod;w=$g/data/geeboard;m=$h/workshop/steamapps/workshop;c=$m/content/4000;x=$m/geeboard;a=$g/lua/autorun/server;v=/dev/null;o="chown -R steam:steam";s="gosu steam $h/steamcmd/steamcmd.sh +force_install_dir";',
  // Exported, so the server's own sed below takes the colours and the carriage returns off with the same expression.
  "export q='s/\\x1b\\[[0-9;]*m//g;s/\\r$//';",
  "mkdir -p $w $g/addons $a $x;cd $w;touch server.cfg workshop.txt workshop.lua;",
  "[ -s workshop.lua ] || echo '-- Geeboard: no Workshop items' > workshop.lua;",
  "ln -sf $w/server.cfg $w/server.vdf $g/cfg;ln -sf $w/workshop.lua $a/geeboard_workshop.lua;",
  "$o $g/data $g/addons $h/workshop;",
  // The update, and the same again with the install's record taken off when Steam refused it (see above).
  'p="$s $d +login anonymous +app_update 4020 -beta x86-64 +quit";$p|sed -u "$q"|tee /tmp/u;',
  'grep -q Error! /tmp/u&&rm $d/steamapps/*.acf&&$p|sed -u "$q";',
  "ids=$(grep -oE '^[0-9]{1,20}$' workshop.txt);t=$x/.checked;touch $t;",
  '[ "$ids" ]&&$s $h/workshop +login anonymous $(printf "+workshop_download_item 4000 %s " $ids) +quit|sed -u "$q";',
  "n=0;k=0;u=0;z=;for i in $ids;do n=$((n+1));",
  'if [ -z "$(ls $c/$i/*.gma $c/$i/*_legacy.bin 2>$v)" ];then u=$((u+1));z="$z $i";',
  'elif [ "$(find $c/$i -newer $t)" ];then k=$((k+1));fi;done;',
  '[ $n = 0 ]||echo "Geeboard: $n Workshop item$([ $n = 1 ] || echo s) checked with Steam — $k downloaded or updated, $((n-k-u)) already up to date, $u not available${z:+ (${z# })}";',
  "rm -f $g/addons/geeboard-* content.txt;n=0;",
  "for i in $ids;do n=$((n+1));",
  "f=$(ls $c/$i/*.gma 2>$v|head -1);b=$(ls $c/$i/*_legacy.bin 2>$v|head -1);",
  'if [ -z "$f" -a "$b" ];then f=$x/$i.gma;',
  "if [ ! -s $f -o $b -nt $f ];then ",
  "command -v xz >$v||{ apt-get -qq update&&apt-get -qq -y install xz-utils >$v;};",
  "xz -dcF lzma $b >$f.part 2>$v;",
  `if [ "$(stat -c%s $f.part)" = "$(od -An -j5 -N8 -tu8 $b|tr -d ' ')" ];then mv $f.part $f;else rm -f $f.part;fi;fi;fi;`,
  'if [ -s "$f" ];then ',
  "if [ ! -d $x/$i -o $f -nt $x/$i ];then rm -rf $x/$i;(cd $d/bin/linux64&&LD_LIBRARY_PATH=. ./gmad extract -file $f -out $x/$i -quiet >$v);fi;",
  "ln -sfn $x/$i $g/addons/geeboard-$(printf %03d $n)-$i;",
  'echo "Geeboard: Workshop item $i is mounted";',
  "(cd $x/$i;ls maps/*.bsp gamemodes/*/*.txt)2>$v|sed -nE 's#^maps/(.+)\\.bsp#map \\1 '$i'#p;s#^gamemodes/([^/]+)/\\1\\.txt#gamemode \\1 '$i'#p'>>content.txt;",
  // Given to `steam` once, after every item, where it was once per item: 190 items made 190 passes over all of them.
  'else echo "Geeboard: Workshop item $i was not downloaded";fi;done;$o $x;',
  `[ "$MAPCYCLE" ]&&sed -nE 's/^map (ttt2?_[^ ]+) .*/\\1/p' content.txt|shuf >mapcycle.txt&&ln -sf $w/mapcycle.txt $g/cfg;`,
  `exec gosu steam bash -c 'set -o pipefail; script -qfec /home/gmod/start.sh /dev/null|sed -u "$q"'`,
].join("");

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

/* What the server's Workshop addons brought, for Settings to offer as a
   gamemode or a map: written by START on every start, beside server.cfg,
   from each item it mounted — `map <name> <item>` for each maps/*.bsp in
   it, `gamemode <name> <item>` for each gamemodes/<name>/ with the
   <name>.txt that makes a folder a gamemode. An addon that only adds to
   terrortown is not a gamemode of its own, and is not listed. Started
   afresh each time, so an addon taken off the Mods tab leaves the list
   with the start that unmounts it. */
const WORKSHOP_CONTENT = "geeboard/content.txt";

/* The Counter-Strike: Source maps the image mounts from /home/gmod/mounts/cstrike. The server loads them; a player's
   game needs the same content, and the server cannot send it: on 11 October 2026 a player whose PC had no CS:S was
   dropped three times with "Map maps/cs_office.bsp is missing". */
const CSS_MAPS =
  "cs_assault|cs_compound|cs_havana|cs_italy|cs_militia|cs_office|de_aztec|de_cbble|de_chateau|de_dust|de_dust2|de_inferno|de_nuke|de_piranesi|de_port|de_prodigy|de_tides|de_train";

/* ── Trouble in Terrorist Town ─────────────────────────────────────
   What a TTT server is set by, as lines of server.cfg: shown only while
   the gamemode is terrortown, which is the folder both the TTT that comes
   with the game and TTT2 from the Workshop load as. Every name below is
   one both create, read off the image's terrortown and TTT2 0.14.6b in
   October 2026, with TTT's default; where TTT2's differs, the option says
   so. The traitors' starting credits are not here because the two name
   them differently (ttt_credits_starting, ttt_traitor_credits_starting).

   Empty, a setting writes no line, and the server keeps what it has:
   TTT's own value, or one set in the game, which it saves in
   cfg/server.vdf (linked into the server's folder by START). Set here,
   the line is run at every map load and is what holds. */
const TTT = { key: "gamemode", oneOf: ["terrortown"] };

function tttNumber(
  key: string,
  label: string,
  cvar: string,
  group: string,
  help: string,
  [min, max]: [number, number],
  more: Partial<ConfigField> = {},
): ConfigField {
  return {
    key,
    label,
    type: "number",
    target: { kind: "cvar", file: SERVER_CFG, name: cvar },
    default: "",
    min,
    max,
    unsetWhenEmpty: true,
    shownWhen: TTT,
    group,
    ...(help ? { help } : {}),
    restartRequired: true,
    ...more,
  };
}

/* A choice, its empty one first: what TTT does unless told, in its words. */
function tttChoice(
  key: string,
  label: string,
  cvar: string,
  group: string,
  help: string,
  unset: string,
  options: Array<{ value: string; label: string }>,
  more: Partial<ConfigField> = {},
): ConfigField {
  return {
    key,
    label,
    type: "enum",
    target: { kind: "cvar", file: SERVER_CFG, name: cvar },
    default: "",
    options: [{ value: "", label: `Not set here: ${unset}` }, ...options],
    unsetWhenEmpty: true,
    shownWhen: TTT,
    group,
    ...(help ? { help } : {}),
    restartRequired: true,
    ...more,
  };
}

const ON_OFF = (on: string, off: string) => [
  { value: "1", label: `On: ${on}` },
  { value: "0", label: `Off: ${off}` },
];

const SHARES = (values: number[]) => values.map((v) => ({ value: String(v), label: v === 0 ? "None" : `${Math.round(v * 100)}% of the players` }));

const ROUNDS = "TTT rounds";
const ROLES = "TTT roles";
const KARMA = "TTT karma";

const TTT_SETTINGS: ConfigField[] = [
  {
    key: "mapRotation",
    label: "Map rotation",
    type: "enum",
    target: { kind: "env", name: "MAPCYCLE" },
    default: "",
    options: [
      { value: "", label: "Off: the same map again, as TTT does with no list" },
      { value: "workshop", label: "TTT maps from the Mods tab, in a new order at every start" },
    ],
    shownWhen: TTT,
    group: ROUNDS,
    help: "Once a map's rounds are played, the server goes on to the next map instead of the same one. The list: every map on the Mods tab whose name starts with ttt_ or ttt2_, shuffled at each start; with none, the same map loads again. A map vote addon takes over from it.",
    restartRequired: true,
  },
  {
    key: "roundsPerMap",
    label: "Rounds per map",
    type: "number",
    target: { kind: "cvar", file: SERVER_CFG, name: "ttt_round_limit" },
    default: 1,
    min: 1,
    max: 50,
    shownWhen: { key: "mapRotation", oneOf: ["workshop"] },
    group: ROUNDS,
    help: "How many rounds are played on a map before the next one. TTT's own is 6. A map also ends once it has been played for its minutes per map, 75 unless set.",
    restartRequired: true,
  },
  tttNumber(
    "roundMinutes",
    "Round length",
    "ttt_roundtime_minutes",
    ROUNDS,
    "Minutes before a round ends with the innocents winning. Left empty, the server keeps what it has: TTT's own 10, or what was set in the game. With haste on, a round starts shorter than this.",
    [1, 60],
  ),
  tttChoice("haste", "Haste mode", "ttt_haste", ROUNDS, "", "on, TTT's own", ON_OFF("a round starts short and every death adds time", "every round lasts its full length")),
  tttNumber("prepSeconds", "Preparation", "ttt_preptime_seconds", ROUNDS, "Seconds to look around before the roles are dealt. TTT's own: 30.", [1, 300]),
  tttNumber("postSeconds", "After a round", "ttt_posttime_seconds", ROUNDS, "Seconds between a round's end and the next preparation. TTT's own: 30.", [1, 300]),
  tttNumber("minimumPlayers", "Players to start", "ttt_minimum_players", ROUNDS, "Players a round waits for before it starts. TTT's own: 2.", [1, 128]),
  tttNumber("firstPrepSeconds", "First preparation", "ttt_firstpreptime", ROUNDS, "The preparation of a map's first round, longer so that players can finish loading. TTT's own: 60.", [1, 600], { advanced: true }),
  tttNumber("hasteMinutes", "Haste: starting minutes", "ttt_haste_starting_minutes", ROUNDS, "With haste on, the minutes a round starts with. TTT's own: 5.", [1, 60], { advanced: true }),
  tttNumber("mapMinutes", "Minutes per map", "ttt_time_limit_minutes", ROUNDS, "Minutes a map is played before the next one, whatever the rounds. TTT's own: 75.", [1, 600], { advanced: true }),
  tttChoice("postroundDeathmatch", "Fighting after a round", "ttt_postround_dm", ROUNDS, "", "off, TTT's own", ON_OFF("players can shoot each other until the next round", "nobody can be hurt between rounds"), { advanced: true }),
  tttNumber("idleSeconds", "Idle limit", "ttt_idle_limit", ROUNDS, "Seconds a player can stand still before being moved to the spectators. TTT's own: 180.", [30, 3600], { advanced: true }),

  tttChoice(
    "traitorShare",
    "Traitors",
    "ttt_traitor_pct",
    ROLES,
    "How many of the players are traitors, rounded down, and never fewer than one. Left empty, the server keeps what it has.",
    "25% in TTT, 40% in TTT2",
    SHARES([0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5]),
  ),
  tttChoice("detectiveShare", "Detectives", "ttt_detective_pct", ROLES, "How many of the players are detectives, once there are enough players for one.", "13%, TTT's own", SHARES([0, 0.1, 0.13, 0.15, 0.2, 0.25])),
  tttNumber("detectiveMinPlayers", "Players for a detective", "ttt_detective_min_players", ROLES, "Players a round needs before it has a detective. TTT's own is 8, so a smaller game has none.", [1, 128]),
  tttNumber("traitorMax", "Most traitors", "ttt_traitor_max", ROLES, "The most traitors a round has, however many play. TTT's own: 32.", [1, 128], { advanced: true }),
  tttNumber("detectiveMax", "Most detectives", "ttt_detective_max", ROLES, "The most detectives a round has. TTT's own: 32.", [1, 128], { advanced: true }),

  tttChoice(
    "karma",
    "Karma",
    "ttt_karma",
    KARMA,
    "Hurting your own side lowers your karma, and a player with less karma does less damage. Left empty, the server keeps what it has.",
    "on, TTT's own",
    ON_OFF("hurting your own side costs karma and damage", "everyone always does full damage"),
  ),
  tttChoice("karmaKick", "Kick for low karma", "ttt_karma_low_autokick", KARMA, "A player whose karma ends a round below the low karma line is removed from the server.", "on, TTT's own", ON_OFF("removed at the end of the round", "kept, whatever their karma")),
  tttNumber("karmaLowAmount", "Low karma line", "ttt_karma_low_amount", KARMA, "The karma below which a player is kicked. TTT's own: 450, of 1000.", [0, 10000], { advanced: true }),
  tttChoice("karmaBan", "Ban for low karma", "ttt_karma_low_ban", KARMA, "Whether a player kicked for low karma is also banned for a while.", "on, TTT's own", ON_OFF("banned for the minutes below", "kicked only, and may come straight back"), { advanced: true }),
  tttNumber("karmaBanMinutes", "Low karma ban", "ttt_karma_low_ban_minutes", KARMA, "Minutes a low karma ban lasts. TTT's own: 60.", [1, 10080], { advanced: true }),
  tttChoice("karmaStrict", "Strict karma", "ttt_karma_strict", KARMA, "", "on, TTT's own", ON_OFF("damage falls off quickly as karma drops", "only very low karma lowers damage much"), { advanced: true }),
  tttChoice("karmaPersist", "Karma between maps", "ttt_karma_persist", KARMA, "", "off, TTT's own", ON_OFF("a player keeps their karma on the next map", "everyone starts each map with full karma"), { advanced: true }),
];

const CSS_MAP_NOTICE = [
  "This is a Counter-Strike: Source map. Every player's Garry's Mod needs CS:S content to load it, and the server cannot send it: a player without it is dropped with \"Map maps/….bsp is missing\".",
  "Owning Counter-Strike: Source on Steam is enough: Garry's Mod mounts it by itself. Without it, the free Counter-Strike: Source content pack and CS:S maps pack at gmodcontent.com, an unofficial site that is neither Valve's nor Geeboard's, bring it (the textures alone have no maps). Each is a zip whose folder goes into garrysmod\\addons — in Steam, right-click Garry's Mod → Properties → Installed Files → Browse — and then the game is restarted.",
  "Or choose a TTT map from the Workshop: add it on the Mods tab, then name it as the Map in Settings. Players' games download it when they join.",
];

export const GARRYS_MOD: GameDefinition = {
  id: "garrys-mod",
  name: "Garry's Mod",
  family: "Garry's Mod",
  art: "GARRY'S\nMOD",
  /* The store page's app id, not the server's (4020): on 2026-10-12 its
     library poster was a JPEG of 600 × 900, 96,105 bytes. */
  poster: { steam: 4000 },
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
      /* What the image has in garrysmod/gamemodes besides `base`, which is
         what the others are built on and not one to play; and, once the
         server has started with them, what its Workshop addons brought.
         See WORKSHOP_CONTENT. */
      choices: {
        values: [
          { value: "sandbox", label: "Sandbox, comes with the game" },
          { value: "terrortown", label: "Trouble in Terrorist Town, comes with the game" },
        ],
        file: { path: WORKSHOP_CONTENT, kind: "gamemode" },
      },
      group: "Game",
      help: "sandbox and terrortown come with the game. Any other — prop_hunt, murder, zombiesurvival — is added on the Mods tab first; once the server has started with it, it is in this list, or type its folder's name.",
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
      // garrysmod/maps in the image, then the Counter-Strike: Source maps it mounts, then the Workshop's.
      choices: {
        values: [
          { value: "gm_construct", label: "comes with the game" },
          { value: "gm_flatgrass", label: "comes with the game" },
          ...CSS_MAPS.split("|").map((value) => ({ value, label: "Counter-Strike: Source, players need its content" })),
        ],
        file: { path: WORKSHOP_CONTENT, kind: "map" },
      },
      group: "Game",
      help: "gm_construct and gm_flatgrass come with the game. The Counter-Strike: Source maps are on the server, but every player's game needs CS:S content to load one. A Workshop map is added on the Mods tab, and is in this list once the server has started with it.",
      restartRequired: true,
      notice: { when: CSS_MAPS, text: CSS_MAP_NOTICE, link: { label: "gmodcontent.com", href: "https://gmodcontent.com/" } },
    },
    // Shown only with gamemode terrortown; see TTT_SETTINGS.
    ...TTT_SETTINGS,
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
      key: "allowDownload",
      label: "Players may download from the server",
      type: "boolean",
      target: { kind: "cvar", file: SERVER_CFG, name: "sv_allowdownload" },
      default: true,
      group: "Players",
      help: "Content the server has that is not on the Workshop — a custom map, sounds, models — is sent to a player's game straight from the server, slowly. Off, a player without it sees errors and missing textures. Workshop addons do not need it.",
      advanced: true,
      restartRequired: true,
    },
    {
      key: "allowUpload",
      label: "Players' sprays reach others",
      type: "boolean",
      target: { kind: "cvar", file: SERVER_CFG, name: "sv_allowupload" },
      default: true,
      group: "Players",
      help: "A player's spray is uploaded to the server and passed on to everybody else. Off, nobody sees anybody's spray.",
      advanced: true,
      restartRequired: true,
    },
    {
      key: "region",
      label: "Region",
      type: "enum",
      target: { kind: "cvar", file: SERVER_CFG, name: "sv_region" },
      /* Valve's numbers for the server browser's region filter. The engine
         says its default is -1, and a running server holds 255, the whole
         world, either way: on the image, October 2026, with `sv_region
         "255"` and then with `sv_region "-1"` in server.cfg, `sv_region`
         answered `"sv_region" = "255" ( def. "-1" )` once up. */
      default: "255",
      options: [
        { value: "255", label: "The whole world, the game's own" },
        { value: "0", label: "US East" },
        { value: "1", label: "US West" },
        { value: "2", label: "South America" },
        { value: "3", label: "Europe" },
        { value: "4", label: "Asia" },
        { value: "5", label: "Australia" },
        { value: "6", label: "Middle East" },
        { value: "7", label: "Africa" },
      ],
      group: "Presentation",
      help: "Where the server browser's region filter places the server. Players can join from anywhere whatever it says.",
      advanced: true,
      restartRequired: true,
    },
    {
      key: "tickRate",
      label: "Tick rate",
      type: "enum",
      /* A flag on the command line only: the engine reads -tickrate once,
         as it starts, and has no variable for it. The image puts ARGS at
         the end of its srcds command line, unquoted. */
      target: { kind: "env", name: "ARGS" },
      default: "-tickrate 66",
      options: [
        { value: "-tickrate 33", label: "33 a second" },
        { value: "-tickrate 66", label: "66 a second, the game's own" },
        { value: "-tickrate 100", label: "100 a second" },
      ],
      group: "Performance",
      help: "How many times a second the server works out the world. Higher is smoother for players with good connections and heavier on the node; most gamemodes are made for 66.",
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
    /* What its Lua made: every console command an addon added (concommand.GetTable), and ULX's commands with their arguments and
       help, from ULib's own table — `ulx kick`, `<player> [{reason}]`, "Kicks target.". Written by the server itself, so it is the
       list of what this server has now. Three lines, because its console cut a line at 254 characters (measured: one of 426 ended
       in `')' expected near '<eof>'`), sharing a global they take off again; no `;`, which the engine reads as the end of a
       command, and no `//`, which it reads as a comment. ULib's own getUsage, not ULX's, which adds the help to the arguments.
       Run on a server with ULib, ULX, TTT2 and its ULX commands in October 2026: `Geeboard: 162 commands written for the
       panel's console`, 106 of them ULX's. */
    commands: {
      ask: [
        String.raw`lua_run gb_cmds={} for n in pairs(concommand.GetTable()) do if n~="ulx" then gb_cmds[#gb_cmds+1]=n end end`,
        String.raw`lua_run if ULib and ULib.cmds then for n,c in pairs(ULib.cmds.translatedCmds) do local k,u=pcall(ULib.cmds.TranslateCommand.getUsage,c,Entity(0)) gb_cmds[#gb_cmds+1]=n.."\t"..(k and u or "").."\t"..(c.helpStr or "") end end`,
        String.raw`lua_run file.CreateDir("geeboard") file.Write("geeboard/commands.txt",table.concat(gb_cmds,"\n")) print("Geeboard: "..#gb_cmds.." commands written for the panel's console") gb_cmds=nil`,
      ],
      file: "geeboard/commands.txt",
    },
    // `Unknown command "/status"`, measured October 2026: a slash is for chat.
    refusesSlash: true,
    hint: "The engine's console, as after ~ in the game. say reaches players' chat.",
    /* The engine's own lines. A player who types in chat is printed as
       "<name>: <text>", so anchored at the start a chat line cannot add or
       remove anybody. Both were seen on 11 October 2026 with a player's
       game, which joined three times from another PC: `Client "<name>"
       connected (<ip>:<port>)` on joining, `Dropped <name> (<SteamID64>)
       from server (<reason>)` on leaving, and the panel recorded three
       sessions with the right name and times. A bot prints no join line;
       kicked, it leaves as "Dropped Bot01 (0) from server (…)". */
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
      note: "The 64-bit branch, updated from Steam on every start. Joined from a player's game on 11 October 2026.",
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
      blurb: "Innocents, traitors and a detective, on cs_office: players need Counter-Strike: Source content for it. Or add a TTT map from the Workshop.",
      summary: "terrortown on cs_office, 16 players",
      config: { gamemode: "terrortown", map: "cs_office", maxPlayers: 16 },
    },
  ],
};
