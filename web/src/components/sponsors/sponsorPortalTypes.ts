export interface PortalSlot {
  id: number;
  slot_number: number;
  player_name: string | null;
  player_email: string | null;
  player_phone: string | null;
  tshirt_size?: string | null;
  handicap?: number | null;
}

export interface SponsorInfo {
  id: number;
  name: string;
  tier: string;
  tier_display: string;
  slot_count: number;
  tournament_id: number;
  logo_url: string | null;
  website_url: string | null;
}

export interface TournamentInfo {
  id?: number;
  name: string;
  year?: number | null;
  event_date: string | null;
  team_size?: number;
  handicap_required?: boolean;
  waiver_enabled?: boolean;
  sponsor_edit_deadline: string | null;
  edit_deadline_passed?: boolean;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
}

export interface OrgInfo {
  name: string;
  primary_color: string;
  logo_url?: string | null;
}

export type VerifiedSponsorPortalData = {
  sponsor: SponsorInfo;
  tournament: TournamentInfo;
  organization: OrgInfo;
  sessionToken: string;
};

export interface PortalSponsorship {
  sponsor_id: number;
  sponsor_name: string;
  tier_display: string;
  slot_count: number;
  filled_count: number;
  tournament_name: string;
  tournament_year: number | null;
  event_date: string | null;
  current: boolean;
}

/** Maps the raw API portal payload (confirm / switch) to the stored session shape. */
export function toVerifiedPortalData(data: {
  sponsor: SponsorInfo;
  tournament: TournamentInfo;
  organization: OrgInfo;
  session_token: string;
}): VerifiedSponsorPortalData {
  return {
    sponsor: data.sponsor,
    tournament: data.tournament,
    organization: data.organization,
    sessionToken: data.session_token,
  };
}
