import type { LanguageText } from "@/types/config";
import type { ApiErrorResponse } from "@/types/rest";

export type ResourceType = string;
export type ResourceImageSize = {
  width: number;
  height: number;
};

export type SupportedResource = {
  type: ResourceType;
  name: LanguageText;
  description: LanguageText;
  file_formats: string[];
  max_file_size: number;
  max_count: number;
  image?: {
    description?: string;
    sizes: ResourceImageSize[];
  };
  sound?: {
    description?: string;
    sampling_rates?: number[];
  };
};

export type ResourceItem = {
  type?: ResourceType;
  id?: string;
  size: number;
};

export type UploadResult = {
  success: boolean;
  response?: ResourceItem | ApiErrorResponse;
  error?: unknown;
};

export type ResourceTypeOption = SupportedResource & {
  id: string;
};
