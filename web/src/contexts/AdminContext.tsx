import React, { createContext, useContext, useState, useCallback } from 'react';
import type { Admin } from '../services/api';

const VOLUNTEER_ROLES = new Set([
  'volunteer',
  'checkin_volunteer',
  'raffle_volunteer',
  'scoring_marshal',
]);

const LEGACY_VOLUNTEER_CAPS = new Set(['check_in', 'verify_door_payment', 'raffle_sell']);

interface AdminContextValue {
  currentAdmin: Admin | null;
  setCurrentAdmin: (admin: Admin | null) => void;
  isVolunteer: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isStationOnly: boolean;
  stationMode: 'checkin' | 'raffle' | 'scoring' | null;
  orgRoleLabel: string;
  can: (capability: string) => boolean;
}

const AdminContext = createContext<AdminContextValue>({
  currentAdmin: null,
  setCurrentAdmin: () => {},
  isVolunteer: false,
  isAdmin: false,
  isSuperAdmin: false,
  isStationOnly: false,
  stationMode: null,
  orgRoleLabel: '',
  can: () => false,
});

export const useAdmin = () => useContext(AdminContext);

export const AdminProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentAdmin, setCurrentAdmin] = useState<Admin | null>(null);

  const isSuperAdmin = Boolean(currentAdmin?.is_super_admin || currentAdmin?.role === 'super_admin');
  const stationMode = isSuperAdmin ? null : currentAdmin?.station_mode ?? null;
  const isStationOnly = Boolean(!isSuperAdmin && stationMode);
  const isVolunteer = Boolean(
    !isSuperAdmin && (isStationOnly || (currentAdmin?.org_role && VOLUNTEER_ROLES.has(currentAdmin.org_role)))
  );
  const isAdmin = !isVolunteer && currentAdmin != null;
  const orgRoleLabel =
    currentAdmin?.org_role_label ||
    (isSuperAdmin ? 'Platform Super Admin' : currentAdmin?.org_role?.replace(/_/g, ' ') || 'Staff');

  const can = useCallback(
    (capability: string): boolean => {
      if (!currentAdmin) return false;
      if (isSuperAdmin) return true;
      if (currentAdmin.capabilities) {
        return Boolean(currentAdmin.capabilities[capability]);
      }
      if (currentAdmin.org_role === 'admin' || currentAdmin.org_role === 'org_admin') return true;
      if (currentAdmin.org_role === 'volunteer') return LEGACY_VOLUNTEER_CAPS.has(capability);
      return false;
    },
    [currentAdmin, isSuperAdmin]
  );

  const handleSet = useCallback((admin: Admin | null) => {
    setCurrentAdmin(admin);
  }, []);

  return (
    <AdminContext.Provider
      value={{
        currentAdmin,
        setCurrentAdmin: handleSet,
        isVolunteer,
        isAdmin,
        isSuperAdmin,
        isStationOnly,
        stationMode,
        orgRoleLabel,
        can,
      }}
    >
      {children}
    </AdminContext.Provider>
  );
};
