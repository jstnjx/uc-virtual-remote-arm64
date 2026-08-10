import type { BatteryStatusValue } from "@/types/enums";

export type SystemInfo = {
  model_name: string;
  model_number: string;
  serial_number: string;
  hw_revision: string;
};

export type WifiStatus = {
  wpa_state: any;
  id: number;
  bssid: string;
  ssid: string;
  ssid_hex: string;
  freq: number;
  address: string;
  pairwise_cipher: string;
  group_cipher: string;
  key_mgmt: string;
  ip_address: string;
  noise: number;
  rssi: number;
  avg_rssi: number;
  est_throughput: number;
  snr: number;
  linkspeed: number;
};

export type PowerStatus = {
  mode: string;
  power_supply: boolean;
  standby_timeout_sec: number;
  standby_inhibitors: boolean;
};

export type BatteryStatus = {
  capacity: number;
  status: BatteryStatusValue;
  power_supply: boolean;
};

export type CustomWebConfiguratorStatus = {
  component: string;
  installed: boolean;
  active: boolean;
  release?: {
    version: string;
  };
};

export type StandbyInhibitor = {
  id: string;
  who: string;
  why: string;
  mode: string;
  delay: number;
  elapsed: number;
};

export type NewStandbyInhibitor = {
  id: string;
  who: string;
  why: string;
  delay: number;
};
