import type {
  IrCodeSetType,
  RemoteIrCodeFormat,
  IrLearningEventType,
} from "@/types/enums";

export type IrEmitterPort = {
  port_id: string;
  name: string;
};

export type IrEmitter = {
  device_id: string;
  name: string;
  active: boolean;
  ports: IrEmitterPort[];
  type?: string;
  capabilities?: IrEmitterCapabilities;
};

export type IrEmitterCapabilities = {
  learning?: IrEmitterLearning;
};

export type IrEmitterLearning = {
  description: string;
  instruction: string;
  formats: RemoteIrCodeFormat;
};

export type IrEmitterOption = {
  label: string;
  value: string;
  active: boolean;
};

export type ManufacturerInfo = {
  id: string;
  name: string;
};
export type ManufacturerCodeset = {
  id: string;
  name: string;
};

export type IrCode = {
  codeset_id: string;
  cmd_id: string;
  port_id?: string;
};

export type IrCodeDefinition = {
  value: string;
  format: RemoteIrCodeFormat;
};

export type RemoteIrCode = {
  cmd_id: string;
  code?: IrCodeDefinition;
  custom?: boolean;
  modified?: boolean;
};

export type RemoteDataSet = {
  id?: string;
  name?: string;
  type?: IrCodeSetType;
  codes?: RemoteIrCode[];
};

export type IrEmitterLearnStatus = {
  device_id: string;
  learning_active: boolean;
  codes: LearnedIrCode[];
};

export type LearnedIrCode = {
  code?: string;
  format?: RemoteIrCodeFormat;
  timestamp?: string;
};

export type IrLearnEventData = {
  device_id: string;
  event_type: IrLearningEventType;
  code?: IrCodeDefinition;
};

export type CodeSetFileData = {
  data: string;
  headers: any;
};
