export function useGitInfo() {
  function getLatestTag() {
    return import.meta.env.VITE_GIT_LATEST_TAG || "";
  }
  return {
    getLatestTag,
  };
}
