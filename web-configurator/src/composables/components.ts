import type { ActivityUserInterfaceItem } from "@/types/activity";

import i18next from "@/i18next";

import ComponentButtonIcon from "@/components/ui/ComponentButtonIcon.vue";
import ComponentButtonText from "@/components/ui/ComponentButtonText.vue";
import ComponentButtonMedia from "@/components/ui/ComponentButtonMedia.vue";
import ComponentButtonSensor from "@/components/ui/ComponentButtonSensor.vue";
import ComponentButtonSelect from "@/components/ui/ComponentButtonSelect.vue";

export function getComponent(type: string) {
  if (type === "icon") {
    return ComponentButtonIcon;
  }
  if (type === "text") {
    return ComponentButtonText;
  }
  if (type === "media_player") {
    return ComponentButtonMedia;
  }
  if (type === "sensor") {
    return ComponentButtonSensor;
  }
  if (type === "select") {
    return ComponentButtonSelect;
  }
  console.warn("Unknown component type: " + type);
  return null;
}

export function getComponentClasses(
  type: string,
  settings: ActivityUserInterfaceItem | null,
) {
  const classList = ["ui-component"];
  classList.push("ui-component--" + type);

  if (type === "text" || type === "icon") {
    classList.push("ui-component--button");
  }

  if (type === "text") {
    classList.push("ui-component--button-text");
  }

  if (type === "icon") {
    classList.push("ui-component--button-with-icon");
  }

  if (settings) {
    classList.push("ui-component--configured");
  }

  return classList;
}

export function getComponentPool(): ActivityUserInterfaceItem[] {
  return [
    {
      type: "icon",
      icon: "uc:tv",
      size: { width: 1, height: 1 },
      location: {
        x: 0,
        y: 0,
      },
    },
    {
      type: "text",
      text: i18next.t("widget.type.text.default_text"),
      size: { width: 1, height: 1 },
      location: {
        x: 0,
        y: 0,
      },
    },
    {
      type: "slider",
      icon: "uc:volume",
      size: { width: 1, height: 1 },
      location: {
        x: 0,
        y: 0,
      },
    },
    {
      type: "jump",
      icon: "uc:page",
      size: { width: 1, height: 1 },
      location: {
        x: 0,
        y: 0,
      },
    },
  ];
}

export function getActivityComponentPool(): ActivityUserInterfaceItem[] {
  const activityItems = [
    {
      type: "sensor",
      text: "",
      sensor: {
        sensor_id: "",
        show_label: false,
        show_unit: true,
      },
      size: { width: 1, height: 1 },
      location: {
        x: 0,
        y: 0,
      },
    },
    {
      type: "select",
      text: "",
      select: {
        select_id: "",
        show_name: false,
      },
      size: { width: 1, height: 1 },
      location: {
        x: 0,
        y: 0,
      },
    },
    {
      type: "media_player",
      media_player_id: "",
      size: { width: 1, height: 1 },
      location: {
        x: 0,
        y: 0,
      },
    },
  ] as ActivityUserInterfaceItem[];

  return getComponentPool().concat(activityItems);
}
