import { describe, expect, it } from 'vitest';
import {
  applyServerHoldPreference,
  resolveWinnerDisplayName,
  shouldAutoDismissSpotlight,
  toggleLocalHoldPreference,
  transitionSpotlightOnCleared,
  transitionSpotlightOnDrawStarted,
  transitionSpotlightOnWinnerRevealed,
} from './raffleSpotlight';

describe('raffleSpotlight state transitions', () => {
  it('holds revealed winner indefinitely when hold mode is enabled (default banquet mode)', () => {
    const started = transitionSpotlightOnDrawStarted({
      drawId: 'draw-1',
      prizeId: 10,
      prizeName: 'Grand Vacation Package',
      eligibleTicketCount: 150,
      previewTicketSampleCount: 80,
      previewTicketSampleIsSample: true,
      previewTicketNumbers: ['HG27-0001', 'HG27-0002'],
      startedAt: 1000,
    });

    expect(shouldAutoDismissSpotlight(started, true)).toBe(false);
    expect(shouldAutoDismissSpotlight(started, false)).toBe(false);

    const revealed = transitionSpotlightOnWinnerRevealed(started, {
      drawId: 'draw-1',
      winnerName: 'Maria Cruz',
      winnerTicketNumber: 'HG27-0042',
    });

    expect(revealed?.phase).toBe('revealing');
    expect(revealed?.winnerName).toBe('Maria Cruz');
    expect(revealed?.winnerTicketNumber).toBe('HG27-0042');

    // Banquet hold mode: never auto-dismisses
    expect(shouldAutoDismissSpotlight(revealed, true)).toBe(false);
    // Auto-dismiss mode: auto-dismisses after reveal
    expect(shouldAutoDismissSpotlight(revealed, false)).toBe(true);
  });

  it('replaces a held winner cleanly when the next prize draw starts or spotlight is cleared', () => {
    const revealed = transitionSpotlightOnWinnerRevealed(
      transitionSpotlightOnDrawStarted({
        drawId: 'draw-1',
        prizeId: 10,
        prizeName: 'Prize One',
        eligibleTicketCount: 50,
        previewTicketSampleCount: 50,
        previewTicketSampleIsSample: false,
        previewTicketNumbers: ['HG27-0001'],
        startedAt: 1000,
      }),
      {
        drawId: 'draw-1',
        winnerName: 'Carlos Santos',
        winnerTicketNumber: 'HG27-0001',
      }
    );

    expect(revealed?.phase).toBe('revealing');

    // Starting next draw replaces held winner immediately
    const nextDraw = transitionSpotlightOnDrawStarted({
      drawId: 'draw-2',
      prizeId: 11,
      prizeName: 'Prize Two',
      eligibleTicketCount: 49,
      previewTicketSampleCount: 49,
      previewTicketSampleIsSample: false,
      previewTicketNumbers: ['HG27-0002'],
      startedAt: 2000,
    });
    expect(nextDraw.drawId).toBe('draw-2');
    expect(nextDraw.phase).toBe('spinning');
    expect(nextDraw.winnerName).toBeUndefined();

    // Admin clear_spotlight dismisses overlay cleanly
    expect(transitionSpotlightOnCleared()).toBeNull();
  });

  it('ignores stale reveal events for an older drawId', () => {
    const current = transitionSpotlightOnDrawStarted({
      drawId: 'draw-2',
      prizeId: 11,
      prizeName: 'Prize Two',
      eligibleTicketCount: 49,
      previewTicketSampleCount: 49,
      previewTicketSampleIsSample: false,
      previewTicketNumbers: ['HG27-0002'],
      startedAt: 2000,
    });

    const unchanged = transitionSpotlightOnWinnerRevealed(current, {
      drawId: 'draw-1',
      winnerName: 'Old Winner',
      winnerTicketNumber: 'HG27-0001',
    });

    expect(unchanged).toBe(current);
    expect(unchanged?.phase).toBe('spinning');
  });

  it('respects server hold preference until operator toggles locally', () => {
    const initial = { holdWinnerOnScreen: true, hasLocalOverride: false };
    const fromServer = applyServerHoldPreference(initial, false);
    expect(fromServer).toEqual({ holdWinnerOnScreen: false, hasLocalOverride: false });

    const localToggle = toggleLocalHoldPreference(fromServer);
    expect(localToggle).toEqual({ holdWinnerOnScreen: true, hasLocalOverride: true });

    // Subsequent server updates do not overwrite operator's local toggle
    const afterServerBroadcast = applyServerHoldPreference(localToggle, false);
    expect(afterServerBroadcast).toEqual({ holdWinnerOnScreen: true, hasLocalOverride: true });
  });

  it('resolves prominent winner display name with clean fallbacks', () => {
    expect(resolveWinnerDisplayName('  Elena Sablan  ', 'HG27-0010')).toBe('Elena Sablan');
    expect(resolveWinnerDisplayName('   ', 'HG27-0010')).toBe('Ticket #HG27-0010');
    expect(resolveWinnerDisplayName(null, null)).toBe('Winner Selected');
  });
});
