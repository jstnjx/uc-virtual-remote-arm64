import BaseService from "@/api/services/BaseService";
import type ServiceInterface from "@/api/services/ServiceInterface";
import type {
  BluetoothRemote,
  BluetoothRemoteNewData,
  BluetoothProfile,
  BluetoothInfo,
  BluetoothPairing,
  BluetoothPairingMessage,
} from "@/types/bluetooth";
import type { ApiErrorResponse } from "@/types/rest";

export default class ServiceBluetooth
  extends BaseService
  implements ServiceInterface
{
  async getProfiles(): Promise<BluetoothProfile[]> {
    const response = await this.rest.request<BluetoothProfile[]>({
      method: "get",
      url: `/api/cfg/bt/profiles`,
    });
    return response.data;
  }

  async createBluetoothRemote(
    data: BluetoothRemoteNewData,
  ): Promise<BluetoothRemote> {
    const response = await this.rest.request<BluetoothRemote>({
      url: "/api/remotes",
      method: "post",
      data,
    });
    return response.data;
  }

  async getBtInfo(remoteId: string): Promise<BluetoothInfo> {
    const response = await this.rest.request<BluetoothInfo>({
      method: "get",
      url: `/api/remotes/${remoteId}/bt`,
    });
    return response.data;
  }

  async getBtPairing(remoteId: string): Promise<BluetoothPairing> {
    const response = await this.rest.request<BluetoothPairing>({
      method: "get",
      url: `/api/remotes/${remoteId}/bt/pairing`,
    });
    return response.data;
  }

  async changeBtPairing(
    remoteId: string,
    enabled = false,
  ): Promise<BluetoothPairing> {
    const response = await this.rest.request<BluetoothPairing>({
      method: "put",
      url: `/api/remotes/${remoteId}/bt/pairing?enabled=${enabled}`,
    });
    return response.data;
  }

  async updateBtPairing(
    remoteId: string,
    data: BluetoothPairingMessage,
  ): Promise<BluetoothPairing> {
    const response = await this.rest.request<BluetoothPairing>({
      method: "post",
      url: `/api/remotes/${remoteId}/bt/pairing`,
      data: data,
    });
    return response.data;
  }

  async removeBtPairing(remoteId: string): Promise<boolean> {
    const response = await this.rest.request<ApiErrorResponse>({
      method: "delete",
      url: `/api/remotes/${remoteId}/bt/pairing`,
    });
    return response.data.code === "OK";
  }
}
