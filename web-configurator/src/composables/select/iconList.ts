import { icons } from "~/icons/icon-list.json";

export default icons as Array<string>;

export function createIconName(icon: string | number) {
  return (icon || "").toString().replace(/^uc:/, "");
}

// export function createIconClasses(icon: string | number) {
//   const name = createIconName(icon);
//   const list = ["icon", "icon-" + name];
//   const found = icons.find((item) => {
//     return item.properties.name === name;
//   });
//   if (!found) {
//     list.push("icon--unknown");
//   }
//   return list.join(" ");
// }
