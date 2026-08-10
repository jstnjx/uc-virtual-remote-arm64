import type {
  DriverSetting,
  SettingTypeCheckbox,
  SettingTypeDropdown,
  SettingTypeLabel,
  SettingTypeNumber,
  SettingTypePassword,
  SettingTypeText,
  SettingTypeTextArea,
} from "@/types/integrationInstance";

import BrokenField from "@/components/integration/add/field/BrokenField.vue";
import NumberField from "@/components/integration/add/field/NumberField.vue";
import TextField from "@/components/integration/add/field/TextField.vue";
import TextareaField from "@/components/integration/add/field/TextareaField.vue";
import PasswordField from "@/components/integration/add/field/PasswordField.vue";
import CheckboxField from "@/components/integration/add/field/CheckboxField.vue";
import DropdownField from "@/components/integration/add/field/DropdownField.vue";
import LabelField from "@/components/integration/add/field/LabelField.vue";

export function setupFieldType(setting: DriverSetting) {
  if ((setting.field as SettingTypeNumber).number) {
    return NumberField;
  }
  if ((setting.field as SettingTypeText).text) {
    return TextField;
  }
  if ((setting.field as SettingTypeTextArea).textarea) {
    return TextareaField;
  }
  if ((setting.field as SettingTypePassword).password) {
    return PasswordField;
  }
  if ((setting.field as SettingTypeCheckbox).checkbox) {
    return CheckboxField;
  }
  if ((setting.field as SettingTypeDropdown).dropdown) {
    return DropdownField;
  }
  if ((setting.field as SettingTypeLabel).label) {
    return LabelField;
  }
  return BrokenField;
}

export function setValue(setting: DriverSetting, value: any) {
  if ((setting.field as SettingTypeNumber).number) {
    (setting.field as SettingTypeNumber).number.value = value;
  } else if ((setting.field as SettingTypeText).text) {
    (setting.field as SettingTypeText).text.value = value;
  } else if ((setting.field as SettingTypeTextArea).textarea) {
    (setting.field as SettingTypeTextArea).textarea.value = value;
  } else if ((setting.field as SettingTypePassword).password) {
    (setting.field as SettingTypePassword).password.value = value;
  } else if ((setting.field as SettingTypeCheckbox).checkbox) {
    (setting.field as SettingTypeCheckbox).checkbox.value = value;
  } else if ((setting.field as SettingTypeDropdown).dropdown) {
    (setting.field as SettingTypeDropdown).dropdown.value = value;
  }
}

export function setConfigurationValue(
  settings: DriverSetting[],
  id: string,
  value: any,
) {
  const field = settings.find((setting) => {
    return id === setting.id;
  });
  if (field) {
    setValue(field, value);
  }
}
