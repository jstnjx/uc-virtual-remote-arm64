# Sync Mode

Sync Mode turns UC Virtual Remote into the managed Primary for [UC Remote Sync](https://github.com/jstnjx/uc-remote-sync).

It is available under **Settings → Sync Mode** and provides:

- managed installation and startup of `ghcr.io/jstnjx/uc-remote-sync`
- automatic generation of a dedicated Core API key and Remote Sync agent token
- a preconfigured Remote Sync `master` configuration using the local Virtual Remote Core
- synchronization section, scheduling, pruning, resource verification and standby-inhibitor controls
- Primary network, WoWLAN, physical Dock token and port settings
- Primary-side pairing for physical Satellite remotes
- Remote Sync agent health, paired Satellite state, preview and immediate synchronization actions
- a complete catalog of Remote Core configuration and native host-hardware values, with API/physical-only settings identified

## Pairing a physical Satellite

1. Install UC Remote Sync on the physical Remote and configure it as a **Satellite**.
2. Keep the Satellite setup screen open after it displays the pairing token.
3. On UC Virtual Remote, open **Settings → Sync Mode → Satellite remotes**.
4. Enter the Satellite agent address, normally `<remote-ip>:11081`, and the displayed pairing token.
5. Select **Pair Satellite**.

Sync Mode validates the Satellite protocol, claims it for this virtual Primary, supplies the Primary callback URL and command credential, stores the peer in `remote-sync.json`, and reloads the managed Primary container. Paired peer records are retained when Sync Mode settings are reapplied.

When the virtual host name cannot be resolved by the physical Remote, set **Public agent URL override** to a reachable URL such as `http://192.168.1.20:11081` before pairing.

## Storage and disabling

The generated Remote Sync configuration is stored with the managed integration configuration. The generated Core API key and Remote Sync agent token are stored separately from the public Sync Mode status payload.

Disabling Sync Mode stops the managed Remote Sync container without deleting its configuration, credentials or paired Satellite records.
