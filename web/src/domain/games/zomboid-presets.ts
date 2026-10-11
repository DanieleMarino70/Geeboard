/* What each of Project Zomboid's presets sets, for the world rules that
   "As the preset sets it" leaves to it — so the settings form can say
   what that choice means instead of showing it empty.

   Read off the two images on 12 October 2026, not from a wiki:

     - media/lua/shared/Sandbox/<preset>.lua in
       danixu86/project-zomboid-dedicated-server:42.20.4-release and
       :41.78.19-release, which is the module World rules `require`s;
     - for a key a preset's file does not set, the default the game fills
       it with: the third argument of its newEnumOption in
       zombie/SandboxOptions.class and the ZombieLore and MultiplierConfig
       classes inside it, read with javap.

   Build 42's SixMonthsLater.lua is still a build 41 file (VERSION = 5):
   it sets no ZombieRespawn, NightLength or HoursForLootRespawn, which the
   game then fills from its defaults, and its DayLength 3 is below the
   step build 42 inserted (upgradeOptionValue moves only values above 3),
   so it is 1 hour on both builds.

   The values are as the game writes them, each one of the matching
   setting's options. One is not: build 42's Outbreak turns
   MultiplierConfig.GlobalToggle off and levels each skill at its own
   rate, so it has no one XP multiplier to show, and says so. */

type Table = Record<string, Record<string, string>>;

const B42: Table = {
  Apocalypse: {
    Zombies: "4",
    ZombieRespawn: "4",
    DayLength: "4",
    StartMonth: "7",
    WaterShut: "2",
    ElecShut: "2",
    HoursForLootRespawn: "0",
    NightLength: "3",
    "ZombieLore.Speed": "4",
    "ZombieLore.Memory": "2",
    "ZombieLore.Sight": "5",
    "ZombieLore.Hearing": "5",
    "MultiplierConfig.Global": "1.0",
  },
  SixMonthsLater: {
    Zombies: "1",
    ZombieRespawn: "2",
    DayLength: "3",
    StartMonth: "12",
    WaterShut: "1",
    ElecShut: "1",
    HoursForLootRespawn: "0",
    NightLength: "3",
    "ZombieLore.Speed": "2",
    "ZombieLore.Memory": "2",
    "ZombieLore.Sight": "2",
    "ZombieLore.Hearing": "2",
    "MultiplierConfig.Global": "1.0",
  },
  Outbreak: {
    Zombies: "4",
    ZombieRespawn: "4",
    DayLength: "4",
    StartMonth: "7",
    WaterShut: "3",
    ElecShut: "3",
    HoursForLootRespawn: "0",
    NightLength: "3",
    "ZombieLore.Speed": "4",
    "ZombieLore.Memory": "2",
    "ZombieLore.Sight": "5",
    "ZombieLore.Hearing": "5",
    "MultiplierConfig.Global": "each skill at its own rate",
  },
  Rising: {
    Zombies: "5",
    ZombieRespawn: "3",
    DayLength: "4",
    StartMonth: "7",
    WaterShut: "3",
    ElecShut: "3",
    HoursForLootRespawn: "0",
    NightLength: "3",
    "ZombieLore.Speed": "3",
    "ZombieLore.Memory": "3",
    "ZombieLore.Sight": "2",
    "ZombieLore.Hearing": "3",
    "MultiplierConfig.Global": "1.0",
  },
  Extinction: {
    Zombies: "3",
    ZombieRespawn: "2",
    DayLength: "4",
    StartMonth: "7",
    WaterShut: "2",
    ElecShut: "2",
    HoursForLootRespawn: "0",
    NightLength: "3",
    "ZombieLore.Speed": "4",
    "ZombieLore.Memory": "1",
    "ZombieLore.Sight": "2",
    "ZombieLore.Hearing": "2",
    "MultiplierConfig.Global": "1.0",
  },
};

// Every build 41 preset sets each of these but NightLength, which is 3 (Normal) by default.
const b41 = (zombies: string, water: string, xp: string, speed: string, senses: [string, string, string], month = "7"): Record<string, string> => ({
  Zombies: zombies,
  DayLength: "3",
  StartMonth: month,
  WaterShut: water,
  ElecShut: water,
  XpMultiplier: xp,
  LootRespawn: "1",
  NightLength: "3",
  "ZombieLore.Speed": speed,
  "ZombieLore.Memory": senses[0],
  "ZombieLore.Sight": senses[1],
  "ZombieLore.Hearing": senses[2],
});

const B41: Table = {
  Apocalypse: b41("4", "2", "1.0", "2", ["2", "2", "2"]),
  Survivor: b41("4", "2", "1.0", "2", ["2", "2", "2"]),
  Builder: b41("5", "2", "1.0", "2", ["2", "3", "3"]),
  Beginner: b41("5", "8", "2.0", "3", ["3", "3", "3"]),
  FirstWeek: b41("3", "3", "1.0", "2", ["3", "3", "3"]),
  SixMonthsLater: b41("1", "1", "1.0", "2", ["2", "2", "2"], "12"),
  Survival: b41("3", "2", "1.0", "2", ["2", "2", "2"]),
};

export const ZOMBOID_PRESETS: Record<"b41" | "b42", Table> = { b41: B41, b42: B42 };

/* A world rule's value under each preset of a line, as `presetValues`
   wants it: keyed by World rules' own values, which are the preset
   files' names. */
export function presetValuesOf(line: "b41" | "b42", luaKey: string): { key: string; values: Record<string, string> } {
  const values: Record<string, string> = {};
  for (const [preset, keys] of Object.entries(ZOMBOID_PRESETS[line])) {
    const value = keys[luaKey];
    if (value !== undefined) values[preset] = value;
  }
  return { key: "sandboxPreset", values };
}
