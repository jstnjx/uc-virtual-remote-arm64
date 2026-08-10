# Modifications to Unfolded Circle Web Configurator 2.3.3

- **Community build:** `2.3.3-unfoldedtools.8`
- **Source basis:** Unfolded Circle Web Configurator `2.3.3`
- **Modified by:** Justin Jäger / Unfolded.Tools
- **Initial publication:** 2026-08-03
- **Current revision:** 2026-08-10
- **Remote artwork modification:** 2026-08-04
- **License:** GPL-3.0-only

This document records the changes made for UC Virtual Remote and the Unfolded.Tools Remote Simulator.

The community build is not an Unfolded Circle product and is not affiliated with, endorsed by, operated by, or supported by Unfolded Circle ApS. It is based on the published Web Configurator 2.3.3 source snapshot and may differ from current or future proprietary official releases in features, appearance, translations, and behavior.

## Remote Simulator and UC Virtual Remote integration

- Added session-scoped API, WebSocket, and browser-storage routing for isolated hosted simulator instances.
- Added a simulator bootstrap that connects the frontend to UC Virtual Remote.
- Added self-hosted bootstrap detection so an unresolved hosted-session placeholder resolves to the local server origin instead of being appended to the URL.
- Kept public-simulator route restrictions and CSS markers disabled for self-hosted deployments.
- Added a first-class **Remote** section to the primary navigation using the standard configurator tools-and-content layout.
- Added simulated physical buttons and activity, macro, and remote-entity mappings.
- Added touch-slider volume commands for the configured media-player target.
- Added long-press fallback to the configured short-press action when no dedicated long-press action exists.
- Replaced hardware-dependent values with safe virtual responses where appropriate.
- Replaced public Wi-Fi status with a synthetic disconnected state to prevent host network details from being exposed by the hosted simulator.

## Navigation and interface behavior

- Changed the post-authentication default route to the Home section.
- Kept the complete primary navigation visible in the Remote section instead of treating it as a detached detail route.
- Restored the **Add new integration** action and connected it to the integration discovery, registration, and setup workflow.
- Restored integration delete controls and the two-stage official-style behavior: deleting a configured instance first resets it to an installed-but-unconfigured driver; deleting that driver removes it completely.
- Restored installed-but-unconfigured integration cards in the overview and made them reopen the setup workflow when selected.
- Added managed integration update actions to integration detail pages and yellow cloud update indicators to integration cards.
- Removed the malformed icon from the **Update integration** action while retaining the text action.
- Restored the **Docks** category in the Integrations section, including Dock search, listing, setup, and editing routes.
- Added **Settings → Sync Mode** for managed UC Remote Sync Primary configuration, synchronization policy, Satellite status, Core credentials, WoWLAN requirements, physical Dock tokens, and Remote/API-only hardware settings.
- Bridged Sync Mode onto the existing Core network-configuration contract without modifying unrelated configurator requests.
- Limited the mobile navigation component to the mobile breakpoint.
- Preserved the standard page title and back-button behavior on entity, remote, activity, and macro detail routes.
- Vertically centered the login form while retaining the version footer at the lower edge of the viewport.
- Adjusted login text colors for improved contrast against the replacement backgrounds.
- Added a dismissible login-screen notice identifying the Web Configurator as an unofficial community build that is not affiliated with or endorsed by Unfolded Circle.

## Icons, branding, and artwork

- Removed Font Awesome from the dependency graph and runtime payload.
- Mapped legacy icon identifiers to the locally hosted Material Symbols Sharp variable font under Apache-2.0.
- Replaced nonessential product branding with Unfolded.Tools naming and original project artwork.
- Removed the dependency on `logo-dark.svg` from the custom application.
- Added replacement desktop and phone login-background variants created for Unfolded.Tools.
- Restored the stock dark Remote 3 artwork for Home, Customize your remote, Button mapping, and User interface views.
- Added simulator-only dark Remote 3 artwork with transparent button symbols and a smaller optimized derivative.
- Added a generated button-backlight mask.
- Added live RGB color and brightness rendering beneath the transparent symbols in the simulator-only Remote 3 artwork.
- Applied the configured display brightness to the simulated Remote screen.
- Reloaded simulator lighting settings whenever the Remote section is entered so changes do not require a complete site reload.
- Added immediate lighting updates when display settings change.

The retained and modified artwork inventory is documented in [`ARTWORK.md`](ARTWORK.md).

## Compatibility and demo-data corrections

- Normalized entity and activity state values before case conversion to prevent failures on non-string integration values.
- Replaced invalid demo icons for the living-room light, climate entity, demo integration, and demo profile.
- Stored the TV Remote page name as plain text rather than as a translated object.
- Added complete on/off sequences to the Watch TV activity.
- Added the full room and playback preparation sequence to Movie Night.
- Removed the Coffee Machine demo entity.
- Renamed the demo fan to `Air Circulator`.

## Runtime packaging

- Bundled the source-built configurator as an immutable UC Virtual Remote application component.
- Removed the physical-Remote device-bundle capture and runtime upload workflow.
- Disabled configurator upload, replacement, and removal endpoints with `405 IMMUTABLE_COMPONENT` responses.
- Added runtime metadata for the community build version, upstream version, source status, publication date, modification date, and asset count.
- Added a generated corresponding-source archive to the final container image.

## Notices and source availability

- Added a mandatory community-project acknowledgement before a hosted simulator instance is created or queued.
- Updated Settings → About to identify the build as unofficial and link to licenses, artwork attribution, corresponding source, this modification record, and the source comparison.
- Published the complete modified source, official source archive, deterministic source archive, checksums, and machine-readable patch under `/remote-simulator/licensing/source/`.
- Added `/remote-simulator/licensing/diff` as a source-tree comparison between the official 2.3.3 snapshot and the modified source. Generated Vite filenames are excluded from that comparison.
