<script setup lang="ts">
import { useGitInfo } from "@/composables/gitInfo";

const { getLatestTag } = useGitInfo();
</script>
<template>
  <p class="version-info">{{ getLatestTag() }}</p>
</template>
