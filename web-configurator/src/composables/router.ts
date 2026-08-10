/*
 * Modified by Justin Jäger for the Unfolded.Tools Remote Simulator.
 * Modified build first published: 2026-08-03.
 * Licensed as part of the modified Web Configurator under GNU GPL v3.0 only.
 * See MODIFICATIONS.md for details.
 */
import { ref } from "vue";
import { createRouter, createWebHashHistory } from "vue-router";

import { authStorage } from "@/stores/auth";
import { decideLoginRedirect } from "@/composables/authHelpers";
import { simulatorRouteBlocked } from "@/simulator/config";

import HomeView from "../views/HomeView.vue";

const previousRoute = ref<string>("");

const RemoteSimulatorRoute = { name: "RemoteSimulatorRoute", render: () => null };

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/",
      name: "home",
      component: HomeView,
    },
    {
      path: "/login",
      name: "login",
      component: () => import("../views/LoginView.vue"),
      meta: { parentPath: "/" },
    },
    {
      path: "/entities",
      name: "entities",
      component: () => import("../views/entities/DevicesEntities.vue"),
      meta: { parentPath: "/" },
    },
    {
      path: "/integrations",
      name: "integrations",
      component: () => import("../views/integrations/DevicesIntegrations.vue"),
      meta: { parentPath: "/" },
    },
    {
      path: "/entity/:entity_id",
      name: "entity",
      component: () => import("../views/entities/EditEntityView.vue"),
      props: true,
      meta: { parentPath: "/entities" },
    },
    {
      path: "/integration/:integration_id",
      name: "integration",
      component: () => import("../views/integrations/EditIntegrationView.vue"),
      props: true,
      meta: { parentPath: "/integrations" },
    },
    {
      path: "/dock/:dock_id",
      name: "dock",
      component: () => import("../views/integrations/EditDockView.vue"),
      props: true,
      meta: { parentPath: "/integrations" },
    },
    {
      path: "/remote/:remote_id",
      name: "remote",
      component: () => import("../views/entities/EditRemoteView.vue"),
      props: true,
      meta: { parentPath: "/entities" },
    },
    {
      path: "/activities-macros",
      name: "activities-macros",
      component: () =>
        import("../views/activities-macros/ActivitiesMacrosView.vue"),
      meta: { parentPath: "/" },
    },
    {
      path: "/activity/:activity_id",
      name: "activity",
      component: () =>
        import("../views/activities-macros/EditActivityView.vue"),
      props: true,
      meta: { parentPath: "/activities-macros" },
    },
    {
      path: "/macro/:macro_id",
      name: "macro",
      component: () => import("../views/activities-macros/EditMacroView.vue"),
      props: true,
      meta: { parentPath: "/activities-macros" },
    },
    {
      path: "/activity-group/:group_id",
      name: "activity-group",
      component: () =>
        import("../views/activities-macros/EditActivityGroupView.vue"),
      props: true,
      meta: { parentPath: "/activities-macros" },
    },
    {
      path: "/settings",
      name: "settings",
      component: () => import("../views/settings/SettingsView.vue"),
      meta: { parentPath: "/" },
      children: [
        {
          path: "general",
          name: "general",
          component: () => import("../components/settings/SettingsGeneral.vue"),
          meta: { parentPath: "/settings" },
        },
        {
          path: "display",
          name: "display",
          component: () => import("../components/settings/SettingsDisplay.vue"),
          meta: { parentPath: "/settings" },
        },
        {
          path: "user-interface",
          name: "user-interface",
          component: () => import("../components/settings/UserInterface.vue"),
          meta: { parentPath: "/settings" },
        },
        {
          path: "sound-haptic",
          name: "sound-haptic",
          component: () => import("../components/settings/SoundHaptic.vue"),
          meta: { parentPath: "/settings" },
        },
        {
          path: "voice-control",
          name: "voice-control",
          component: () => import("../components/settings/VoiceControl.vue"),
          meta: { parentPath: "/settings" },
        },
        {
          path: "power-saving",
          name: "power-saving",
          component: () => import("../components/settings/PowerSaving.vue"),
          meta: { parentPath: "/settings" },
        },
        {
          path: "wifi-bluetooth",
          name: "wifi-bluetooth",
          component: () => import("../components/settings/WifiBluetooth.vue"),
          meta: { parentPath: "/settings" },
        },
        {
          path: "localization",
          name: "localization",
          component: () =>
            import("../components/settings/SettingsLocalization.vue"),
          meta: { parentPath: "/settings" },
        },
        {
          path: "admin-password",
          name: "admin-password",
          component: () => import("../components/settings/AdminPassword.vue"),
          meta: { parentPath: "/settings" },
        },
        {
          path: "application-credentials",
          name: "application-credentials",
          component: () =>
            import("../components/settings/ApplicationCredentials.vue"),
          meta: { parentPath: "/settings" },
        },
        {
          path: "sync-mode",
          name: "sync-mode",
          component: () => import("../components/settings/SyncMode.vue"),
          meta: { parentPath: "/settings" },
        },
        {
          path: "development",
          name: "development",
          component: () =>
            import("../components/settings/SettingsDevelopment.vue"),
          meta: { parentPath: "/settings" },
        },
        {
          path: "factory-reset",
          name: "factory-reset",
          component: () => import("../components/settings/FactoryReset.vue"),
          meta: { parentPath: "/settings" },
        },
      ],
    },
    {
      path: "/remote-simulator",
      name: "remote-simulator",
      component: RemoteSimulatorRoute,
      meta: { parentPath: "/", simulator: true },
    },
    {
      path: "/customise-remote",
      name: "customise-remote",
      component: HomeView,
      meta: {
        parentPath: "/",
        customiseRemote: true,
      },
    },
  ],
});

router.beforeEach(async (to, from) => {
  previousRoute.value = from.fullPath;
  const auth = authStorage();

  await auth.ensureInitialized();

  if (simulatorRouteBlocked(to.name)) return { name: "settings" };

  return decideLoginRedirect({
    isAuthenticated: auth.isAuthenticated,
    toName: typeof to.name === "string" ? to.name : undefined,
    toFullPath: to.fullPath,
    redirectQuery:
      typeof to.query.redirect === "string" ? to.query.redirect : undefined,
  });
});

export function getPreviousRoute() {
  return previousRoute.value;
}

export default router;
