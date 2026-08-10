/*
 * Modified by Justin Jäger for the Unfolded.Tools Remote Simulator.
 * Modified build first published: 2026-08-03.
 * Licensed as part of the modified Web Configurator under GNU GPL v3.0 only.
 * See MODIFICATIONS.md for details.
 */
import { simulatorStoragePrefix } from "@/simulator/config";

export class SessionStorageWrapper {
  protected prefix = `UCRemote.${simulatorStoragePrefix()}`;

  setValue(key: string, value: unknown, expire: number | null = null) {
    const item = {
      value,
      expire,
    };
    sessionStorage.setItem(this.getId(key), JSON.stringify(item));
  }

  getValue(key: string): unknown {
    const rawStored = sessionStorage.getItem(this.getId(key));
    if (!rawStored) {
      return null;
    }
    const stored = JSON.parse(rawStored);
    if (!stored) {
      return null;
    }
    if (stored.expire && stored.expire < Date.now()) {
      return null;
    }
    return stored.value;
  }

  clearValue(key: string) {
    sessionStorage.removeItem(this.getId(key));
  }

  protected getId(key: string) {
    return `${this.prefix}.${key}`;
  }
}

const sStorageWrapper = new SessionStorageWrapper();
export default sStorageWrapper;
