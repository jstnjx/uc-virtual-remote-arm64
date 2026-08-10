# UC Virtual Remote v0.12.6

## Sync Mode

- Added **Settings → Sync Mode** for running UC Virtual Remote as the authoritative UC Remote Sync Primary.
- Added managed installation and configuration of `uc-remote-sync`, including dedicated Core credentials and agent health reporting.
- Added physical Satellite token pairing, claim handling, peer persistence and Satellite management actions.
- Added synchronization controls for resources, entities, activities, groups, macros, remotes, profiles and Docks.
- Added Primary network, WoWLAN, standby, physical Dock token and agent endpoint settings.
- Added a searchable catalog of standard Remote configuration plus API-only and physical-hardware settings.

## Web Configurator and simulator

- Added the source-built Sync Mode settings route and a distribution-safe runtime fallback.
- Added Remote-route lighting refresh for display and button-backlight settings.
- Removed the icon from the **Update integration** button.
- Updated the deterministic Web Configurator builder to include and validate all Sync Mode runtime assets.
