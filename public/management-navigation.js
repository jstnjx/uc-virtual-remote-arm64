const tabs = [...document.querySelectorAll("[data-management-tab]")];
const panels = [...document.querySelectorAll("[data-management-panel]")];
const breadcrumb = document.querySelector(".breadcrumbs strong");
const storageKey = "ucvr-management-section";
const labels = new Map(tabs.map((tab) => [tab.dataset.managementTab, tab.textContent.trim()]));
const validSections = new Set(labels.keys());

function sectionFromHash() {
  const value = window.location.hash.replace(/^#/, "").toLowerCase();
  return validSections.has(value) ? value : null;
}

function storedSection() {
  try {
    const value = localStorage.getItem(storageKey);
    return validSections.has(value) ? value : null;
  } catch {
    return null;
  }
}

function remember(section) {
  try { localStorage.setItem(storageKey, section); } catch {}
}

function setHash(section, replace = false) {
  const hash = `#${section}`;
  if (window.location.hash === hash) return;
  const method = replace ? "replaceState" : "pushState";
  history[method](null, "", hash);
}

function activate(section, options = {}) {
  const target = validSections.has(section) ? section : "overview";
  const previous = document.body.dataset.managementSection || null;
  tabs.forEach((tab) => {
    const active = tab.dataset.managementTab === target;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  panels.forEach((panel) => {
    panel.hidden = panel.dataset.managementPanel !== target;
  });
  document.body.dataset.managementSection = target;
  if (breadcrumb) breadcrumb.textContent = labels.get(target) || "System";
  remember(target);
  if (options.updateHash !== false) setHash(target, Boolean(options.replaceHash));
  if (options.scrollTop) {
    window.scrollTo({ top: 0, behavior: options.smooth ? "smooth" : "auto" });
  }
  if (previous !== target) {
    window.dispatchEvent(new CustomEvent("ucvr:management-section-change", {
      detail: { section: target, previous },
    }));
  }
  return target;
}

function moveTab(current, offset) {
  const index = tabs.indexOf(current);
  const next = tabs[(index + offset + tabs.length) % tabs.length];
  next?.focus();
  if (next?.dataset.managementTab) {
    activate(next.dataset.managementTab, { scrollTop: true });
  }
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    activate(tab.dataset.managementTab, { scrollTop: true, smooth: true });
  });
  tab.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveTab(tab, 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveTab(tab, -1);
    } else if (event.key === "Home") {
      event.preventDefault();
      tabs[0]?.focus();
      activate(tabs[0]?.dataset.managementTab || "overview", { scrollTop: true });
    } else if (event.key === "End") {
      event.preventDefault();
      const last = tabs[tabs.length - 1];
      last?.focus();
      activate(last?.dataset.managementTab || "overview", { scrollTop: true });
    }
  });
});

window.addEventListener("hashchange", () => {
  activate(sectionFromHash() || "overview", { updateHash: false, scrollTop: true });
});

window.UCVRManagementNavigation = {
  open(section, targetId = null) {
    activate(section, { scrollTop: !targetId });
    if (targetId) {
      requestAnimationFrame(() => {
        document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  },
  active() {
    return tabs.find((tab) => tab.getAttribute("aria-selected") === "true")?.dataset.managementTab || "overview";
  },
};

activate(sectionFromHash() || storedSection() || "overview", {
  updateHash: true,
  replaceHash: true,
});
