/**
 * Settings > General > About > Licenses, against a real core.
 *
 * The feature reads nothing from the Core API — the row is static and the attribution page is
 * a build asset — so what this file proves is the wiring the unit tests cannot: that the page
 * is actually served next to the app, that ~150 fenced license texts render inside the modal
 * without pushing the page into horizontal overflow, and that the modal joins the shared
 * dismissal registry (ADR 014/015) like every other overlay.
 *
 * One thing it cannot prove: the device's own web server serving `dist/licenses.md`. Both the
 * dev server and `vite preview` serve `public/` happily, so a green run here says nothing
 * about the shipped image — see the change's design.md R1.
 */
import { expect, test, type Page } from "@playwright/test";

import { assertBackendIsSimulator } from "./fixtures/simulator";
import { login } from "./fixtures/app";

const LICENSES_URL = /licenses\.md(\?|$)/;

test.beforeAll(async () => {
  await assertBackendIsSimulator();
});

const licensesRow = (page: Page) =>
  page.locator(".about-remote .settings-data-field--link");

const modal = (page: Page) => page.locator(".modal-secondary--licenses");

const modalBody = (page: Page) => modal(page).locator(".modal-secondary__body");

async function openAbout(page: Page) {
  await login(page);
  await page.goto("/#/settings/general?action=about");
  await expect(licensesRow(page)).toBeVisible();
}

/**
 * The row shipped once looking like a bare "›": it is a `<button>`, so the label inherited the
 * user agent's `buttontext` (black) rather than the page's text colour — neither the global
 * `button` rule nor `.settings-data-field__label` sets one — and went invisible on the dark
 * theme. Only a real browser has the stylesheet, so this has to live here.
 */
test("labels the row legibly, not just with a chevron", async ({ page }) => {
  await openAbout(page);

  const label = licensesRow(page).locator(".settings-data-field__label");
  await expect(label).toBeVisible();
  await expect(label).toHaveText("License information");

  const contrast = await label.evaluate((el) => {
    const parse = (value: string) =>
      (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    // Relative luminance is enough here: the bug was near-black text on a near-black page.
    const luminance = (rgb: number[]) =>
      rgb.length === 3
        ? (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255
        : 0;
    let node: HTMLElement | null = el as HTMLElement;
    let background = "";
    while (node && !background) {
      const value = getComputedStyle(node).backgroundColor;
      if (value && value !== "rgba(0, 0, 0, 0)" && value !== "transparent") {
        background = value;
      }
      node = node.parentElement;
    }
    return {
      text: luminance(parse(getComputedStyle(el).color)),
      background: luminance(parse(background || "rgb(0, 0, 0)")),
    };
  });

  expect(
    Math.abs(contrast.text - contrast.background),
    `label luminance ${contrast.text} vs background ${contrast.background} — the label must not blend into the page`,
  ).toBeGreaterThan(0.3);
});

test("does not request the attribution page until the row is activated", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (LICENSES_URL.test(request.url())) {
      requests.push(request.url());
    }
  });

  await openAbout(page);
  // The About page is fully settled and nothing has asked for the 0.5 MB document.
  expect(requests).toEqual([]);

  await licensesRow(page).click();
  await expect(modal(page)).toBeVisible();
  expect(requests).toHaveLength(1);
});

test("renders the attribution page as markdown", async ({ page }) => {
  await openAbout(page);
  await licensesRow(page).click();

  await expect(modal(page)).toBeVisible();
  await expect(modal(page).locator(".modal-secondary__header")).toContainText(
    "License information",
  );

  const body = modalBody(page);
  // Rendered, not dumped: headings became elements and the license texts are fenced blocks.
  await expect(body.locator("h4").first()).toBeVisible();
  expect(await body.locator("pre").count()).toBeGreaterThan(100);
  await expect(body).not.toContainText("#### ");
});

/**
 * The software license is a named, addressable section rather than an untitled preamble — asked
 * for in review so the About pointer can be precise and so an auditor can see at a glance that
 * the product states a license for itself. Checked on the real page, where ~150 package headings
 * are competing for ids.
 */
test("gives the software license section its own anchor", async ({ page }) => {
  await openAbout(page);
  await licensesRow(page).click();
  await expect(modal(page)).toBeVisible();

  const software = modalBody(page).locator("h2#software-license");
  await expect(software).toHaveText("Software license");
  await expect(modalBody(page).locator("h2#third-party-licenses")).toHaveCount(
    1,
  );
  // The notice itself sits under that heading, not somewhere else on the page.
  const notice = await software.evaluate(
    (el) => el.nextElementSibling?.textContent ?? "",
  );
  expect(notice).toContain("Unfolded Circle ApS");
});

test("license blocks wrap instead of scrolling the page sideways", async ({
  page,
}) => {
  await openAbout(page);
  await licensesRow(page).click();
  await expect(modal(page)).toBeVisible();

  const overflows = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(overflows, "the page must not scroll horizontally").toBe(false);

  const block = modalBody(page).locator("pre").first();
  const wraps = await block.evaluate(
    (el) => el.scrollWidth <= el.clientWidth + 1,
  );
  expect(wraps, "license blocks must wrap within the modal").toBe(true);
});

test("links open in a new tab, safely", async ({ page }) => {
  await openAbout(page);
  await licensesRow(page).click();
  await expect(modal(page)).toBeVisible();

  const links = modalBody(page).locator("a");
  expect(await links.count()).toBeGreaterThan(0);

  // Asserted on the attributes only — following them would leave the app.
  const attributes = await links.evaluateAll((elements) =>
    elements.map((el) => ({
      target: el.getAttribute("target"),
      rel: el.getAttribute("rel"),
    })),
  );
  for (const attribute of attributes) {
    expect(attribute.target).toBe("_blank");
    expect(attribute.rel).toBe("noopener noreferrer");
  }
});

test("closes with the close button and with ESC", async ({ page }) => {
  await openAbout(page);

  await licensesRow(page).click();
  await expect(modal(page)).toBeVisible();
  await modal(page).locator(".button-close").click();
  await expect(modal(page)).toBeHidden();

  await licensesRow(page).click();
  await expect(modal(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(modal(page)).toBeHidden();
});

test("the row is reachable and operable by keyboard", async ({ page }) => {
  await openAbout(page);

  await licensesRow(page).focus();
  await expect(licensesRow(page)).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(modal(page)).toBeVisible();
});

/**
 * Below $bp-tablet (992px) the data-field icons become visible and the modal container drops to
 * `max-width: 96vw`, so both the row and the fenced license blocks are laid out differently
 * than on the desktop width the tests above use.
 */
for (const viewport of [
  { name: "tablet", width: 900, height: 1000 },
  { name: "phone", width: 390, height: 780 },
]) {
  test(`stays usable at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openAbout(page);
    await licensesRow(page).click();
    await expect(modal(page)).toBeVisible();

    const overflows = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(overflows, "the page must not scroll horizontally").toBe(false);

    const body = modalBody(page);
    const bodyOverflows = await body.evaluate(
      (el) => el.scrollWidth > el.clientWidth,
    );
    expect(bodyOverflows, "the modal must not scroll horizontally").toBe(false);

    const wraps = await body
      .locator("pre")
      .first()
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    expect(wraps, "license blocks must wrap at this width").toBe(true);

    // Scrollable, not collapsed to nothing by the raised max-height.
    const scrollable = await body.evaluate(
      (el) => el.clientHeight > 100 && el.scrollHeight > el.clientHeight,
    );
    expect(scrollable, "the document must be scrollable in the modal").toBe(
      true,
    );
  });
}
