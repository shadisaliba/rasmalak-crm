'use client';

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuthStore, getAuthState } from '@/store/authStore';
import type {
  Organization,
  OrgMember,
  OrgRole,
  OrgInvitation,
  CrmPermissions,
  CreateOrgInput,
} from '@/types/crm';
import { mapFromDb as mapRow, mapToDb } from '@/types/crm';
import { parseRpcError, type RpcFailure } from '@/lib/rpcError';

/* ============================================
   ORG STORE
   Context Provider for organization state.
   Pattern shared by the CRM stores:
   - createContext + Provider
   - Auth-gated fetching
   - getAuthState() in mutations
   - console.warn for errors (not console.error to avoid dev overlay)
   ============================================ */

const DEFAULT_PERMISSIONS: CrmPermissions = {
  'contacts.read': false,
  'contacts.write': false,
  'contacts.delete': false,
  'companies.read': false,
  'companies.write': false,
  'companies.delete': false,
  'deals.read': false,
  'deals.write': false,
  'deals.delete': false,
  'tasks.read': false,
  'tasks.write': false,
  'tasks.delete': false,
  'pipeline.configure': false,
  'team.manage': false,
  'team.invite': false,
  'reports.view': false,
  'reports.export': false,
  'settings.manage': false,
  'import.execute': false,
  'audit.view': false,
  'fields.manage': false,
  'sme.profile.read': false,
  'sme.profile.manage': false,
  'sme.ledger.read': false,
  'sme.ledger.post': false,
  'sme.ledger.reverse': false,
  'sme.imports.execute': false,
  'sme.parties.read': false,
  'sme.parties.identifiers': false,
  'sme.receivables.read': false,
  'sme.receivables.write': false,
  'sme.payables.read': false,
  'sme.payables.write': false,
  'sme.forecast.read': false,
  'sme.forecast.scenario': false,
  'sme.reports.export': false,
  'sme.calc.run': false,
  'sme.calc.save': false,
  'sme.assistant.use': false,
  'sme.learn.use': false,
  'sme.compliance.read': false,
  'sme.compliance.confirm': false,
  'sme.audit.read': false,
  'sme.access.manage': false,
};

interface OrgContextType {
  currentOrg: Organization | null;
  /** Every organization the user belongs to (live and demo). */
  organizations: Organization[];
  switchOrg: (orgId: string) => void;
  orgMembers: OrgMember[];
  orgRoles: OrgRole[];
  userRole: string | null;
  userPermissions: CrmPermissions;
  isLoading: boolean;

  createOrg: (data: CreateOrgInput) => Promise<Organization | null>;
  updateOrg: (data: Partial<Organization>) => Promise<void>;
  invitations: OrgInvitation[];
  inviteMember: (email: string, role: string, modules?: string[] | null) => Promise<{ ok: true; token: string } | ({ ok: false } & RpcFailure)>;
  revokeInvitation: (invitationId: string) => Promise<boolean>;
  refreshInvitations: () => Promise<void>;
  acceptInvitation: (token: string) => Promise<{ ok: true; orgId: string } | ({ ok: false } & RpcFailure)>;
  updateMemberRole: (memberId: string, role: string) => Promise<boolean>;
  removeMember: (memberId: string) => Promise<boolean>;
  refreshMembers: () => Promise<void>;
}

const OrgContext = createContext<OrgContextType | null>(null);

// The organization the user last chose on this device.
const CURRENT_ORG_KEY = 'crm-current-org';
function readStoredOrg(): string | null {
  try { return localStorage.getItem(CURRENT_ORG_KEY); } catch { return null; }
}
function storeOrg(orgId: string) {
  try { localStorage.setItem(CURRENT_ORG_KEY, orgId); } catch { /* private mode: the choice lasts this session */ }
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selection, setSelection] = useState(0);
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [orgRoles, setOrgRoles] = useState<OrgRole[]>([]);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userPermissions, setUserPermissions] = useState<CrmPermissions>(DEFAULT_PERMISSIONS);
  const [isLoading, setIsLoading] = useState(true);
  const [invitations, setInvitations] = useState<OrgInvitation[]>([]);

  // Keyed on the id: Supabase hands out a new user object on every token refresh.
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const initialized = useAuthStore((state) => state.initialized);

  // The database is the source of truth: member overrides and SME module scopes included.
  const resolvePermissions = useCallback(async (orgId: string): Promise<CrmPermissions> => {
    const { data, error } = await supabase.rpc('sme_my_permissions', { p_org: orgId });
    if (error || !data) return DEFAULT_PERMISSIONS;
    return { ...DEFAULT_PERMISSIONS, ...(data as Partial<CrmPermissions>) };
  }, []);

  // Load user's org on auth ready
  useEffect(() => {
    const loadUserOrg = async () => {
      if (!initialized) return;

      if (!userId) {
        setCurrentOrg(null);
        setOrgMembers([]);
        setOrgRoles([]);
        setUserRole(null);
        setUserPermissions(DEFAULT_PERMISSIONS);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);

      try {
        // Find orgs where user is an active member
        const { data: memberRows, error: memberError } = await supabase
          .from('org_members')
          .select('*, organizations(*)')
          .eq('user_id', userId)
          .eq('is_active', true);

        if (memberError) {
          console.warn('[OrgStore] Error fetching org memberships:', memberError.message);
          setIsLoading(false);
          return;
        }

        if (!memberRows || memberRows.length === 0) {
          // User has no org — OrgGuard will redirect to setup
          setCurrentOrg(null);
          setIsLoading(false);
          return;
        }

        const memberships = memberRows.map(r => ({ org: mapRow<Organization>(r.organizations as Record<string, unknown>), role: r.role as string }));
        setOrganizations(memberships.map(m => m.org));
        // A remembered choice wins; otherwise a live organization comes before any demo.
        const stored = readStoredOrg();
        const chosen = memberships.find(m => m.org.id === stored) ?? memberships.find(m => !m.org.isDemo) ?? memberships[0];
        const org = chosen.org;
        setCurrentOrg(org);
        setUserRole(chosen.role);

        // Load all members for this org
        const { data: allMembers, error: membersError } = await supabase
          .from('org_members')
          .select('*')
          .eq('org_id', org.id)
          .eq('is_active', true);

        if (membersError) {
          console.warn('[OrgStore] Error fetching members:', membersError.message);
        } else if (allMembers) {
          setOrgMembers(allMembers.map(r => mapRow<OrgMember>(r)));
        }

        // Load roles for this org
        const { data: roles, error: rolesError } = await supabase
          .from('org_roles')
          .select('*')
          .eq('org_id', org.id);

        if (rolesError) {
          console.warn('[OrgStore] Error fetching roles:', rolesError.message);
        } else if (roles) {
          const mappedRoles = roles.map(r => mapRow<OrgRole>(r));
          setOrgRoles(mappedRoles);
          setUserPermissions(await resolvePermissions(org.id));
        }
      } catch (err) {
        console.warn('[OrgStore] Unexpected error loading org:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadUserOrg();
  }, [userId, initialized, resolvePermissions, selection]);

  const switchOrg = useCallback((orgId: string) => {
    storeOrg(orgId);
    setSelection(s => s + 1);
  }, []);

  // Create a new organization
  const createOrg = useCallback(async (data: CreateOrgInput): Promise<Organization | null> => {
    const { user, initialized } = getAuthState();
    if (!initialized || !user) {
      console.warn('[OrgStore] Cannot create org: auth not ready');
      return null;
    }

    try {
      const dbData = mapToDb(data as Record<string, unknown>);
      const { data: row, error } = await supabase
        .from('organizations')
        .insert({ ...dbData, created_by: user.id })
        .select()
        .single();

      if (error) {
        console.warn('[OrgStore] Error creating org:', error.message);
        return null;
      }

      if (!row) return null;

      const org = mapRow<Organization>(row);
      storeOrg(org.id);
      setOrganizations(prev => [...prev, org]);

      // Wait briefly for triggers to fire (owner member, pipeline, roles)
      await new Promise(resolve => setTimeout(resolve, 500));

      // Reload full org state
      setCurrentOrg(org);

      // Reload members
      const { data: members } = await supabase
        .from('org_members')
        .select('*')
        .eq('org_id', org.id)
        .eq('is_active', true);

      if (members) setOrgMembers(members.map(r => mapRow<OrgMember>(r)));

      // Reload roles and resolve permissions
      const { data: roles } = await supabase
        .from('org_roles')
        .select('*')
        .eq('org_id', org.id);

      if (roles) {
        const mappedRoles = roles.map(r => mapRow<OrgRole>(r));
        setOrgRoles(mappedRoles);
        setUserRole('owner');
        setUserPermissions(await resolvePermissions(org.id));
      }

      return org;
    } catch (err) {
      console.warn('[OrgStore] Unexpected error creating org:', err);
      return null;
    }
  }, [resolvePermissions]);

  // Update org fields
  const updateOrg = useCallback(async (data: Partial<Organization>) => {
    const { user, initialized } = getAuthState();
    if (!initialized || !user || !currentOrg) return;

    try {
      const dbData = mapToDb(data as Record<string, unknown>);
      const { error } = await supabase
        .from('organizations')
        .update({ ...dbData, updated_at: new Date().toISOString() })
        .eq('id', currentOrg.id);

      if (error) {
        console.warn('[OrgStore] Error updating org:', error.message);
        return;
      }

      setCurrentOrg(prev => prev ? { ...prev, ...data } : null);
    } catch (err) {
      console.warn('[OrgStore] Unexpected error updating org:', err);
    }
  }, [currentOrg]);

  // Refresh members list (defined before inviteMember to avoid stale closure)
  const refreshMembers = useCallback(async () => {
    if (!currentOrg) return;
    try {
      const { data, error } = await supabase
        .from('org_members')
        .select('*')
        .eq('org_id', currentOrg.id)
        .eq('is_active', true);
      if (error) { console.warn('[OrgStore] Error refreshing members:', error.message); return; }
      if (data) setOrgMembers(data.map(r => mapRow<OrgMember>(r)));
    } catch (err) { console.warn('[OrgStore] Unexpected error refreshing members:', err); }
  }, [currentOrg]);

  const refreshInvitations = useCallback(async () => {
    if (!currentOrg) return;
    const { data, error } = await supabase
      .from('org_invitations')
      .select('id, org_id, email, role, invited_by, expires_at, created_at')
      .eq('org_id', currentOrg.id)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });
    if (error) { console.warn('[OrgStore] Error loading invitations:', error.message); return; }
    setInvitations((data ?? []).map(r => mapRow<OrgInvitation>(r)));
  }, [currentOrg]);

  // Returns the one-time token; only its hash is stored, so this is the only chance to share the link.
  const inviteMember = useCallback(async (email: string, role: string, modules: string[] | null = null) => {
    if (!currentOrg) return { ok: false as const, code: 'ACCESS_DENIED', details: {} };
    const { data, error } = await supabase.rpc('org_invite', { p_org: currentOrg.id, p_email: email, p_role: role, p_modules: modules });
    if (error || typeof data !== 'string') return { ok: false as const, ...parseRpcError(error) };
    await refreshInvitations();
    return { ok: true as const, token: data };
  }, [currentOrg, refreshInvitations]);

  const revokeInvitation = useCallback(async (invitationId: string) => {
    const { error } = await supabase.rpc('org_revoke_invitation', { p_invitation: invitationId });
    if (error) { console.warn('[OrgStore] Error revoking invitation:', error.message); return false; }
    setInvitations(prev => prev.filter(i => i.id !== invitationId));
    return true;
  }, []);

  const acceptInvitation = useCallback(async (token: string) => {
    const { data, error } = await supabase.rpc('org_accept_invitation', { p_token: token });
    if (error || typeof data !== 'string') return { ok: false as const, ...parseRpcError(error) };
    return { ok: true as const, orgId: data };
  }, []);

  // Update a member's role
  const updateMemberRole = useCallback(async (memberId: string, role: string) => {
    const { user, initialized } = getAuthState();
    if (!initialized || !user || !currentOrg) return false;

    try {
      // RLS rejects out-of-rank changes either with an error or by matching no rows.
      const { data, error } = await supabase
        .from('org_members')
        .update({ role })
        .eq('id', memberId)
        .select('id');

      if (error || !data?.length) {
        if (error) console.warn('[OrgStore] Error updating member role:', error.message);
        return false;
      }

      setOrgMembers(prev =>
        prev.map(m => m.id === memberId ? { ...m, role: role as OrgMember['role'] } : m)
      );
      return true;
    } catch (err) {
      console.warn('[OrgStore] Unexpected error updating member role:', err);
      return false;
    }
  }, [currentOrg]);

  // Soft-delete a member (set is_active = false)
  const removeMember = useCallback(async (memberId: string) => {
    const { user, initialized } = getAuthState();
    if (!initialized || !user || !currentOrg) return false;

    try {
      const { data, error } = await supabase
        .from('org_members')
        .update({ is_active: false })
        .eq('id', memberId)
        .select('id');

      if (error || !data?.length) {
        if (error) console.warn('[OrgStore] Error removing member:', error.message);
        return false;
      }

      setOrgMembers(prev => prev.filter(m => m.id !== memberId));
      return true;
    } catch (err) {
      console.warn('[OrgStore] Unexpected error removing member:', err);
      return false;
    }
  }, [currentOrg]);

  const value: OrgContextType = {
    currentOrg,
    organizations,
    switchOrg,
    orgMembers,
    orgRoles,
    userRole,
    userPermissions,
    isLoading,
    createOrg,
    updateOrg,
    invitations,
    inviteMember,
    revokeInvitation,
    refreshInvitations,
    acceptInvitation,
    updateMemberRole,
    removeMember,
    refreshMembers,
  };

  return (
    <OrgContext.Provider value={value}>
      {children}
    </OrgContext.Provider>
  );
}

/* ===== HOOKS ===== */

export function useOrg(): OrgContextType {
  const context = useContext(OrgContext);
  if (!context) {
    throw new Error('useOrg must be used within an OrgProvider');
  }
  return context;
}

export function useOrgPermission(key: keyof CrmPermissions): boolean {
  const { userPermissions } = useOrg();
  return userPermissions[key] === true;
}
