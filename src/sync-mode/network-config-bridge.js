export function installSyncModeNetworkConfigBridge(configuration, syncMode) {
  const originalGetAll = configuration.getAll.bind(configuration);
  const originalUpdate = configuration.update.bind(configuration);
  const originalReset = configuration.reset.bind(configuration);

  const projectedGetAll = () => {
    const value = originalGetAll();
    return {
      ...value,
      network: {
        ...(value.network || {}),
        sync_mode: syncMode.configurationState(true),
      },
      sync_mode: syncMode.configurationState(false),
    };
  };

  configuration.getAll = projectedGetAll;

  configuration.update = (section, patch) => {
    if (section === "sync_mode") {
      return syncMode.handleConfigurationPatch(patch);
    }
    if (
      section === "network" &&
      patch &&
      typeof patch === "object" &&
      patch.sync_mode
    ) {
      const { sync_mode: syncPatch, ...networkPatch } = patch;
      const syncState = syncMode.handleConfigurationPatch(syncPatch);
      let network;
      if (Object.keys(networkPatch).length) {
        // ConfigurationService.update() calls this.getAll(). Temporarily expose
        // the unprojected implementation so the virtual sync_mode status is
        // never copied into persisted network configuration.
        configuration.getAll = originalGetAll;
        try {
          network = originalUpdate("network", networkPatch);
        } finally {
          configuration.getAll = projectedGetAll;
        }
      } else {
        network = originalGetAll().network;
      }
      return { ...network, sync_mode: syncState };
    }
    return originalUpdate(section, patch);
  };

  configuration.reset = (section = null) => {
    if (section === "sync_mode") {
      return syncMode.handleConfigurationPatch({
        action: "disable",
        settings: syncMode.defaults(),
      });
    }
    let value;
    if (section === "network") {
      configuration.getAll = originalGetAll;
      try {
        value = originalReset(section);
      } finally {
        configuration.getAll = projectedGetAll;
      }
    } else {
      value = originalReset(section);
    }
    if (section === "network" && value && typeof value === "object") {
      return { ...value, sync_mode: syncMode.configurationState(false) };
    }
    return value;
  };

  return configuration;
}
