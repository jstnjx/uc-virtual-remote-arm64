// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";

import clickOutside from "@/directives/clickOutside";

// Mirrors the shape of the directive's callers: an element that closes/resets
// itself when a click lands anywhere outside of it.
const Host = defineComponent({
  props: {
    handler: { type: Function, required: true },
  },
  template: `
    <div>
      <div v-click-outside="handler" class="target">
        <button class="child">child</button>
      </div>
      <button class="outside">outside</button>
    </div>
  `,
});

function mountHost(handler: () => void) {
  return mount(Host, {
    props: { handler },
    global: { directives: { "click-outside": clickOutside } },
    attachTo: document.body,
  });
}

function click(el: Element) {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

// The directive registers its window listener one task after mounting, so that
// the click revealing the element cannot trigger it.
function listenerRegistered() {
  return new Promise((resolve) => setTimeout(resolve));
}

describe("v-click-outside", () => {
  it("fires the handler on a click outside the element", async () => {
    const handler = vi.fn();
    const wrapper = mountHost(handler);
    await listenerRegistered();

    click(wrapper.get(".outside").element);

    expect(handler).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("ignores clicks on the element itself and its children", async () => {
    const handler = vi.fn();
    const wrapper = mountHost(handler);
    await listenerRegistered();

    click(wrapper.get(".target").element);
    click(wrapper.get(".child").element);

    expect(handler).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("calls the current handler after the binding changes", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const wrapper = mountHost(first);
    await listenerRegistered();

    await wrapper.setProps({ handler: second });
    click(wrapper.get(".outside").element);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("ignores the click that mounted the element", async () => {
    // A "+" button that reveals a v-click-outside element is the common caller.
    // Vue patches the DOM in a microtask, so in the browser the element mounts
    // while that very click is still bubbling up to the window - it must not be
    // treated as an outside click, or the element closes again right away.
    const handler = vi.fn();
    const opener = document.createElement("button");
    document.body.appendChild(opener);

    let wrapper: ReturnType<typeof mountHost> | undefined;
    opener.addEventListener("click", () => {
      wrapper = mountHost(handler);
    });
    click(opener);
    await listenerRegistered();

    expect(handler).not.toHaveBeenCalled();
    wrapper?.unmount();
    opener.remove();
  });

  it("stops listening once the element is unmounted", async () => {
    const handler = vi.fn();
    const wrapper = mountHost(handler);
    wrapper.unmount();
    await listenerRegistered();

    click(document.body);

    expect(handler).not.toHaveBeenCalled();
  });
});
