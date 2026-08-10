import type { LanguageText } from "@/types/config";
import type { RemoteKind } from "@/types/enums";

export type BluetoothProfile = {
  id: string;
  name: LanguageText;
  version: number;
  peripherals: {
    keyboard: boolean;
    mouse: boolean;
  };
};

export type BluetoothInfo = {
  profile: number;
  dev_profile_id: string;
  dev_profile_version: number;
  peer: {
    address: string;
    addr_type: string;
  };
  peripherals: {
    keyboard: boolean;
    mouse: boolean;
  };
};

export type BluetoothRemote = {
  entity_id: string;
  name: LanguageText;
  kind: RemoteKind;
  icon?: string;
  description?: LanguageText;
  bt?: {
    dev_profile_id?: string;
  };
};

export type BluetoothRemoteNewData = {
  name: LanguageText;
  kind: RemoteKind;
  icon?: string;
  bt?: {
    dev_profile_id?: string;
  };
};

export type BluetoothPairing = {
  paired: boolean;
  pairing_enabled: boolean;
  advertisement_name: string;
  peer?: {
    address: string;
    addr_type: string;
  };
};

export type BluetoothPairingMessage = {
  id?: number;
  passkey?: string;
  confirm?: boolean;
};

export type BluetoothPairingEvent = {
  kind: string;
  msg: string;
  cat: string;
  ts: string;
  msg_data: {
    id: number;
    entity_id?: string;
    kind?: string;
    status_code?: string;
    success?: boolean;
    reason?: string;
    profile?: number;
    peer?: {
      address?: string;
    };
  };
};
