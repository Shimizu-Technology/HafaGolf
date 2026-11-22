import { describe, it, expect } from 'vitest';
import {
  extractLaneLookupName,
  getAlphaLane,
  matchesAlphaLane,
  filterByAlphaLane,
  countByAlphaLane,
  compareByLastName,
} from './checkInLanes';

describe('checkInLanes', () => {
  it('extracts last name from full name and skips generational suffixes', () => {
    expect(extractLaneLookupName({ name: 'Maria Santos' })).toBe('Santos');
    expect(extractLaneLookupName({ name: 'John Cruz Jr.' })).toBe('Cruz');
    expect(extractLaneLookupName({ name: 'Carlos Perez III', last_name: 'III' })).toBe('Perez');
    expect(extractLaneLookupName({ name: 'Madonna' })).toBe('Madonna');
  });

  it('classifies A–J vs K–Z boundaries accurately including accented letters', () => {
    expect(getAlphaLane({ name: 'Alex Anderson' })).toBe('a_j');
    expect(getAlphaLane({ name: 'Sam Johnson' })).toBe('a_j');
    expect(getAlphaLane({ name: 'Pat Kim' })).toBe('k_z');
    expect(getAlphaLane({ name: 'Dana Zimmerman' })).toBe('k_z');
    expect(getAlphaLane({ name: 'Luis Ávila' })).toBe('a_j');
    expect(getAlphaLane({ name: 'Elena Núñez' })).toBe('k_z');
  });

  it('filters and counts golfers per lane', () => {
    const players = [
      { id: 1, name: 'Ben Ada' },
      { id: 2, name: 'Grace Flores' },
      { id: 3, name: 'Chris Guerrero' },
      { id: 4, name: 'Kim Reyes' },
      { id: 5, name: 'Taylor Santos' },
    ];

    expect(countByAlphaLane(players)).toEqual({ all: 5, a_j: 3, k_z: 2 });
    expect(filterByAlphaLane(players, 'all')).toHaveLength(5);
    expect(filterByAlphaLane(players, 'a_j').map((p) => p.id)).toEqual([1, 2, 3]);
    expect(filterByAlphaLane(players, 'k_z').map((p) => p.id)).toEqual([4, 5]);
    expect(matchesAlphaLane(players[0], 'a_j')).toBe(true);
    expect(matchesAlphaLane(players[0], 'k_z')).toBe(false);
  });

  it('sorts golfers by last name then full name', () => {
    const players = [
      { name: 'Zack Cruz' },
      { name: 'Anna Reyes' },
      { name: 'Amy Cruz' },
    ];
    expect(players.sort(compareByLastName).map((p) => p.name)).toEqual([
      'Amy Cruz',
      'Zack Cruz',
      'Anna Reyes',
    ]);
  });
});
