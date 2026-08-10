export type NewGroupData = {
  name: string;
  description?: string;
  icon?: string;
  entities?: string[];
};

export type Group = {
  group_id: string;
  profile_id: string;
  name: string;
  description?: string;
  icon?: string;
  entities: string[];
};
