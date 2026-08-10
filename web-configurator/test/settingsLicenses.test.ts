// @vitest-environment jsdom
/**
 * The Settings > General > About > Licenses view.
 *
 * The attribution page is a ~1.2 MB static asset, so the contract worth pinning is not the
 * markup but the loading behaviour around it: fetched only when opened, fetched only once,
 * a failure that stays visible instead of opening an empty modal, and every external link
 * rewritten to open in a new tab.
 *
 * The document itself writes repository URLs as bare text (`… downloaded from: https://…`),
 * never as markdown link syntax, so `linkify` is what makes any link exist at all. The
 * fixture below reproduces that shape, including a URL inside a fenced license text that
 * must stay plain.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { mount, flushPromises } from "@vue/test-utils";

import SettingsLicenses from "@/components/settings/SettingsLicenses.vue";

vi.mock("i18next-vue", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18next: { language: "en_US", exists: () => false },
  }),
}));

const addErrorFull = vi.fn();
vi.mock("@/stores/messages", () => ({
  addErrorFull: (...args: unknown[]) => addErrorFull(...args),
  hideMessage: vi.fn(),
}));

/**
 * The shape the generator emits: the two named sections, then an entry whose repository URL is
 * bare running text and whose license text is fenced.
 *
 * One fixture for the whole file on purpose — the component caches the document at module level
 * so that reopening the view does not refetch, and that cache outlives an individual test.
 */
const LICENSES_MD = `## Software license

Proprietary. All rights reserved.

## Third-party licenses

#### foo@1.0.0
License: MIT
This software may be included in this product and a copy of the source code may be downloaded from: https://github.com/example/foo.

\`\`\`
MIT License

Report issues at https://github.com/example/foo/issues
\`\`\`
`;

function mountView() {
  return mount(SettingsLicenses, {
    global: {
      mocks: { $t: (key: string) => key },
      stubs: { Teleport: true },
    },
  });
}

type View = ReturnType<typeof mountView>;

async function open(wrapper: View) {
  await (wrapper.vm as unknown as { open: () => Promise<void> }).open();
  await flushPromises();
  await nextTick();
}

function fetchOk(body = LICENSES_MD) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers();
  addErrorFull.mockClear();
  vi.stubGlobal("fetch", fetchOk());
  // The module-level document cache outlives a single mount by design (reopening must not
  // refetch), so each test starts from a fresh module registry.
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("loading the attribution document", () => {
  it("does not request it until the view is opened", async () => {
    mountView();
    await flushPromises();

    expect(fetch).not.toHaveBeenCalled();
  });

  it("requests it relative to the app's base URL", async () => {
    const wrapper = mountView();
    await open(wrapper);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      `${import.meta.env.BASE_URL}licenses.md`,
    );
  });

  /**
   * `html: false` means an anchor written into the markdown would be escaped rather than
   * rendered, so the ids come from a renderer rule. The software license section is the one that
   * has to be addressable — a reviewer asked for it by name.
   */
  it("gives every heading an id, so sections can be pointed at", async () => {
    const wrapper = mountView();
    await open(wrapper);

    expect(wrapper.find("h2#software-license").text()).toBe("Software license");
    expect(wrapper.find("h2#third-party-licenses").exists()).toBe(true);
    expect(wrapper.find("h4#foo-1-0-0").exists()).toBe(true);
  });

  it("renders it as markdown, not as raw source", async () => {
    const wrapper = mountView();
    await open(wrapper);

    const html = wrapper.html();
    expect(wrapper.find("h4").text()).toBe("foo@1.0.0");
    expect(html).toContain("<pre>");
    expect(html).not.toContain("#### foo@1.0.0");
  });
});

describe("the document is fetched at most once", () => {
  it("does not refetch when the view is reopened", async () => {
    const wrapper = mountView();
    await open(wrapper);
    await wrapper.find(".button-close").trigger("click");
    await open(wrapper);

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("external links", () => {
  /**
   * Without `linkify` markdown-it renders zero links here, because the generator never emits
   * `[…](…)`. That is the whole reason the view passes the option.
   */
  it("turns a bare repository URL in running text into a link", async () => {
    const wrapper = mountView();
    await open(wrapper);

    const links = wrapper.findAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].attributes("href")).toBe("https://github.com/example/foo");
  });

  it("leaves a URL inside a fenced license text as plain text", async () => {
    const wrapper = mountView();
    await open(wrapper);

    expect(wrapper.find("pre").find("a").exists()).toBe(false);
    expect(wrapper.find("pre").text()).toContain(
      "https://github.com/example/foo/issues",
    );
  });

  /**
   * Asserted on the first render, with no timer advanced. The `v-markdown-tools` directive this
   * view originally used rewrites anchors from a 100 ms timer, which left every link navigating
   * in place for the first 100 ms — a real gap an e2e run caught, since this page renders in
   * under 30 ms. The markdown-it renderer rule puts the attributes in the emitted HTML.
   */
  it("opens every link in a new tab, safely, from the first paint", async () => {
    const wrapper = mountView();
    await open(wrapper);

    const links = wrapper.findAll("a");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.attributes("target")).toBe("_blank");
      expect(link.attributes("rel")).toBe("noopener noreferrer");
    }
  });
});

describe("a failed load is reported, not silent", () => {
  it("surfaces an error and does not open an empty view on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: () => Promise.resolve(""),
      }),
    );
    const wrapper = mountView();
    await open(wrapper);

    expect(addErrorFull).toHaveBeenCalledTimes(1);
    expect(wrapper.find(".modal-secondary").exists()).toBe(false);
  });

  it("surfaces an error when the request itself rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const wrapper = mountView();
    await open(wrapper);

    expect(addErrorFull).toHaveBeenCalledTimes(1);
    expect(wrapper.find(".modal-secondary").exists()).toBe(false);
  });

  it("retries the fetch after a failure", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", failing);
    const wrapper = mountView();
    await open(wrapper);
    expect(failing).toHaveBeenCalledTimes(1);

    vi.stubGlobal("fetch", fetchOk());
    await open(wrapper);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(wrapper.find(".modal-secondary").exists()).toBe(true);
  });
});
