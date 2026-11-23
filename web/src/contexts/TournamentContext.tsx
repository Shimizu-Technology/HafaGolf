import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useLatestRequest } from '../hooks/useLatestRequest';
import { api, Tournament } from '../services/api';

interface TournamentContextType {
  tournaments: Tournament[];
  currentTournament: Tournament | null;
  activeTournament: Tournament | null;
  isLoading: boolean;
  error: string | null;
  setCurrentTournament: (tournament: Tournament | null) => void;
  refreshTournaments: () => Promise<void>;
}

const TournamentContext = createContext<TournamentContextType | undefined>(undefined);

interface TournamentProviderProps {
  children: ReactNode;
  orgSlug?: string;
}

export function TournamentProvider({ children, orgSlug }: TournamentProviderProps) {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [currentTournament, setCurrentTournamentState] = useState<Tournament | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const startRefresh = useLatestRequest(orgSlug);

  const fetchTournaments = useCallback(async (): Promise<Tournament[]> => {
    if (orgSlug) {
      return api.getAdminOrganizationTournaments(orgSlug);
    }

    return api.getTournaments();
  }, [orgSlug]);

  const refreshTournaments = async () => {
    const isCurrent = startRefresh();
    if (!isCurrent()) return;
    try {
      setIsLoading(true);
      setError(null);
      const data = await fetchTournaments();
      if (!isCurrent()) return;
      setTournaments(data);

      if (currentTournament) {
        const refreshedCurrent = data.find((t) => t.id === currentTournament.id);
        if (refreshedCurrent) {
          setCurrentTournamentState(refreshedCurrent);
        }
      } else {
        // If no current tournament is set, try to find the open one
        const openTournament = data.find(t => t.status === 'open');
        if (openTournament) {
          setCurrentTournamentState(openTournament);
          api.setCurrentTournament(openTournament.id);
        } else if (data.length > 0) {
          // Fall back to the most recent tournament
          const mostRecent = [...data].sort((a, b) => b.year - a.year || b.id - a.id)[0];
          setCurrentTournamentState(mostRecent);
          api.setCurrentTournament(mostRecent.id);
        }
      }
    } catch (err) {
      if (isCurrent()) setError(err instanceof Error ? err.message : 'Failed to load tournaments');
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  };

  const setCurrentTournament = useCallback((tournament: Tournament | null) => {
    setCurrentTournamentState(tournament);
    api.setCurrentTournament(tournament?.id || null);
    
    // Save to localStorage for persistence
    if (tournament) {
      localStorage.setItem('currentTournamentId', tournament.id.toString());
    } else {
      localStorage.removeItem('currentTournamentId');
    }
  }, []);

  // Load tournaments on mount or organization switch
  useEffect(() => {
    const isCurrent = startRefresh();

    const loadInitialTournaments = async () => {
      if (!orgSlug) {
        setTournaments([]);
        setCurrentTournamentState(null);
        api.setCurrentTournament(null);
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);
        const data = await fetchTournaments();
        if (!isCurrent()) return;
        setTournaments(data);

        if (data.length === 0) {
          setCurrentTournamentState(null);
          api.setCurrentTournament(null);
          return;
        }

        // Try to restore from localStorage first if it belongs to this org
        const savedId = localStorage.getItem('currentTournamentId');
        if (savedId) {
          const savedTournament = data.find(t => t.id === parseInt(savedId));
          if (savedTournament) {
            setCurrentTournamentState(savedTournament);
            api.setCurrentTournament(savedTournament.id);
            return;
          }
        }

        // Otherwise, find the open tournament
        const openTournament = data.find(t => t.status === 'open');
        if (openTournament) {
          setCurrentTournamentState(openTournament);
          api.setCurrentTournament(openTournament.id);
        } else {
          // Fall back to the most recent tournament
          const mostRecent = [...data].sort((a, b) => b.year - a.year || b.id - a.id)[0];
          setCurrentTournamentState(mostRecent);
          api.setCurrentTournament(mostRecent.id);
        }
      } catch (err) {
        if (isCurrent()) {
          setError(err instanceof Error ? err.message : 'Failed to load tournaments');
        }
      } finally {
        if (isCurrent()) {
          setIsLoading(false);
        }
      }
    };

    loadInitialTournaments();

  }, [fetchTournaments, orgSlug, startRefresh]);

  return (
    <TournamentContext.Provider
      value={{
        tournaments,
        currentTournament,
        activeTournament: currentTournament,
        isLoading,
        error,
        setCurrentTournament,
        refreshTournaments,
      }}
    >
      {children}
    </TournamentContext.Provider>
  );
}

export function useTournament() {
  const context = useContext(TournamentContext);
  if (context === undefined) {
    throw new Error('useTournament must be used within a TournamentProvider');
  }
  return context;
}
