import { DeviceColor } from "@/types/enums";

export function useRemoteProperties() {
  function getDeviceColor(serial_number: string) {
    if (!serial_number) {
      return "d"; // Fallback
    }

    return (
      serial_number.substring(serial_number.length - 1) || ""
    )?.toLowerCase();
  }

  function getRemotControllerClasses(
    isSecondModel = false,
    deviceColor?: string,
  ) {
    const colorValues: string[] = Object.values(DeviceColor).map((val) =>
      val.toLowerCase(),
    );
    return `remote-controller--${
      isSecondModel
        ? "v2"
        : deviceColor && colorValues.includes(deviceColor)
          ? `v3--${deviceColor}`
          : "v3"
    }`;
  }

  function getTouchSliderProps() {
    return {
      button: "TOUCH_SLIDER",
      name: { en: "Touch slider" },
    };
  }

  return {
    getDeviceColor,
    getRemotControllerClasses,
    getTouchSliderProps,
  };
}
