export default {
  mounted(el: HTMLElement) {
    setTimeout(() => {
      const links = el.querySelectorAll("a");
      links.forEach((link) => {
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
      });
    }, 100);
  },
};
