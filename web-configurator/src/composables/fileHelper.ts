const units = ["bytes", "kB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
export function useFileHelper() {
  function niceBytes(x: number | string) {
    const n = typeof x === "string" ? parseInt(x, 10) : x;
    if (!n || isNaN(n)) return "0";

    let l = 0,
      value = n;
    while (value >= 1024 && ++l) {
      value = value / 1024;
    }
    return value.toFixed(value < 10 && l > 0 ? 1 : 0) + " " + units[l];
  }
  return {
    niceBytes,
  };
}
