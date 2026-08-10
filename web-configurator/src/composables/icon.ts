/*
 * Modified by Justin Jäger for the Unfolded.Tools Remote Simulator.
 * Modified build first published: 2026-08-03.
 * Licensed as part of the modified Web Configurator under GNU GPL v3.0 only.
 * See MODIFICATIONS.md for details.
 */
import { iconMapping } from "~/icons/old-new-icon-mapping.json";
import { iconMappingFree } from "~/icons/old-new-icon-mapping-free.json";
export async function hasProIcon(): Promise<boolean> { return false; }
export async function getIconName(icon: string): Promise<string> { return icon; }
export async function getNewIconName(icon: string): Promise<string> {
  return (iconMapping as Record<string,string>)?.[icon] || (iconMappingFree as Record<string,string>)?.[icon] || icon;
}
export function setProIconFound(_found: boolean): void {}
export function resetProIconCheck(): void {}
