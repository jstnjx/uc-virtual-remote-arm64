export type MediaItem = {
  title: string;
  media_id: string;
  media_type: string;
  media_class?: string;
  subtitle?: string;
  artist?: string;
  album?: string;
  can_browse?: boolean;
  can_play?: boolean;
  can_search?: boolean;
  thumbnail?: string;
  items?: MediaItem[];
};
