import BaseService from "@/api/services/BaseService";
import type ServiceInterface from "@/api/services/ServiceInterface";
import type { Group, NewGroupData } from "@/types/group";
import type {
  Profile,
  ProfileNewData,
  ProfileUpdate,
  SwitchProfileData,
} from "@/types/profile";
import type { NewPageData, Page } from "@/types/page";
import type { ApiErrorResponse } from "@/types/rest";

export default class ServiceProfiles
  extends BaseService
  implements ServiceInterface
{
  async getAll(activeProfiles = false): Promise<Profile[]> {
    let params = "?page=1&limit=100";
    if (activeProfiles == true) {
      params += "&active=true";
    }

    const response = await this.rest.request<Profile[]>({
      url: "/api/profiles" + params,
      method: "get",
    });
    return response.data || [];
  }

  async createNewProfile(data: ProfileNewData): Promise<Profile> {
    const response = await this.rest.request<Profile>({
      url: "/api/profiles",
      method: "post",
      data,
    });
    return response.data;
  }

  async switchActiveProfile(profile_id: string, pin = ""): Promise<boolean> {
    const data: SwitchProfileData = {};
    if (pin.length > 3) {
      data.admin_pin = pin;
    }
    const response = await this.rest.request<ApiErrorResponse>({
      url: `/api/profiles?active_profile_id=${profile_id}`,
      method: "put",
      data,
    });
    return response.data?.code === "OK";
  }

  async update(profile_id: string, data: ProfileUpdate): Promise<Profile> {
    const response = await this.rest.request<Profile>({
      url: `/api/profiles/${profile_id}`,
      method: "patch",
      data,
    });
    return response.data;
  }

  async delete(profile: Profile): Promise<boolean> {
    const response = await this.rest.request<ApiErrorResponse>({
      url: `/api/profiles/${profile.profile_id}`,
      method: "delete",
    });
    return response.data?.code === "OK";
  }

  async getProfile(profile_id: string): Promise<Profile> {
    const response = await this.rest.request<Profile>({
      url: `/api/profiles/${profile_id}`,
      method: "get",
    });
    return response.data;
  }

  async getPages(profile: Profile): Promise<Page[]> {
    const params = {};
    const response = await this.rest.request<Page[]>({
      url: `/api/profiles/${profile.profile_id}/pages`,
      method: "get",
      params,
    });
    return response.data || [];
  }

  async createNewPage(profile: Profile, page: NewPageData): Promise<Page[]> {
    const data = {
      profile_id: profile.profile_id,
      name: page.name,
      image: page.image,
      items: page.items,
      pos: page.pos,
    };
    const response = await this.rest.request<Page[]>({
      url: `/api/profiles/${profile.profile_id}/pages`,
      method: "post",
      data,
    });
    return response.data || [];
  }

  async updatePage(profile: Profile, page: Page): Promise<Page> {
    const response = await this.rest.request<Page>({
      url: `/api/profiles/${profile.profile_id}/pages/${page.page_id}`,
      method: "patch",
      data: page,
    });
    return response.data;
  }

  async deletePage(profile: Profile, page: Page): Promise<Page[]> {
    const params = {};
    const response = await this.rest.request<Page[]>({
      url: `/api/profiles/${profile.profile_id}/pages/${page.page_id}`,
      method: "delete",
      params,
    });
    return response.data || [];
  }

  async getGroups(profile: Profile): Promise<Group[]> {
    if (!profile || profile == null) {
      return [];
    }

    const params = {};
    const response = await this.rest.request<Group[]>({
      url: `/api/profiles/${profile.profile_id}/groups`,
      method: "get",
      params,
    });
    return response.data || [];
  }

  async createNewGroup(profile: Profile, group: NewGroupData): Promise<Group> {
    const data = {
      ...group,
      profile_id: profile.profile_id,
    };
    const response = await this.rest.request<Group>({
      url: `/api/profiles/${profile.profile_id}/groups`,
      method: "post",
      data,
    });
    return response.data;
  }

  async updateGroup(profile: Profile, group: Group): Promise<Group[]> {
    const data = {
      ...group,
    };
    const response = await this.rest.request<Group[]>({
      url: `/api/profiles/${profile.profile_id}/groups/${group.group_id}`,
      method: "patch",
      data,
    });
    return response.data || [];
  }

  async deleteGroup(profile: Profile, group: Group): Promise<Group[]> {
    const params = {};
    const response = await this.rest.request<Group[]>({
      url: `/api/profiles/${profile.profile_id}/groups/${group.group_id}`,
      method: "delete",
      params,
    });
    return response.data || [];
  }
}
