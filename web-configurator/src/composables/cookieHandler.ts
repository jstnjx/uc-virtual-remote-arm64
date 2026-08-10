// src/composables/cookieHandler.ts
import { defineComponent } from "vue";

export function setCookie(
  name: string,
  value: string,
  days = 7,
  path = "/",
): void {
  const d = new Date();
  d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
  const expires = "expires=" + d.toUTCString();
  document.cookie = `${name}=${encodeURIComponent(
    value,
  )};${expires};path=${path}`;
}

export function getCookie(name: string): string | null {
  const decodedCookie = document.cookie;
  const cookies = decodedCookie.split("; ");
  for (const c of cookies) {
    const [key, val] = c.split("=");
    if (key === name) {
      return val ? decodeURIComponent(val) : "";
    }
  }
  return null;
}

export function deleteCookie(name: string, path = "/"): void {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=${path};`;
}

export default defineComponent({
  methods: { setCookie, getCookie, deleteCookie },
});
