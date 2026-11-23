import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAdmin } from '../contexts';

interface AdminRouteGuardProps {
  children: React.ReactNode;
  capability?: string;
  anyOf?: string[];
  superAdminOnly?: boolean;
}

export const AdminOnlyRoute: React.FC<AdminRouteGuardProps> = ({
  children,
  capability,
  anyOf,
  superAdminOnly = false,
}) => {
  const { isVolunteer, isSuperAdmin, can } = useAdmin();

  if (superAdminOnly && !isSuperAdmin) {
    return <Navigate to="/admin" replace />;
  }

  if (capability) {
    if (!can(capability)) return <Navigate to="/admin" replace />;
    return <>{children}</>;
  }

  if (anyOf && anyOf.length > 0) {
    if (!anyOf.some((cap) => can(cap))) return <Navigate to="/admin" replace />;
    return <>{children}</>;
  }

  if (isVolunteer) {
    return <Navigate to="/admin" replace />;
  }

  return <>{children}</>;
};
