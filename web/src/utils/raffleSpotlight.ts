export type SpotlightDrawPhase = 'spinning' | 'revealing';

export interface LiveDrawState {
  drawId: string;
  phase: SpotlightDrawPhase;
  prizeId: number;
  prizeName: string;
  eligibleTicketCount: number;
  previewTicketSampleCount: number;
  previewTicketSampleIsSample: boolean;
  previewTicketNumbers: string[];
  winnerName?: string;
  winnerTicketNumber?: string;
  startedAt: number;
}

export interface SpotlightPreferencesState {
  holdWinnerOnScreen: boolean;
  hasLocalOverride: boolean;
}

export const AUTO_DISMISS_DELAY_MS = 9000;

export function resolveWinnerDisplayName(
  winnerName?: string | null,
  winnerTicketNumber?: string | null
): string {
  const cleanedName = winnerName?.trim();
  if (cleanedName) return cleanedName;

  const cleanedTicket = winnerTicketNumber?.trim();
  if (cleanedTicket) return `Ticket #${cleanedTicket}`;

  return 'Winner Selected';
}

export function shouldAutoDismissSpotlight(
  liveDraw: LiveDrawState | null,
  holdWinnerOnScreen: boolean
): boolean {
  if (!liveDraw) return false;
  if (liveDraw.phase !== 'revealing') return false;
  return !holdWinnerOnScreen;
}

export function applyServerHoldPreference(
  current: SpotlightPreferencesState,
  serverHoldFlag: boolean | undefined
): SpotlightPreferencesState {
  if (current.hasLocalOverride || typeof serverHoldFlag !== 'boolean') {
    return current;
  }

  return {
    holdWinnerOnScreen: serverHoldFlag,
    hasLocalOverride: false,
  };
}

export function toggleLocalHoldPreference(
  current: SpotlightPreferencesState
): SpotlightPreferencesState {
  return {
    holdWinnerOnScreen: !current.holdWinnerOnScreen,
    hasLocalOverride: true,
  };
}

export function transitionSpotlightOnDrawStarted(next: {
  drawId: string;
  prizeId: number;
  prizeName: string;
  eligibleTicketCount: number;
  previewTicketSampleCount: number;
  previewTicketSampleIsSample: boolean;
  previewTicketNumbers: string[];
  startedAt: number;
}): LiveDrawState {
  return {
    drawId: next.drawId,
    phase: 'spinning',
    prizeId: next.prizeId,
    prizeName: next.prizeName,
    eligibleTicketCount: next.eligibleTicketCount,
    previewTicketSampleCount: next.previewTicketSampleCount,
    previewTicketSampleIsSample: next.previewTicketSampleIsSample,
    previewTicketNumbers: next.previewTicketNumbers,
    startedAt: next.startedAt,
  };
}

export function transitionSpotlightOnWinnerRevealed(
  current: LiveDrawState | null,
  payload: {
    drawId: string;
    winnerName?: string | null;
    winnerTicketNumber?: string | null;
  }
): LiveDrawState | null {
  if (!current || current.drawId !== payload.drawId) return current;

  return {
    ...current,
    phase: 'revealing',
    winnerName: resolveWinnerDisplayName(payload.winnerName, payload.winnerTicketNumber),
    winnerTicketNumber: payload.winnerTicketNumber || undefined,
  };
}

export function transitionSpotlightOnCleared(): null {
  return null;
}
