import type {
  FlashMessageInfoStatus,
  FlashMessageType,
  FlashMessagePlacement,
} from "@/types/enums";

type ApiResponseBody = {
  data: any;
  status: number;
  statusText: string;
};

export type ApiErrorMessage = {
  code: string;
  message: string;
  response?: ApiResponseBody;
};

export type ErrorTexts = {
  message?: string;
};

export interface FlashMessageBase {
  id?: string;
  timeout?: number;
  closeable?: boolean;
}

export interface FlashMessageString extends FlashMessageBase {
  message: string;
}

export interface FlashMessageTranslate extends FlashMessageBase {
  translate: string;
  args?: Record<string, any>;
}

export interface FlashMessageApiError extends FlashMessageBase {
  message: ApiErrorMessage;
}

export type FlashMessageData = FlashMessageString | FlashMessageApiError;

export type FlashMessageItem = FlashMessageData & {
  type: FlashMessageType;
  status?: FlashMessageInfoStatus;
  message?: string;
  placement?: FlashMessagePlacement;
  parent?: HTMLElement;
};

export type FlashMessageDisplayMeta = {
  icon: string;
  color: string;
};
