import type { LanguageText } from "@/types/config";

export type ExternalSystem = {
  system: string;
  name: string;
  token_count?: number;
  token_id?: string;
  intg_driver_id?: string;
  intg_name?: LanguageText;
  icon?: string;
};

export type ExternalSystemQueryParams = {
  type?: "TOKEN" | "OAUTH2_APP" | "OAUTH2_TOKEN";
  state?: "ALL" | "NEW" | "ACTIVE";
  intg?: boolean;
};

export type ApplicationCredentialNewData = {
  name: string;
  token_id: string;
  token: string;
  token_type?: "TOKEN" | "OAUTH2_APP" | "OAUTH2_TOKEN";
};
