import { expect, test } from "vitest";
import translatedProperty, {
  hasDefaultCountryLocale,
  getValueByLang,
  isDefaultCountryLocale,
  getDefaultCountryLocale,
} from "../src/composables/translatedProperty";

///////////////////////////////////////////////////////////////////////////////
// getDefaultCountryLocale tests
///////////////////////////////////////////////////////////////////////////////

test("getDefaultCountryLocale returns the full locale for short language keys", () => {
  expect(getDefaultCountryLocale("de")).toBe("de_DE");
  expect(getDefaultCountryLocale("fr")).toBe("fr_FR");
  expect(getDefaultCountryLocale("it")).toBe("it_IT");
});

test("getDefaultCountryLocale returns the same locale for a default country locale", () => {
  expect(getDefaultCountryLocale("de_DE")).toBe("de_DE");
  expect(getDefaultCountryLocale("fr_FR")).toBe("fr_FR");
  expect(getDefaultCountryLocale("it_IT")).toBe("it_IT");
});

test("getDefaultCountryLocale returns the default country locale for a country locale", () => {
  expect(getDefaultCountryLocale("de_CH")).toBe("de_DE");
  expect(getDefaultCountryLocale("fr_CA")).toBe("fr_FR");
  expect(getDefaultCountryLocale("it_CH")).toBe("it_IT");
});

///////////////////////////////////////////////////////////////////////////////
// isDefaultCountryLocale tests
///////////////////////////////////////////////////////////////////////////////

test("isDefaultCountryLocale returns false for English keys", () => {
  // dedicated test case because English is used as a fallback language
  expect(isDefaultCountryLocale("en_US")).toBe(false);
  expect(isDefaultCountryLocale("en_UK")).toBe(false);
});

test("isDefaultCountryLocale returns false for short language keys", () => {
  expect(isDefaultCountryLocale("en")).toBe(false);
  expect(isDefaultCountryLocale("de")).toBe(false);
  expect(isDefaultCountryLocale("fr")).toBe(false);
  expect(isDefaultCountryLocale("it")).toBe(false);
});

test("isDefaultCountryLocale returns false for country specific language keys", () => {
  expect(isDefaultCountryLocale("de_CH")).toBe(false);
  expect(isDefaultCountryLocale("it_CH")).toBe(false);
  expect(isDefaultCountryLocale("fr_CA")).toBe(false);
});

test("isDefaultCountryLocale returns true for main language keys", () => {
  expect(isDefaultCountryLocale("de_DE")).toBe(true);
  expect(isDefaultCountryLocale("fr_FR")).toBe(true);
  expect(isDefaultCountryLocale("it_IT")).toBe(true);
});

///////////////////////////////////////////////////////////////////////////////
// hasDefaultCountryLocale tests
///////////////////////////////////////////////////////////////////////////////

test("hasDefaultCountryLocale returns false for English keys since there's no en_EN", () => {
  expect(hasDefaultCountryLocale("en")).toBe(false);
  expect(hasDefaultCountryLocale("en_US")).toBe(false);
  expect(hasDefaultCountryLocale("en_UK")).toBe(false);
});

test("hasDefaultCountryLocale returns true for available German keys", () => {
  // CI environment has all languages enabled, unless overridden with VITE_LANGUAGES
  // Local development: check ./env/.env.local
  expect(hasDefaultCountryLocale("de")).toBe(true);
  expect(hasDefaultCountryLocale("de_DE")).toBe(true);
  expect(hasDefaultCountryLocale("de_CH")).toBe(true);
  // no checks are made if the country code is valid. Not relevant for this function.
  expect(hasDefaultCountryLocale("de_##")).toBe(true);
});

///////////////////////////////////////////////////////////////////////////////
// translatedProperty & getValueByLang tests with empty input
///////////////////////////////////////////////////////////////////////////////

test("translatedProperty with undefined input returns empty string", () => {
  expect(translatedProperty(undefined, "en")).toBe("");
});

test("translatedProperty with null input returns empty string", () => {
  expect(translatedProperty(null as never, "en")).toBe("");
});

test("translatedProperty with empty input returns empty string", () => {
  expect(translatedProperty({}, "en")).toBe("");
});

test("getValueByLang with undefined input returns empty string", () => {
  expect(getValueByLang(undefined, "de_DE")).toStrictEqual({
    lang: "de_DE",
    value: "",
  });
});
test("getValueByLang with null input returns empty string", () => {
  expect(getValueByLang(null as never, "de_DE")).toStrictEqual({
    lang: "de_DE",
    value: "",
  });
});
test("getValueByLang with empty input returns empty string", () => {
  expect(getValueByLang({}, "de_DE")).toStrictEqual({
    lang: "de_DE",
    value: "",
  });
});
test("getValueByLang with no match returns fallback", () => {
  expect(getValueByLang({}, "it", false, "foobar")).toStrictEqual({
    lang: "it",
    value: "foobar",
  });
});

///////////////////////////////////////////////////////////////////////////////
// getValueByLang tests
///////////////////////////////////////////////////////////////////////////////

const languageTexts = {
  en: "English fallback",
  de: "German fallback",
  fr: "French fallback",
  de_DE: "German",
  de_CH: "Swiss German",
  en_UK: "UK English",
  en_US: "US English",
  fr_FR: "French",
  fr_CH: "Swiss French",
};

test("getValueByLang with full match", () => {
  expect(getValueByLang(languageTexts, "de_DE")).toStrictEqual({
    lang: "de_DE",
    value: "German",
  });
});
test("getValueByLang returns English fallback for missing it_CH", () => {
  expect(getValueByLang(languageTexts, "it_CH")).toStrictEqual({
    lang: "en",
    value: "English fallback",
  });
});
test("getValueByLang returns empty string in strict mode for missing it_CH", () => {
  expect(getValueByLang(languageTexts, "it_CH", true)).toStrictEqual({
    lang: "it_CH",
    value: "",
  });
});
// Note: this test case revealed an invalid logic in the old function! Returned de_DE instead of de fallback
test("getValueByLang returns other country-specific German fallback for missing de_AT", () => {
  // de_CH may NOT be returned
  expect(getValueByLang(languageTexts, "de_AT")).toStrictEqual({
    lang: "de",
    value: "German fallback",
  });
});

test("getValueByLang returns empty string in strict mode for missing de_AT", () => {
  expect(getValueByLang(languageTexts, "de_AT", true)).toStrictEqual({
    lang: "de_AT",
    value: "",
  });
});

test("getValueByLang returns empty string in strict mode for missing en_CA", () => {
  expect(getValueByLang(languageTexts, "en_CA", true)).toStrictEqual({
    lang: "en_CA",
    value: "",
  });
});

test("Short direct match for en", () => {
  expect(translatedProperty(languageTexts, "en")).toBe("English fallback");
});
test("Short direct match for de", () => {
  expect(translatedProperty(languageTexts, "de")).toBe("German fallback");
});
test("Direct match for en_US", () => {
  expect(translatedProperty(languageTexts, "en_US")).toBe("US English");
});
test("Direct match for en_UK", () => {
  expect(translatedProperty(languageTexts, "en_UK")).toBe("UK English");
});
test("Direct match for de_DE", () => {
  expect(translatedProperty(languageTexts, "de_DE")).toBe("German");
});
test("Direct match for de_CH", () => {
  expect(translatedProperty(languageTexts, "de_CH")).toBe("Swiss German");
});
test("German fallback for missing de_AT", () => {
  expect(translatedProperty(languageTexts, "de_AT")).toBe("German fallback");
});
test("Direct match for fr_FR", () => {
  expect(translatedProperty(languageTexts, "fr_FR")).toBe("French");
});
test("Direct match for fr_CH", () => {
  expect(translatedProperty(languageTexts, "fr_CH")).toBe("Swiss French");
});
test("French fallback for missing fr_CA", () => {
  expect(translatedProperty(languageTexts, "fr_CA")).toBe("French fallback");
});
test("English fallback for missing it", () => {
  expect(translatedProperty(languageTexts, "it")).toBe("English fallback");
});
test("English fallback for missing it_IT", () => {
  expect(translatedProperty(languageTexts, "it_IT")).toBe("English fallback");
});

///////////////////////////////////////////////////////////////////////////////
// translatedProperty tests for special Swiss German logic
///////////////////////////////////////////////////////////////////////////////

const swissSpecialTexts = {
  en: "English fallback",
  de_DE: "German",
  de_CH: "Swiss German",
};

test("CH: Short direct match for en", () => {
  expect(translatedProperty(swissSpecialTexts, "en")).toBe("English fallback");
});
test("CH: Direct match for de_DE", () => {
  expect(translatedProperty(swissSpecialTexts, "de_DE")).toBe("German");
});
test("CH: Direct match for de_CH", () => {
  expect(translatedProperty(swissSpecialTexts, "de_CH")).toBe("Swiss German");
});

// there is no `de` -> use first country specific match, EXCEPT de_CH
test("CH: German match for missing de", () => {
  expect(translatedProperty(swissSpecialTexts, "de")).toBe("German");
});
test("CH: German match for missing de_AT", () => {
  expect(translatedProperty(swissSpecialTexts, "de_AT")).toBe("German");
});

const swissSpecialTextsFallback = {
  en: "English fallback",
  de: "German fallback",
  de_DE: "German",
};

test("CH: getValueByLang in strict mode returns English fallback for en_US", () => {
  expect(
    getValueByLang(swissSpecialTextsFallback, "en_US", true),
  ).toStrictEqual({
    lang: "en",
    value: "English fallback",
  });
});
test("CH: getValueByLang in strict mode returns matching de_DE", () => {
  expect(
    getValueByLang(swissSpecialTextsFallback, "de_DE", true),
  ).toStrictEqual({
    lang: "de_DE",
    value: "German",
  });
});
test("CH: getValueByLang in strict mode returns empty string for missing de_CH", () => {
  expect(
    getValueByLang(swissSpecialTextsFallback, "de_CH", true),
  ).toStrictEqual({
    lang: "de_CH",
    value: "",
  });
});

///////////////////////////////////////////////////////////////////////////////
// translatedProperty tests without fallback texts
///////////////////////////////////////////////////////////////////////////////

const languageTextsWithoutFallback = {
  de_DE: "German",
  de_CH: "Swiss German",
  en_UK: "UK English",
  en_US: "US English",
  en_AU: "AU English",
  fr_FR: "French",
  fr_CH: "Swiss French",
};

test("First sorted en_## country text for missing en", () => {
  expect(translatedProperty(languageTextsWithoutFallback, "en")).toBe(
    "AU English",
  );
});

test("de_DE text for de without fallback", () => {
  expect(translatedProperty(languageTextsWithoutFallback, "de")).toBe("German");
});

const languageTextsWithoutEnglish = {
  de_DE: "German",
  de_CH: "Swiss German",
  fr_FR: "French",
  fr_CH: "Swiss French",
};

test("Fallback to first entry if no matches", () => {
  expect(translatedProperty(languageTextsWithoutEnglish, "xx")).toBe("German");
});

test("getValueByLang returns first entry if no matches", () => {
  expect(getValueByLang(languageTextsWithoutEnglish, "xx")).toStrictEqual({
    lang: "de_DE",
    value: "German",
  });
});
test("getValueByLang returns empty string in strict mode if no matches", () => {
  expect(getValueByLang(languageTextsWithoutEnglish, "xx", true)).toStrictEqual(
    {
      lang: "xx",
      value: "",
    },
  );
});

///////////////////////////////////////////////////////////////////////////////
// translatedProperty fallback tests with empty country texts
///////////////////////////////////////////////////////////////////////////////

// if a language text is empty, the next fallback must be returned
const emptyCountryText = {
  en: "English fallback",
  de: "German fallback",
  fr: "French fallback",
  de_DE: "",
  de_CH: "",
  en_UK: "",
  en_US: "",
  fr_FR: "",
  fr_CH: "",
};

test("translatedProperty returns language fallback for empty country text", () => {
  expect(translatedProperty(emptyCountryText, "de_DE")).toBe("German fallback");
  expect(translatedProperty(emptyCountryText, "de_CH")).toBe("German fallback");
  expect(translatedProperty(emptyCountryText, "en_UK")).toBe(
    "English fallback",
  );
  expect(translatedProperty(emptyCountryText, "en_US")).toBe(
    "English fallback",
  );
  expect(translatedProperty(emptyCountryText, "fr_FR")).toBe("French fallback");
  expect(translatedProperty(emptyCountryText, "fr_CH")).toBe("French fallback");
});

// if a language fallback text is empty, try a country specific fallback
const emptyCountryFallbackText = {
  en: "English fallback",
  de: "",
  fr: "",
  de_DE: "German",
  de_CH: "",
  fr_FR: "French",
  fr_CH: "",
  it_IT: "",
};

test("translatedProperty returns language fallback for empty country text", () => {
  expect(translatedProperty(emptyCountryFallbackText, "de")).toBe("German");
  expect(translatedProperty(emptyCountryFallbackText, "de_CH")).toBe("German");
  expect(translatedProperty(emptyCountryFallbackText, "de_DE")).toBe("German");
  expect(translatedProperty(emptyCountryFallbackText, "fr")).toBe("French");
  expect(translatedProperty(emptyCountryFallbackText, "fr_FR")).toBe("French");
  expect(translatedProperty(emptyCountryFallbackText, "fr_CH")).toBe("French");
  expect(translatedProperty(emptyCountryFallbackText, "it_IT")).toBe(
    "English fallback",
  );
});

// multiple entries with empty texts: first non-empty text needs to be returned in fallback logic
const finalFallbackText = {
  en: "",
  de: "",
  fr: "",
  de_DE: "German",
  de_CH: "",
  fr_CH: "",
  it_IT: "",
};

test("translatedProperty returns first non-empty language text for final fallback", () => {
  expect(translatedProperty(finalFallbackText, "en")).toBe("German");
  expect(translatedProperty(finalFallbackText, "it_IT")).toBe("German");
  expect(translatedProperty(finalFallbackText, "it")).toBe("German");
  expect(translatedProperty(finalFallbackText, "fr_CH")).toBe("German");
  expect(translatedProperty(finalFallbackText, "fr")).toBe("German");
  expect(translatedProperty(finalFallbackText, "sk")).toBe("German");
});
