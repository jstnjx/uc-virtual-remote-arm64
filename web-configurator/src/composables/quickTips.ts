import { useTranslation } from "i18next-vue";

export function useQuickTips() {
  const { t, i18next } = useTranslation();

  function getQuickTips() {
    // Access i18next.language to ensure reactivity if used in a computed property
    void i18next.language;
    const textSource = "quick_tips.tip";
    const quickTipItems = [];

    for (let i = 1; i <= 6; i++) {
      if (!i18next.exists(`${textSource}${i}.headline`)) {
        break;
      }
      const itemHeadline = t(`${textSource}${i}.headline`);

      if (!i18next.exists(`${textSource}${i}.body`)) {
        break;
      }
      const itemBody = t(`${textSource}${i}.body`);

      let itemImg = "";
      if (i18next.exists(`${textSource}${i}.img`)) {
        itemImg = t(`${textSource}${i}.img`);
      }

      quickTipItems.push({
        headline: itemHeadline,
        body: itemBody,
        img: itemImg,
      });
    }

    return quickTipItems;
  }

  return {
    getQuickTips,
  };
}
