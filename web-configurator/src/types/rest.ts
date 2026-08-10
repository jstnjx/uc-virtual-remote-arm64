export type onRestError = (error: any) => void;

export type ApiErrorResponse = {
  code: string;
  message: string;
};

export type PaginationMeta = {
  count?: number;
  limit: number;
  page: number;
};

export type Headers = {
  "pagination-count"?: string;
  "pagination-limit"?: string;
  "pagination-page"?: string;
};
