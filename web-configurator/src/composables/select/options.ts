import { SelectTypes } from "@/types/enums";
import type {
  CountryListItem,
  IconDefinition,
  LanguageListItem,
  MeasurementUnitList,
  SelectOption,
} from "@/types/config";

export function buildOptions(
  rawOptions:
    | false
    | string[]
    | LanguageListItem[]
    | IconDefinition[]
    | CountryListItem[]
    | MeasurementUnitList,
  type: SelectTypes,
): SelectOption[] {
  if (!rawOptions) {
    return [];
  }
  let allOptions: SelectOption[] = [];
  if (type === SelectTypes.Country) {
    allOptions = buildOptionsFromCountryList(rawOptions as CountryListItem[]);
  } else if (type === SelectTypes.Language) {
    allOptions = buildOptionsFromLanguageList(rawOptions as LanguageListItem[]);
  } else if (type === SelectTypes.Icon) {
    allOptions = buildOptionsFromIconList(rawOptions as Array<string>);
  } else if (Array.isArray(rawOptions)) {
    allOptions = buildOptionsFromArray(rawOptions as string[]);
  } else {
    allOptions = buildOptionsFromObject(rawOptions);
  }
  return allOptions;
}

function buildOptionsFromArray(rawOptions: string[]) {
  return rawOptions.map((label, index) => {
    return {
      index,
      value: label,
      label,
      search: label.toLowerCase(),
    };
  });
}

function buildOptionsFromObject(
  rawOptions: MeasurementUnitList,
): SelectOption[] {
  const allOptions: SelectOption[] = [];
  Object.keys(rawOptions).forEach((value: string, index: number) => {
    const label = (rawOptions as any)[value];
    allOptions.push({
      index,
      value,
      label,
      search: label.toLowerCase(),
    });
  });
  return allOptions;
}

function buildOptionsFromCountryList(rawOptions: CountryListItem[]) {
  return rawOptions.map((item: CountryListItem, index: number) => {
    // @todo select native label to display.
    const label = item.name_en;
    return {
      index,
      value: item.code,
      label,
      search: label.toLowerCase(),
    };
  });
}

function buildOptionsFromLanguageList(rawOptions: LanguageListItem[]) {
  return rawOptions.map((item: LanguageListItem, index: number) => {
    const label = item.name;
    return {
      index,
      value: item.code,
      label,
      search: label.toLowerCase(),
    };
  });
}

function buildOptionsFromIconList(rawOptions: Array<string>) {
  return rawOptions.map((item: string, index: number) => {
    const name = item;
    const label = name
      .replace(/-/g, " ")
      .split(" ")
      .map((slice: string) => {
        return slice.charAt(0).toUpperCase() + slice.slice(1);
      })
      .join(" ");
    return {
      index,
      value: "uc:" + item,
      label,
      search: label.toLowerCase(),
    };
  });
}
