export function useTextHelper() {
  function breakText(text = "", charactersPerLine: number) {
    if (!text.includes("_") && text.length < charactersPerLine) {
      return text;
    }

    let formattedText = "";
    for (let i = 0; i < text.length; i += charactersPerLine) {
      formattedText += text.slice(i, i + charactersPerLine) + "\n";
    }

    return formattedText;
  }

  /**
   * Test if a Latin character is a letter or not.
   *
   * Attention: this does not work for non-Latin alphabets!
   * @param c the character to test
   */
  function isLetter(c: string): boolean {
    return c.length === 1 && c.toLowerCase() != c.toUpperCase();
  }

  return {
    breakText,
    isLetter,
  };
}
