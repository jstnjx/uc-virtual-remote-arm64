import type { LanguageText } from "@/types/config";

export type SystemUpdateCheck = {
  update_in_progress: boolean;
  last_check_date?: string;
  next_check_date: string;
  installed_version: string;
  update_check_enabled: boolean;
  available?: AvailableSystemUpdate[];
};

export type AvailableSystemUpdate = {
  id: string;
  title: string;
  description: LanguageText;
  version: string;
  channel: string;
  release_date: string;
  release_notes_url?: string;
  size: number;
  download: string;
};

export type SystemUpdateMessage = {
  event_type: string;
  update_id: string;
  progress?: SystemUpdateProgress;
};

export type SystemUpdateProgress = {
  state: string;
  total_steps?: number;
  current_step?: number;
  current_percent?: number;
  update_id: string;
  download_percent?: number;
};
