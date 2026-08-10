/**
 * Driving the app itself: what every spec has to do before it can assert on a
 * screen.
 *
 * Each spec used to carry its own copy of login(), and none of them waited for
 * the app to become usable. That is not a cosmetic gap: while the app has no
 * live session it covers the page with a full-screen "Reconnecting" overlay, so
 * a click issued too early lands on the overlay instead of its target and
 * Playwright retries it until the test times out — a 90s failure whose call log
 * says only that the target was visible the whole time. Gating here turns that
 * into a named failure inside the expect timeout.
 */
import { expect, type Page } from "@playwright/test";

export const PIN = "1234";

/**
 * Teleported to <body> at z-index 3000, so while it is up it swallows every
 * click on the page beneath it.
 */
const RECONNECTING = ".notification-reconnecting";

/**
 * Type a PIN and submit it, without waiting for the outcome — for the tests
 * that assert on a rejected PIN.
 */
export async function enterPin(page: Page, pin: string): Promise<void> {
  // One console line per connection state transition, captured in the trace of
  // a failing run. Without it a stuck "Reconnecting" and a slow one look the
  // same afterwards, which is exactly the state we could not diagnose.
  await page.addInitScript(() =>
    localStorage.setItem("uc.debug.connection", "1"),
  );
  await page.goto("/#/login");

  // UC Virtual Remote intentionally shows an unofficial-build notice whenever
  // the login screen opens. It is a real modal, so dismiss it before exercising
  // the PIN form beneath it.
  const unofficialNotice = page.getByRole("heading", {
    name: "Unofficial Web Configurator",
    exact: true,
  });
  await expect(unofficialNotice).toBeVisible();
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(unofficialNotice).toBeHidden();

  const input = page.locator('input[type="password"]');
  await input.fill(pin);
  await input.press("Enter");
}

/** Log in and wait until the app has a live session and accepts input. */
export async function login(page: Page): Promise<void> {
  await enterPin(page, PIN);
  await expect(page, "login should land on the home route").toHaveURL(/#\/$/);
  await expectConnected(page);
}

/**
 * The app holds a live session. Worth asserting again after anything that can
 * drop the WebSocket — a reset, a reload, a viewport change mid-navigation.
 */
export function expectConnected(page: Page) {
  return expect(
    page.locator(RECONNECTING),
    'the app never got a live session: the "Reconnecting" overlay stayed up',
  ).toBeHidden();
}
