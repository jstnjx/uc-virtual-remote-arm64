export type LogData = {
  boots: LogsBoots[];
  services: LogsServices[];
};

export type LogsServices = {
  active: boolean;
  service: string;
  name: string;
};

export type LogsBoots = {
  index: number;
  boot_id: string;
  first_entry: string;
  last_entry: string;
};

export type LogsParamsDownload = {
  p?: number;
  s?: string;
  limit?: number;
  from?: string;
  to?: string;
  q?: string;
  boot_ids?: string;
};
