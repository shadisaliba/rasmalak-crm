// Mirrors org_role_rank() and org_can_grant_role() in the membership migration so the UI only
// offers changes the database will accept. The database remains the authority.
const ROLE_RANK: Record<string, number> = {
  owner: 50,
  admin: 40,
  manager: 30,
  bookkeeper: 30,
  sales_rep: 20,
  adviser: 10,
  viewer: 10,
};

// Custom roles rank at admin level: their permissions are not bounded by their name.
export function roleRank(role: string): number {
  return ROLE_RANK[role] ?? 40;
}

export function canGrantRole(granterRole: string | null, role: string): boolean {
  if (!granterRole) return false;
  if (role === 'owner' || role === 'admin') return granterRole === 'owner';
  return roleRank(role) <= roleRank(granterRole);
}

export function canManageMember(managerRole: string | null, memberRole: string): boolean {
  if (managerRole !== 'owner' && managerRole !== 'admin') return false;
  if (memberRole === 'owner') return managerRole === 'owner';
  return roleRank(memberRole) <= roleRank(managerRole);
}
