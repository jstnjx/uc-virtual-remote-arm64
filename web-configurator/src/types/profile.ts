import type { IconIdentifier } from "@/types/config";
import type { Page } from "@/types/page";

export type Profile = {
  profile_id: string;
  name: string;
  icon?: IconIdentifier;
  restricted: boolean;
  pages?: Page[];
};

// `PATCH /api/profiles/:id` is a genuine partial update: every field is
// optional and omitted fields are left unchanged (verified against the
// core simulator, core 0.74.1 — resolves finish-type-honesty OQ-1).
export type ProfileUpdate = {
  name?: string;
  icon?: IconIdentifier;
  update_pin?: boolean;
  restricted?: boolean;
  pin?: string;
  description?: string;
  pages?: string[];
};

export type ProfileNewData = {
  profile_id?: string;
  name: string;
  icon?: IconIdentifier;
  pin?: string;
  restricted?: boolean;
  description?: string;
};

export type SwitchProfileData = {
  admin_pin?: string;
};
