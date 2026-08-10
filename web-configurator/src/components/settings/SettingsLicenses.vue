<script setup lang="ts">
import { ref } from "vue";
import { useTranslation } from "i18next-vue";

import type { PluginSimple } from "markdown-it";
import VueMarkdown from "vue-markdown-render";

import ModalSecondary from "@/components/elements/ModalSecondary.vue";

import { addErrorFull } from "@/stores/messages";

const { t } = useTranslation();

/**
 * Sets `target="_blank"` while the markdown is rendered, rather than afterwards.
 *
 * The `v-markdown-tools` directive does the same job for the release-notes markdown, but from a
 * 100 ms timer in its `mounted` hook. With ~150 attribution entries this page renders in under
 * 30 ms, so for the rest of that window every link would still navigate in place — an e2e run
 * caught it. A renderer rule has the attributes in the HTML from the first paint.
 */
/**
 * Gives every heading an `id` derived from its text, so the sections are addressable — the
 * software license in particular, which an auditor should be able to point at rather than
 * describe as "the bit above the dependency list". markdown-it emits bare `<h2>` otherwise, and
 * `html: false` means an anchor written into the markdown would be escaped rather than rendered.
 */
const headingAnchors: PluginSimple = (md) => {
  const renderDefault =
    md.renderer.rules.heading_open ??
    ((tokens, index, options, _env, self) =>
      self.renderToken(tokens, index, options));

  md.renderer.rules.heading_open = (tokens, index, options, env, self) => {
    const inline = tokens[index + 1];
    const slug =
      inline && inline.type === "inline"
        ? inline.content
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
        : "";

    if (slug) {
      tokens[index].attrSet("id", slug);
    }
    return renderDefault(tokens, index, options, env, self);
  };
};

const externalLinks: PluginSimple = (md) => {
  const renderDefault =
    md.renderer.rules.link_open ??
    ((tokens, index, options, _env, self) =>
      self.renderToken(tokens, index, options));

  md.renderer.rules.link_open = (tokens, index, options, env, self) => {
    tokens[index].attrSet("target", "_blank");
    tokens[index].attrSet("rel", "noopener noreferrer");
    return renderDefault(tokens, index, options, env, self);
  };
};

// The attribution page is ~0.5 MB, so it is a static asset fetched on demand rather than part
// of any JS chunk. Cached module-level: reopening the view must not refetch it.
let cachedLicenses = "";

const licenses = ref("");
const show = ref(false);
const loading = ref(false);

defineExpose({
  open,
});

async function open(): Promise<void> {
  if (loading.value) {
    return;
  }

  if (!cachedLicenses) {
    loading.value = true;
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}licenses.md`);
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      cachedLicenses = await response.text();
    } catch (e) {
      // A failed fetch carries no `response`, so the `error_status`/`error_code` key
      // convention in getErrorMessage() cannot resolve it — pass the message explicitly
      // rather than letting it degrade to "unknown error".
      console.error(e);
      addErrorFull(t("settings.general.about.licenses.error"));
      return;
    } finally {
      loading.value = false;
    }
  }

  licenses.value = cachedLicenses;
  show.value = true;
}
</script>
<template>
  <Teleport to="body">
    <ModalSecondary
      :show="show"
      :width="'56.25rem'"
      :name="'modal-licenses'"
      class="modal-secondary--licenses"
      @close="show = false"
    >
      <template #header>
        {{ $t("settings.general.about.licenses.title", "License information") }}
      </template>
      <div class="markdown-wrapper">
        <!-- `linkify` is required here: the generated page writes repository URLs as bare
             text, so without it no link is rendered at all. It never touches URLs inside the
             fenced license texts. `html` stays off (markdown-it's default). -->
        <vue-markdown
          :source="licenses"
          :options="{ linkify: true }"
          :plugins="[externalLinks, headingAnchors]"
          class="vue-markdown licenses__text"
        />
      </div>
    </ModalSecondary>
  </Teleport>
</template>
