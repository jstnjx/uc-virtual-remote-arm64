export type SelectOption<V = string | number> = {
  label: string;
  value: V;
  icon?: string;
  disabled?: boolean;
};

export type DropdownItem = {
  icon?: string;
  label?: string;
  value: string;
  disabled?: boolean;
  description?: string;
};

export type TabItem = {
  value: string;
  icon?: string;
  label?: string;
  disabled?: boolean;
};

export type TranslatableValue = {
  value: any;
  langCode: string;
};

export type ColorPickerValue = {
  hsl: number[];
  rgb: number[];
};
