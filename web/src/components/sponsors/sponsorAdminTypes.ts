import type { ComponentType } from 'react';

export interface AdminSponsorSlot {
  id: number;
  slot_number: number;
  player_name: string | null;
  player_email: string | null;
  player_phone: string | null;
  tshirt_size: string | null;
  handicap: number | null;
  confirmed_at: string | null;
}

export interface AdminSponsor {
  id: number;
  name: string;
  tier: string;
  tier_display: string;
  logo_url: string | null;
  raw_logo_url: string | null;
  has_uploaded_logo: boolean;
  website_url: string | null;
  description: string | null;
  course_key: string | null;
  course_name: string | null;
  hole_number: number | null;
  position: number;
  active: boolean;
  major: boolean;
  display_label: string;
  slot_count: number;
  login_email: string | null;
  slots_filled: number;
  highest_filled_slot?: number;
  has_active_portal_link: boolean;
  portal_link_issued_at: string | null;
}

export interface CourseConfig {
  key: string;
  name: string;
  hole_count: number;
}

export interface TierDefinition {
  key: string;
  label: string;
  sort_order: number;
}

export interface ManagedTournament {
  id: number;
  name: string;
  slug: string;
  team_size: number;
  handicap_required?: boolean;
  show_public_sponsors: boolean;
  sponsor_wall_title: string | null;
  public_listed: boolean;
  public_page_url: string | null;
  sponsor_edit_deadline: string | null;
  course_configs: CourseConfig[];
}

export interface TierOption {
  value: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
}
