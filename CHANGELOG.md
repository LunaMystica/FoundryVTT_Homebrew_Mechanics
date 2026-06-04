# Changelog

All notable changes to this module are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-06-04

### Added

- Tidy5e sheet meters for the homebrew resources, on both the classic and Quadrone layouts.
  - **Endurance** and **Soul** render as bars (native-styled on Quadrone to match the HP / Hit Dice bars).
  - **Soulstrike** (diamond pips) and **Soulburst** (stars) render as charge trackers, grouped with the Soul bar.
  - Click a bar to edit its value; click a pip/star to set the count (click the top one again to spend).
  - **Endurance** pulses a warning glow when critically low.
- Per-meter colour configuration: world settings with colour pickers, defaulting to the Tidy theme palette and tinted per-actor with the sheet's accent colour (contrast-adjusted for light/dark themes).
- `Toggle Sheet Meters` world setting to show/hide the meters.

### Fixed

- Ignore `package-lock.json` in version control.

## [1.2.0] - 2026-05-15

### Added

- Non-GM players now only see chat rows for actors they own; empty sections and otherwise-empty messages collapse automatically (`Hide Messages Toggle`).

## [1.1.1] - 2026-05-15

### Fixed

- Route `lastHit` token flag writes through the GM socket so non-GM clients can update them.

## [1.1.0] - 2026-04-30

### Added

- **Endurance Break** configuration menu mapping each damage type to the item UUID used for its synthetic damage roll.
- `lastHit` tracking for spells and Soulstrike feats to de-duplicate downstream workflows.
- Option to ignore actor traits when firing a synthetic damage roll.

### Changed

- Endurance and Soul processing now return HTML sections, improving chat message formatting.
- Refactored utilities into singleton classes with improved debug logging.
- Renamed the `soulstrike` module to `soul` for consistency.

## [1.0.2] - 2025-11-03

### Added

- `chatLog` utility, integrated into the existing workflows.

## [1.0.1] - 2025-09-20

### Changed

- Improved debug logging.

## [1.0] - 2025-09-19

### Changed

- Switched the automation trigger to the midi-qol `postActiveEffects` hook (was roll-complete).
- Fixed Endurance by changing how the token is acquired.
- Removed the module's startup delay.

## [0.23] - 2025-08-29

### Fixed

- Corrected the UUIDs of the Weakness Break features; made the item name and section configurable variables.

### Changed

- CI: bump `actions/checkout` to v5.

## [0.22] - 2025-08-15

### Fixed

- Respect activities that deal no damage on a save.
- Trim trailing spaces in section names so matching is reliable.

## [0.21] - 2025-07-04

### Added

- Reset Endurance for all combatants when the combat encounter ends.
- Hide GM chat messages from players via a CSS toggle.

## [0.20] - 2025-07-04

### Added

- `Force Reload` setting and a console confirmation on load.

### Changed

- The automation no longer requires debug mode to be enabled to function.

### Fixed

- Endurance edge case when the simulated value lands exactly on max uses.

## [0.18] - 2025-06-27

### Changed

- Soulstrike adjustments.

## [0.17] - 2025-06-27

### Changed

- Updated the Soulstrike gain multiplier based on damage taken.

## [0.16] - 2025-05-24

### Added

- Damage type is now shown in the Endurance message.

### Changed

- Replaced the debug-only chat output with a generic chat-message toggle.

## [0.15] - 2025-05-23

### Fixed

- Release workflow (`main.yml`).

## [0.14] - 2025-05-23

### Changed

- Updated `module.json` to reflect the fork.

## [0.13] - 2025-05-23

### Fixed

- Language file path.

## [0.12] - 2025-05-23

### Changed

- Reworked chat messages and added dev console support; general functionality fixes.

## [0.11] - 2025-05-23

### Changed

- Updated README and module manifest; added debug statements.

## [0.1] - 2025-05-23

### Added

- Initial release.

[1.3.0]: https://github.com/LunaMystica/FoundryVTT_Homebrew_Mechanics/compare/1.2.0...1.3.0
[1.2.0]: https://github.com/LunaMystica/FoundryVTT_Homebrew_Mechanics/compare/1.1.1...1.2.0
[1.1.1]: https://github.com/LunaMystica/FoundryVTT_Homebrew_Mechanics/compare/1.1.0...1.1.1
[1.1.0]: https://github.com/LunaMystica/FoundryVTT_Homebrew_Mechanics/compare/1.0.2...1.1.0
[1.0.2]: https://github.com/LunaMystica/FoundryVTT_Homebrew_Mechanics/compare/1.0.1...1.0.2
[1.0.1]: https://github.com/LunaMystica/FoundryVTT_Homebrew_Mechanics/compare/1.0...1.0.1
[1.0]: https://github.com/LunaMystica/FoundryVTT_Homebrew_Mechanics/compare/0.23...1.0
[0.23]: https://github.com/LunaMystica/FoundryVTT_Homebrew_Mechanics/compare/0.22...0.23
[0.22]: https://github.com/LunaMystica/FoundryVTT_Homebrew_Mechanics/compare/0.21...0.22
[0.21]: https://github.com/LunaMystica/FoundryVTT_Homebrew_Mechanics/compare/0.20...0.21
[0.20]: https://github.com/LunaMystica/FoundryVTT_Homebrew_Mechanics/compare/0.18...0.20
[0.18]: https://github.com/LunaMystica/FoundryVTT_Homebrew_Mechanics/compare/0.17...0.18
[0.17]: https://github.com/LunaMystica/FoundryVTT_Homebrew_Mechanics/compare/0.16...0.17
[0.16]: https://github.com/LunaMystica/FoundryVTT_Homebrew_Mechanics/compare/0.15...0.16
[0.15]: https://github.com/LunaMystica/FoundryVTT_Homebrew_Mechanics/compare/0.14...0.15
[0.14]: https://github.com/LunaMystica/FoundryVTT_Homebrew_Mechanics/compare/0.13...0.14
[0.13]: https://github.com/LunaMystica/FoundryVTT_Homebrew_Mechanics/compare/0.12...0.13
[0.12]: https://github.com/LunaMystica/FoundryVTT_Homebrew_Mechanics/compare/0.11...0.12
[0.11]: https://github.com/LunaMystica/FoundryVTT_Homebrew_Mechanics/compare/0.1...0.11
[0.1]: https://github.com/LunaMystica/FoundryVTT_Homebrew_Mechanics/releases/tag/0.1
