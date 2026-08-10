export type NewPageData = {
  name: string;
  image?: string;
  items?: PageItem[];
  pos?: number;
};

export type Page = {
  page_id: string;
  profile_id: string;
  name: string;
  image: string;
  items: PageItem[];
  pos: number;
};

export type PageItem = {
  entity_id?: string;
  group_id?: string;
  pos: number;
};
