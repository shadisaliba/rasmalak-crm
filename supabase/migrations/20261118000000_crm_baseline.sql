-- ============================================================
-- RASMALAK CRM — BASELINE
-- Recreates the CRM schema on an empty project. Built from the pre-split
-- migrations 012 and 014–023 (archived in docs/archive/migrations-pre-split/).
-- Consumer tables (001–010) and the consumer transactions bridge (013) are
-- intentionally absent. Changes from the archived files:
--   * billing `invoices` renamed to `billing_invoices` (the SME receivables
--     entity will own the word "invoice")
--   * find_stale_deals() and crm_increment_workflow_run() added
--   * pgcrypto and btree_gist enabled for later SME migrations
-- ============================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;


-- ------------------------------------------------------------
-- from 012_crm_foundation.sql
-- ------------------------------------------------------------

-- ============================================================
-- RASMALAK CRM FOUNDATION
-- Migration 012: Organizations, CRM entities, RLS, triggers
-- ============================================================

-- ============================================================
-- ENABLE pg_trgm EXTENSION (required for trigram search indexes)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- ORGANIZATIONS
-- ============================================================

CREATE TABLE organizations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  name_ar         TEXT,
  industry        TEXT,
  industry_ar     TEXT,
  country         TEXT,
  currency        TEXT DEFAULT 'SAR',
  logo_url        TEXT,
  settings        JSONB DEFAULT '{}',
  created_by      UUID NOT NULL REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE org_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'viewer',
  permissions     JSONB DEFAULT '{}',
  display_name    TEXT,
  display_name_ar TEXT,
  invited_by      UUID REFERENCES auth.users(id),
  invited_at      TIMESTAMPTZ,
  joined_at       TIMESTAMPTZ DEFAULT now(),
  is_active       BOOLEAN DEFAULT TRUE,
  UNIQUE(org_id, user_id)
);

CREATE TABLE org_roles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  name_ar         TEXT,
  permissions     JSONB NOT NULL,
  is_system       BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, name)
);

-- ============================================================
-- CRM CONTACTS & COMPANIES
-- ============================================================

CREATE TABLE crm_companies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  name_ar         TEXT,
  industry        TEXT,
  industry_ar     TEXT,
  website         TEXT,
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  address_ar      TEXT,
  city            TEXT,
  city_ar         TEXT,
  country         TEXT,
  parent_id       UUID REFERENCES crm_companies(id) ON DELETE SET NULL,
  tags            TEXT[] DEFAULT '{}',
  custom_fields   JSONB DEFAULT '{}',
  notes           TEXT,
  search_name_normalized    TEXT,
  search_name_root          TEXT,
  search_name_translit      TEXT,
  created_by      UUID NOT NULL REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE crm_contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  company_id      UUID REFERENCES crm_companies(id) ON DELETE SET NULL,
  first_name      TEXT NOT NULL,
  last_name       TEXT,
  first_name_ar   TEXT,
  last_name_ar    TEXT,
  email           TEXT,
  phone           TEXT,
  phone_secondary TEXT,
  whatsapp_number TEXT,
  job_title       TEXT,
  job_title_ar    TEXT,
  department      TEXT,
  tags            TEXT[] DEFAULT '{}',
  source          TEXT DEFAULT 'manual',
  custom_fields   JSONB DEFAULT '{}',
  notes           TEXT,
  last_contacted  TIMESTAMPTZ,
  search_name_normalized    TEXT,
  search_name_root          TEXT,
  search_name_translit      TEXT,
  search_full_text          TEXT,
  created_by      UUID NOT NULL REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- DEAL PIPELINE
-- ============================================================

CREATE TABLE crm_pipelines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  name_ar         TEXT,
  is_default      BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, name)
);

CREATE TABLE crm_deal_stages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id     UUID NOT NULL REFERENCES crm_pipelines(id) ON DELETE CASCADE,
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  name_ar         TEXT,
  position        INTEGER NOT NULL,
  color           TEXT DEFAULT '#2D6A4F',
  probability     INTEGER DEFAULT 0,
  is_won          BOOLEAN DEFAULT FALSE,
  is_lost         BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE crm_deals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pipeline_id     UUID NOT NULL REFERENCES crm_pipelines(id),
  stage_id        UUID NOT NULL REFERENCES crm_deal_stages(id),
  contact_id      UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  company_id      UUID REFERENCES crm_companies(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  title_ar        TEXT,
  value           NUMERIC,
  currency        TEXT DEFAULT 'SAR',
  probability     INTEGER DEFAULT 0 CHECK (probability >= 0 AND probability <= 100),
  expected_close  DATE,
  actual_close    DATE,
  won_lost_reason TEXT,
  won_lost_reason_ar TEXT,
  assigned_to     UUID REFERENCES auth.users(id),
  source          TEXT,
  custom_fields   JSONB DEFAULT '{}',
  notes           TEXT,
  created_by      UUID NOT NULL REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  closed_at       TIMESTAMPTZ
);

CREATE TABLE crm_deal_stage_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id         UUID NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
  from_stage_id   UUID REFERENCES crm_deal_stages(id),
  to_stage_id     UUID NOT NULL REFERENCES crm_deal_stages(id),
  moved_by        UUID NOT NULL REFERENCES auth.users(id),
  duration_in_stage_hours INTEGER,
  moved_at        TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- TASKS
-- ============================================================

CREATE TABLE crm_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deal_id         UUID REFERENCES crm_deals(id) ON DELETE CASCADE,
  contact_id      UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  company_id      UUID REFERENCES crm_companies(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  title_ar        TEXT,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  priority        TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  type            TEXT DEFAULT 'task' CHECK (type IN ('task', 'call', 'email', 'meeting', 'follow_up')),
  due_date        TIMESTAMPTZ,
  reminder_at     TIMESTAMPTZ,
  assigned_to     UUID REFERENCES auth.users(id),
  is_recurring    BOOLEAN DEFAULT FALSE,
  recurrence_rule TEXT,
  completed_at    TIMESTAMPTZ,
  created_by      UUID NOT NULL REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- COMMUNICATIONS
-- ============================================================

CREATE TABLE crm_communications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  deal_id         UUID REFERENCES crm_deals(id) ON DELETE SET NULL,
  company_id      UUID REFERENCES crm_companies(id) ON DELETE SET NULL,
  type            TEXT NOT NULL CHECK (type IN ('call', 'email', 'meeting', 'note', 'whatsapp', 'sms', 'site_visit', 'other')),
  direction       TEXT CHECK (direction IN ('inbound', 'outbound')),
  subject         TEXT,
  subject_ar      TEXT,
  body            TEXT,
  occurred_at     TIMESTAMPTZ DEFAULT now(),
  duration_mins   INTEGER,
  outcome         TEXT,
  outcome_ar      TEXT,
  whatsapp_message_count  INTEGER,
  whatsapp_date_range     TSTZRANGE,
  whatsapp_raw            TEXT,
  whatsapp_parsed         JSONB,
  attachments     JSONB DEFAULT '[]',
  logged_by       UUID NOT NULL REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- CUSTOM FIELDS DEFINITION
-- ============================================================

CREATE TABLE crm_custom_field_defs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('contact', 'company', 'deal')),
  field_key       TEXT NOT NULL,
  label           TEXT NOT NULL,
  label_ar        TEXT,
  field_type      TEXT NOT NULL CHECK (field_type IN ('text', 'number', 'date', 'dropdown', 'multi_select', 'checkbox', 'currency', 'phone', 'email', 'url')),
  options         JSONB,
  is_required     BOOLEAN DEFAULT FALSE,
  position        INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, entity_type, field_key)
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

CREATE TABLE crm_notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  type            TEXT NOT NULL,
  title           TEXT NOT NULL,
  title_ar        TEXT,
  body            TEXT,
  body_ar         TEXT,
  entity_type     TEXT,
  entity_id       UUID,
  is_read         BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- AUDIT TRAIL
-- ============================================================

CREATE TABLE crm_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  action          TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       UUID,
  changes         JSONB,
  metadata        JSONB DEFAULT '{}',
  ip_address      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- MIGRATION TRACKING
-- ============================================================

CREATE TABLE crm_imports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source          TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'partial')),
  total_rows      INTEGER,
  imported_rows   INTEGER DEFAULT 0,
  skipped_rows    INTEGER DEFAULT 0,
  error_rows      INTEGER DEFAULT 0,
  field_mapping   JSONB,
  errors          JSONB DEFAULT '[]',
  file_name       TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_by      UUID NOT NULL REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Core lookups
CREATE INDEX idx_org_members_user ON org_members(user_id);
CREATE INDEX idx_org_members_org ON org_members(org_id);
CREATE INDEX idx_crm_contacts_org ON crm_contacts(org_id);
CREATE INDEX idx_crm_contacts_company ON crm_contacts(company_id);
CREATE INDEX idx_crm_companies_org ON crm_companies(org_id);
CREATE INDEX idx_crm_companies_parent ON crm_companies(parent_id);
CREATE INDEX idx_crm_deals_org ON crm_deals(org_id);
CREATE INDEX idx_crm_deals_pipeline ON crm_deals(pipeline_id);
CREATE INDEX idx_crm_deals_stage ON crm_deals(stage_id);
CREATE INDEX idx_crm_deals_contact ON crm_deals(contact_id);
CREATE INDEX idx_crm_deals_company ON crm_deals(company_id);
CREATE INDEX idx_crm_deals_assigned ON crm_deals(assigned_to);
CREATE INDEX idx_crm_tasks_org ON crm_tasks(org_id);
CREATE INDEX idx_crm_tasks_assigned ON crm_tasks(assigned_to);
CREATE INDEX idx_crm_tasks_due ON crm_tasks(due_date) WHERE status NOT IN ('completed', 'cancelled');
CREATE INDEX idx_crm_tasks_deal ON crm_tasks(deal_id);
CREATE INDEX idx_crm_comms_contact ON crm_communications(contact_id);
CREATE INDEX idx_crm_comms_deal ON crm_communications(deal_id);
CREATE INDEX idx_crm_comms_org ON crm_communications(org_id);
CREATE INDEX idx_crm_notifications_user ON crm_notifications(user_id, is_read);
CREATE INDEX idx_crm_audit_org ON crm_audit_log(org_id, created_at DESC);
CREATE INDEX idx_crm_audit_entity ON crm_audit_log(entity_type, entity_id);

-- Arabic search indexes (GIN trigram)
CREATE INDEX idx_crm_contacts_search_norm ON crm_contacts USING gin(search_name_normalized gin_trgm_ops);
CREATE INDEX idx_crm_contacts_search_root ON crm_contacts USING gin(search_name_root gin_trgm_ops);
CREATE INDEX idx_crm_contacts_search_trans ON crm_contacts USING gin(search_name_translit gin_trgm_ops);
CREATE INDEX idx_crm_contacts_search_full ON crm_contacts USING gin(search_full_text gin_trgm_ops);
CREATE INDEX idx_crm_companies_search_norm ON crm_companies USING gin(search_name_normalized gin_trgm_ops);
CREATE INDEX idx_crm_companies_search_trans ON crm_companies USING gin(search_name_translit gin_trgm_ops);

-- Pipeline performance
CREATE INDEX idx_crm_deals_value ON crm_deals(org_id, value) WHERE closed_at IS NULL;
CREATE INDEX idx_crm_stage_history_deal ON crm_deal_stage_history(deal_id, moved_at DESC);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- Helper functions
CREATE OR REPLACE FUNCTION is_org_member(check_org_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_members
    WHERE org_id = check_org_id AND user_id = auth.uid() AND is_active = TRUE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_org_role(check_org_id UUID)
RETURNS TEXT AS $$
  SELECT role FROM org_members
  WHERE org_id = check_org_id AND user_id = auth.uid() AND is_active = TRUE
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_user_org_ids()
RETURNS SETOF UUID AS $$
  SELECT org_id FROM org_members
  WHERE user_id = auth.uid() AND is_active = TRUE;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Enable RLS on all tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_deal_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_deal_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_communications ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_custom_field_defs ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_imports ENABLE ROW LEVEL SECURITY;

-- Organizations
CREATE POLICY "org_select" ON organizations FOR SELECT USING (is_org_member(id));
CREATE POLICY "org_insert" ON organizations FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "org_update" ON organizations FOR UPDATE USING (get_org_role(id) IN ('owner', 'admin'));
CREATE POLICY "org_delete" ON organizations FOR DELETE USING (get_org_role(id) = 'owner');

-- Org members
CREATE POLICY "members_select" ON org_members FOR SELECT USING (is_org_member(org_id));
CREATE POLICY "members_insert" ON org_members FOR INSERT WITH CHECK (
  get_org_role(org_id) IN ('owner', 'admin', 'manager') OR auth.uid() = user_id
);
CREATE POLICY "members_update" ON org_members FOR UPDATE USING (get_org_role(org_id) IN ('owner', 'admin'));
CREATE POLICY "members_delete" ON org_members FOR DELETE USING (get_org_role(org_id) IN ('owner', 'admin'));

-- Org roles
CREATE POLICY "roles_select" ON org_roles FOR SELECT USING (is_org_member(org_id));
CREATE POLICY "roles_manage" ON org_roles FOR ALL USING (get_org_role(org_id) IN ('owner', 'admin'));

-- Contacts
CREATE POLICY "crm_contacts_select" ON crm_contacts FOR SELECT USING (is_org_member(org_id));
CREATE POLICY "crm_contacts_insert" ON crm_contacts FOR INSERT WITH CHECK (is_org_member(org_id));
CREATE POLICY "crm_contacts_update" ON crm_contacts FOR UPDATE USING (is_org_member(org_id));
CREATE POLICY "crm_contacts_delete" ON crm_contacts FOR DELETE USING (get_org_role(org_id) IN ('owner', 'admin', 'manager'));

-- Companies
CREATE POLICY "crm_companies_select" ON crm_companies FOR SELECT USING (is_org_member(org_id));
CREATE POLICY "crm_companies_insert" ON crm_companies FOR INSERT WITH CHECK (is_org_member(org_id));
CREATE POLICY "crm_companies_update" ON crm_companies FOR UPDATE USING (is_org_member(org_id));
CREATE POLICY "crm_companies_delete" ON crm_companies FOR DELETE USING (get_org_role(org_id) IN ('owner', 'admin', 'manager'));

-- Pipelines
CREATE POLICY "crm_pipelines_select" ON crm_pipelines FOR SELECT USING (is_org_member(org_id));
CREATE POLICY "crm_pipelines_insert" ON crm_pipelines FOR INSERT WITH CHECK (get_org_role(org_id) IN ('owner', 'admin', 'manager'));
CREATE POLICY "crm_pipelines_update" ON crm_pipelines FOR UPDATE USING (get_org_role(org_id) IN ('owner', 'admin', 'manager'));
CREATE POLICY "crm_pipelines_delete" ON crm_pipelines FOR DELETE USING (get_org_role(org_id) IN ('owner', 'admin'));

-- Deal stages
CREATE POLICY "crm_stages_select" ON crm_deal_stages FOR SELECT USING (is_org_member(org_id));
CREATE POLICY "crm_stages_manage" ON crm_deal_stages FOR ALL USING (get_org_role(org_id) IN ('owner', 'admin', 'manager'));

-- Deals
CREATE POLICY "crm_deals_select" ON crm_deals FOR SELECT USING (is_org_member(org_id));
CREATE POLICY "crm_deals_insert" ON crm_deals FOR INSERT WITH CHECK (is_org_member(org_id));
CREATE POLICY "crm_deals_update" ON crm_deals FOR UPDATE USING (is_org_member(org_id));
CREATE POLICY "crm_deals_delete" ON crm_deals FOR DELETE USING (get_org_role(org_id) IN ('owner', 'admin', 'manager'));

-- Deal stage history
CREATE POLICY "crm_history_select" ON crm_deal_stage_history FOR SELECT USING (
  EXISTS (SELECT 1 FROM crm_deals d WHERE d.id = deal_id AND is_org_member(d.org_id))
);
CREATE POLICY "crm_history_insert" ON crm_deal_stage_history FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM crm_deals d WHERE d.id = deal_id AND is_org_member(d.org_id))
);

-- Tasks
CREATE POLICY "crm_tasks_select" ON crm_tasks FOR SELECT USING (is_org_member(org_id));
CREATE POLICY "crm_tasks_insert" ON crm_tasks FOR INSERT WITH CHECK (is_org_member(org_id));
CREATE POLICY "crm_tasks_update" ON crm_tasks FOR UPDATE USING (is_org_member(org_id));
CREATE POLICY "crm_tasks_delete" ON crm_tasks FOR DELETE USING (get_org_role(org_id) IN ('owner', 'admin', 'manager'));

-- Communications
CREATE POLICY "crm_comms_select" ON crm_communications FOR SELECT USING (is_org_member(org_id));
CREATE POLICY "crm_comms_insert" ON crm_communications FOR INSERT WITH CHECK (is_org_member(org_id));
CREATE POLICY "crm_comms_update" ON crm_communications FOR UPDATE USING (is_org_member(org_id) AND auth.uid() = logged_by);
CREATE POLICY "crm_comms_delete" ON crm_communications FOR DELETE USING (get_org_role(org_id) IN ('owner', 'admin', 'manager'));

-- Custom field definitions
CREATE POLICY "crm_fields_select" ON crm_custom_field_defs FOR SELECT USING (is_org_member(org_id));
CREATE POLICY "crm_fields_manage" ON crm_custom_field_defs FOR ALL USING (get_org_role(org_id) IN ('owner', 'admin'));

-- Notifications
CREATE POLICY "crm_notif_select" ON crm_notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "crm_notif_update" ON crm_notifications FOR UPDATE USING (auth.uid() = user_id);

-- Audit log
CREATE POLICY "crm_audit_select" ON crm_audit_log FOR SELECT USING (get_org_role(org_id) IN ('owner', 'admin'));
CREATE POLICY "crm_audit_insert" ON crm_audit_log FOR INSERT WITH CHECK (is_org_member(org_id));

-- Imports
CREATE POLICY "crm_imports_select" ON crm_imports FOR SELECT USING (is_org_member(org_id));
CREATE POLICY "crm_imports_insert" ON crm_imports FOR INSERT WITH CHECK (is_org_member(org_id));
CREATE POLICY "crm_imports_update" ON crm_imports FOR UPDATE USING (is_org_member(org_id));

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-add org creator as owner
CREATE OR REPLACE FUNCTION add_org_creator_as_owner()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO org_members (org_id, user_id, role)
  VALUES (NEW.id, NEW.created_by, 'owner');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_org_created_add_owner
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION add_org_creator_as_owner();

-- Create default pipeline + stages for new org
CREATE OR REPLACE FUNCTION create_default_pipeline()
RETURNS TRIGGER AS $$
DECLARE
  pipeline_id UUID;
BEGIN
  INSERT INTO crm_pipelines (org_id, name, name_ar, is_default)
  VALUES (NEW.id, 'Sales Pipeline', 'مسار المبيعات', TRUE)
  RETURNING id INTO pipeline_id;

  INSERT INTO crm_deal_stages (pipeline_id, org_id, name, name_ar, position, color, probability, is_won, is_lost) VALUES
    (pipeline_id, NEW.id, 'Lead',          'عميل محتمل',     1, '#9CA3AF', 10, FALSE, FALSE),
    (pipeline_id, NEW.id, 'Qualified',     'مؤهل',           2, '#3B82F6', 25, FALSE, FALSE),
    (pipeline_id, NEW.id, 'Proposal',      'عرض سعر',        3, '#F59E0B', 50, FALSE, FALSE),
    (pipeline_id, NEW.id, 'Negotiation',   'تفاوض',          4, '#8B5CF6', 75, FALSE, FALSE),
    (pipeline_id, NEW.id, 'Won',           'تم الفوز',        5, '#22C55E', 100, TRUE,  FALSE),
    (pipeline_id, NEW.id, 'Lost',          'خسارة',           6, '#EF4444', 0,   FALSE, TRUE);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_org_created_pipeline
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION create_default_pipeline();

-- Create default system roles for new org
CREATE OR REPLACE FUNCTION create_default_roles()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO org_roles (org_id, name, name_ar, permissions, is_system) VALUES
    (NEW.id, 'owner', 'مالك', '{"contacts.read":true,"contacts.write":true,"contacts.delete":true,"companies.read":true,"companies.write":true,"companies.delete":true,"deals.read":true,"deals.write":true,"deals.delete":true,"tasks.read":true,"tasks.write":true,"tasks.delete":true,"pipeline.configure":true,"team.manage":true,"team.invite":true,"reports.view":true,"reports.export":true,"settings.manage":true,"import.execute":true,"audit.view":true,"fields.manage":true}', TRUE),
    (NEW.id, 'admin', 'مدير', '{"contacts.read":true,"contacts.write":true,"contacts.delete":true,"companies.read":true,"companies.write":true,"companies.delete":true,"deals.read":true,"deals.write":true,"deals.delete":true,"tasks.read":true,"tasks.write":true,"tasks.delete":true,"pipeline.configure":true,"team.manage":true,"team.invite":true,"reports.view":true,"reports.export":true,"settings.manage":true,"import.execute":true,"audit.view":true,"fields.manage":true}', TRUE),
    (NEW.id, 'manager', 'مدير مبيعات', '{"contacts.read":true,"contacts.write":true,"contacts.delete":true,"companies.read":true,"companies.write":true,"companies.delete":true,"deals.read":true,"deals.write":true,"deals.delete":true,"tasks.read":true,"tasks.write":true,"tasks.delete":true,"pipeline.configure":false,"team.manage":false,"team.invite":true,"reports.view":true,"reports.export":true,"settings.manage":false,"import.execute":true,"audit.view":false,"fields.manage":false}', TRUE),
    (NEW.id, 'sales_rep', 'مندوب مبيعات', '{"contacts.read":true,"contacts.write":true,"contacts.delete":false,"companies.read":true,"companies.write":true,"companies.delete":false,"deals.read":true,"deals.write":true,"deals.delete":false,"tasks.read":true,"tasks.write":true,"tasks.delete":false,"pipeline.configure":false,"team.manage":false,"team.invite":false,"reports.view":true,"reports.export":false,"settings.manage":false,"import.execute":false,"audit.view":false,"fields.manage":false}', TRUE),
    (NEW.id, 'viewer', 'مشاهد', '{"contacts.read":true,"contacts.write":false,"contacts.delete":false,"companies.read":true,"companies.write":false,"companies.delete":false,"deals.read":true,"deals.write":false,"deals.delete":false,"tasks.read":true,"tasks.write":false,"tasks.delete":false,"pipeline.configure":false,"team.manage":false,"team.invite":false,"reports.view":true,"reports.export":false,"settings.manage":false,"import.execute":false,"audit.view":false,"fields.manage":false}', TRUE);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_org_created_roles
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION create_default_roles();

-- Arabic name normalization trigger for contacts
CREATE OR REPLACE FUNCTION normalize_contact_search_fields()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_name_normalized := regexp_replace(
    translate(
      COALESCE(NEW.first_name_ar, '') || ' ' || COALESCE(NEW.last_name_ar, '') || ' ' ||
      COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, ''),
      'إأآٱ', 'اااا'
    ),
    '[\u064B-\u065F\u0670]', '', 'g'
  );

  NEW.search_full_text := lower(
    COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, '') || ' ' ||
    COALESCE(NEW.first_name_ar, '') || ' ' || COALESCE(NEW.last_name_ar, '') || ' ' ||
    COALESCE(NEW.email, '') || ' ' || COALESCE(NEW.phone, '') || ' ' ||
    COALESCE(NEW.job_title, '') || ' ' || COALESCE(NEW.job_title_ar, '')
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contact_search_normalize
  BEFORE INSERT OR UPDATE ON crm_contacts
  FOR EACH ROW EXECUTE FUNCTION normalize_contact_search_fields();

-- Same for companies
CREATE OR REPLACE FUNCTION normalize_company_search_fields()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_name_normalized := regexp_replace(
    translate(
      COALESCE(NEW.name_ar, '') || ' ' || COALESCE(NEW.name, ''),
      'إأآٱ', 'اااا'
    ),
    '[\u064B-\u065F\u0670]', '', 'g'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER company_search_normalize
  BEFORE INSERT OR UPDATE ON crm_companies
  FOR EACH ROW EXECUTE FUNCTION normalize_company_search_fields();

-- Auto-update last_contacted on contacts when communication is logged
CREATE OR REPLACE FUNCTION update_contact_last_contacted()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE crm_contacts SET last_contacted = NEW.occurred_at, updated_at = now()
  WHERE id = NEW.contact_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_communication_logged
  AFTER INSERT ON crm_communications
  FOR EACH ROW EXECUTE FUNCTION update_contact_last_contacted();

-- Auto-log deal stage changes
CREATE OR REPLACE FUNCTION log_deal_stage_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.stage_id IS DISTINCT FROM NEW.stage_id THEN
    INSERT INTO crm_deal_stage_history (deal_id, from_stage_id, to_stage_id, moved_by, duration_in_stage_hours)
    VALUES (
      NEW.id,
      OLD.stage_id,
      NEW.stage_id,
      auth.uid(),
      EXTRACT(EPOCH FROM (now() - OLD.updated_at)) / 3600
    );
    IF EXISTS (SELECT 1 FROM crm_deal_stages WHERE id = NEW.stage_id AND (is_won OR is_lost)) THEN
      NEW.closed_at := now();
      NEW.actual_close := CURRENT_DATE;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_deal_stage_change
  BEFORE UPDATE ON crm_deals
  FOR EACH ROW EXECUTE FUNCTION log_deal_stage_change();

-- ------------------------------------------------------------
-- from 014_billing.sql
-- ------------------------------------------------------------

-- ============================================================
-- RASMALAK CRM V2 — BILLING
-- Migration 014: Subscriptions, billing invoices, payment methods
-- ============================================================

CREATE TABLE subscriptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan                  TEXT NOT NULL CHECK (plan IN ('entrepreneur','organization','enterprise','custom')),
  status                TEXT NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing','active','past_due','canceled','paused')),
  billing_cycle         TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly','annual')),
  billing_currency      TEXT NOT NULL DEFAULT 'USD',
  seats_included        INTEGER NOT NULL,
  seats_purchased       INTEGER NOT NULL DEFAULT 0,
  seats_max             INTEGER NOT NULL,
  stripe_customer_id    TEXT,
  stripe_subscription_id TEXT,
  regional_provider     TEXT,
  regional_ref          TEXT,
  current_period_start  TIMESTAMPTZ,
  current_period_end    TIMESTAMPTZ,
  trial_ends_at         TIMESTAMPTZ,
  grace_period_ends_at  TIMESTAMPTZ,
  canceled_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id)
);

CREATE TABLE billing_invoices (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_id       UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  stripe_invoice_id     TEXT,
  amount                NUMERIC NOT NULL,
  currency              TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','paid','void','uncollectible')),
  period_start          TIMESTAMPTZ,
  period_end            TIMESTAMPTZ,
  pdf_url               TEXT,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE payment_methods (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider              TEXT NOT NULL DEFAULT 'stripe',
  type                  TEXT NOT NULL,
  last_four             TEXT,
  brand                 TEXT,
  is_default            BOOLEAN DEFAULT FALSE,
  provider_ref          TEXT,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_subscriptions_org ON subscriptions(org_id);
CREATE INDEX idx_billing_invoices_org ON billing_invoices(org_id);
CREATE INDEX idx_payment_methods_org ON payment_methods(org_id);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view subscription"
  ON subscriptions FOR SELECT USING (is_org_member(org_id));
CREATE POLICY "Org owner/admin can manage subscription"
  ON subscriptions FOR ALL USING (get_org_role(org_id) IN ('owner','admin'));

CREATE POLICY "Org members can view billing invoices"
  ON billing_invoices FOR SELECT USING (is_org_member(org_id));

CREATE POLICY "Org members can view payment methods"
  ON payment_methods FOR SELECT USING (is_org_member(org_id));
CREATE POLICY "Org owner/admin can manage payment methods"
  ON payment_methods FOR ALL USING (get_org_role(org_id) IN ('owner','admin'));

-- ------------------------------------------------------------
-- from 015_integrations.sql
-- ------------------------------------------------------------

-- ============================================================
-- RASMALAK CRM V2 — INTEGRATIONS
-- Migration 015: Service connections, sync map, health events
-- ============================================================

CREATE TABLE service_connections (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider              TEXT NOT NULL,
  service_type          TEXT NOT NULL,
  access_token          TEXT NOT NULL,
  refresh_token         TEXT,
  token_expires_at      TIMESTAMPTZ,
  connected_email       TEXT,
  external_account_id   TEXT,
  webhook_id            TEXT,
  webhook_expires       TIMESTAMPTZ,
  scopes                TEXT[],
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disconnected','error','token_expired')),
  error_message         TEXT,
  last_sync_at          TIMESTAMPTZ,
  sync_stats            JSONB DEFAULT '{}',
  privacy_confirmed     BOOLEAN DEFAULT FALSE,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, provider, service_type)
);

CREATE TABLE event_sync_map (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id         UUID NOT NULL REFERENCES service_connections(id) ON DELETE CASCADE,
  external_event_id     TEXT NOT NULL,
  entity_type           TEXT NOT NULL,
  entity_id             UUID NOT NULL,
  sync_direction        TEXT DEFAULT 'bidirectional',
  last_synced_at        TIMESTAMPTZ DEFAULT now(),
  sync_hash             TEXT,
  UNIQUE(connection_id, external_event_id)
);

CREATE TABLE health_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id         UUID REFERENCES service_connections(id) ON DELETE SET NULL,
  event_type            TEXT NOT NULL,
  severity              TEXT NOT NULL CHECK (severity IN ('info','warning','error','critical')),
  message               TEXT NOT NULL,
  details               JSONB,
  resolved_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_connections_user ON service_connections(user_id);
CREATE INDEX idx_connections_org ON service_connections(org_id);
CREATE INDEX idx_sync_map_connection ON event_sync_map(connection_id);
CREATE INDEX idx_health_org ON health_events(org_id, created_at DESC);

ALTER TABLE service_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_sync_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_events ENABLE ROW LEVEL SECURITY;

-- User-level: each person manages their own connections
CREATE POLICY "Users manage own connections"
  ON service_connections FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own sync maps"
  ON event_sync_map FOR ALL
  USING (connection_id IN (SELECT id FROM service_connections WHERE user_id = auth.uid()));

CREATE POLICY "Org members view health events"
  ON health_events FOR SELECT USING (is_org_member(org_id));
CREATE POLICY "System can insert health events"
  ON health_events FOR INSERT WITH CHECK (is_org_member(org_id));

-- ------------------------------------------------------------
-- from 016_slack_configs.sql
-- ------------------------------------------------------------

-- ============================================================
-- RASMALAK CRM V2 — SLACK CONFIGS
-- Migration 016: Slack channel notification configuration
-- ============================================================

CREATE TABLE slack_channel_configs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id         UUID NOT NULL REFERENCES service_connections(id) ON DELETE CASCADE,
  channel_id            TEXT NOT NULL,
  channel_name          TEXT,
  event_types           TEXT[] DEFAULT '{}',
  is_active             BOOLEAN DEFAULT TRUE,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_slack_configs_org ON slack_channel_configs(org_id);

ALTER TABLE slack_channel_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members manage slack configs"
  ON slack_channel_configs FOR ALL USING (is_org_member(org_id));

-- ------------------------------------------------------------
-- from 017_automation.sql
-- ------------------------------------------------------------

-- ============================================================
-- RASMALAK CRM V2 — AUTOMATION
-- Migration 017: Workflows, workflow logs, workflow templates
-- ============================================================

CREATE TABLE crm_workflows (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  name_ar               TEXT,
  description           TEXT,
  description_ar        TEXT,
  trigger_type          TEXT NOT NULL,
  trigger_config        JSONB NOT NULL DEFAULT '{}',
  conditions            JSONB DEFAULT '[]',
  actions               JSONB NOT NULL DEFAULT '[]',
  is_active             BOOLEAN DEFAULT TRUE,
  run_count             INTEGER DEFAULT 0,
  last_run_at           TIMESTAMPTZ,
  installed_from        TEXT,
  created_by            UUID REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE crm_workflow_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id           UUID NOT NULL REFERENCES crm_workflows(id) ON DELETE CASCADE,
  org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  trigger_event         JSONB,
  conditions_met        BOOLEAN,
  actions_executed      JSONB,
  error                 TEXT,
  execution_ms          INTEGER,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE crm_workflow_templates (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  TEXT UNIQUE NOT NULL,
  name                  TEXT NOT NULL,
  name_ar               TEXT NOT NULL,
  description           TEXT,
  description_ar        TEXT,
  category              TEXT NOT NULL,
  region                TEXT,
  trigger_type          TEXT NOT NULL,
  trigger_config        JSONB NOT NULL DEFAULT '{}',
  conditions            JSONB DEFAULT '[]',
  actions               JSONB NOT NULL DEFAULT '[]',
  is_featured           BOOLEAN DEFAULT FALSE,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_workflows_org ON crm_workflows(org_id);
CREATE INDEX idx_workflows_active ON crm_workflows(org_id, is_active) WHERE is_active = TRUE;
CREATE INDEX idx_workflow_log_org ON crm_workflow_log(org_id, created_at DESC);
CREATE INDEX idx_workflow_log_workflow ON crm_workflow_log(workflow_id);

ALTER TABLE crm_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_workflow_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members manage workflows"
  ON crm_workflows FOR ALL USING (is_org_member(org_id));
CREATE POLICY "Org members view workflow logs"
  ON crm_workflow_log FOR SELECT USING (is_org_member(org_id));
CREATE POLICY "System inserts workflow logs"
  ON crm_workflow_log FOR INSERT WITH CHECK (is_org_member(org_id));

-- Templates are public read
ALTER TABLE crm_workflow_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read templates"
  ON crm_workflow_templates FOR SELECT USING (true);

-- ------------------------------------------------------------
-- from 018_deal_scoring.sql
-- ------------------------------------------------------------

-- ============================================================
-- RASMALAK CRM V2 — DEAL SCORING
-- Migration 018: Add AI score columns to crm_deals
-- ============================================================

ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS ai_score INTEGER;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS ai_score_trend TEXT;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS ai_score_reasoning TEXT;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS ai_scored_at TIMESTAMPTZ;

-- ------------------------------------------------------------
-- from 019_whatsapp.sql
-- ------------------------------------------------------------

-- ============================================================
-- RASMALAK CRM V2 — WHATSAPP BUSINESS
-- Migration 019: WhatsApp accounts, templates, conversations
-- ============================================================

CREATE TABLE whatsapp_accounts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  phone_number          TEXT NOT NULL,
  waba_id               TEXT NOT NULL,
  access_token          TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','active','suspended')),
  number_model          TEXT DEFAULT 'shared' CHECK (number_model IN ('shared','individual')),
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE whatsapp_templates (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id            UUID NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  language              TEXT NOT NULL,
  category              TEXT NOT NULL CHECK (category IN ('marketing','utility','authentication')),
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  header                JSONB,
  body                  TEXT NOT NULL,
  footer                TEXT,
  buttons               JSONB,
  meta_template_id      TEXT,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE whatsapp_conversations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id            UUID REFERENCES whatsapp_accounts(id),
  contact_id            UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  contact_phone         TEXT NOT NULL,
  assigned_to           UUID REFERENCES auth.users(id),
  status                TEXT DEFAULT 'active' CHECK (status IN ('active','expired')),
  window_expires        TIMESTAMPTZ,
  last_message_at       TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_wa_accounts_org ON whatsapp_accounts(org_id);
CREATE INDEX idx_wa_templates_org ON whatsapp_templates(org_id);
CREATE INDEX idx_wa_convos_org ON whatsapp_conversations(org_id);
CREATE INDEX idx_wa_convos_contact ON whatsapp_conversations(contact_id);
CREATE INDEX idx_wa_convos_phone ON whatsapp_conversations(contact_phone);

ALTER TABLE whatsapp_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members manage WA accounts"
  ON whatsapp_accounts FOR ALL USING (is_org_member(org_id));
CREATE POLICY "Org members manage WA templates"
  ON whatsapp_templates FOR ALL USING (is_org_member(org_id));
CREATE POLICY "Org members manage WA conversations"
  ON whatsapp_conversations FOR ALL USING (is_org_member(org_id));

-- ------------------------------------------------------------
-- from 020_lead_scoring.sql
-- ------------------------------------------------------------

-- ============================================================
-- RASMALAK CRM V2 — LEAD SCORING
-- Migration 020: Scoring rules, routing rules, contact score columns
-- ============================================================

CREATE TABLE crm_lead_scoring_rules (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                  TEXT,
  name_ar               TEXT,
  field                 TEXT NOT NULL,
  operator              TEXT NOT NULL,
  value                 TEXT NOT NULL,
  points                INTEGER NOT NULL,
  is_active             BOOLEAN DEFAULT TRUE,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE crm_routing_rules (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  name_ar               TEXT,
  type                  TEXT NOT NULL CHECK (type IN ('round_robin','territory','skill','manual')),
  conditions            JSONB DEFAULT '[]',
  config                JSONB NOT NULL DEFAULT '{}',
  priority              INTEGER DEFAULT 0,
  is_active             BOOLEAN DEFAULT TRUE,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS lead_score INTEGER DEFAULT 0;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS lead_score_breakdown JSONB;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS routed_at TIMESTAMPTZ;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS routed_by_rule UUID;

CREATE INDEX idx_scoring_rules_org ON crm_lead_scoring_rules(org_id);
CREATE INDEX idx_routing_rules_org ON crm_routing_rules(org_id);

ALTER TABLE crm_lead_scoring_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_routing_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members manage scoring rules"
  ON crm_lead_scoring_rules FOR ALL USING (is_org_member(org_id));
CREATE POLICY "Org members manage routing rules"
  ON crm_routing_rules FOR ALL USING (is_org_member(org_id));

-- ------------------------------------------------------------
-- from 021_api.sql
-- ------------------------------------------------------------

-- ============================================================
-- RASMALAK CRM V2 — PUBLIC API
-- Migration 021: API keys, webhook subscriptions, request log
-- ============================================================

CREATE TABLE api_keys (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  key_hash              TEXT NOT NULL,
  key_prefix            TEXT NOT NULL,
  permissions           JSONB NOT NULL DEFAULT '{}',
  rate_limit            INTEGER DEFAULT 100,
  last_used_at          TIMESTAMPTZ,
  expires_at            TIMESTAMPTZ,
  is_active             BOOLEAN DEFAULT TRUE,
  created_by            UUID REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE api_webhook_subscriptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  api_key_id            UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  url                   TEXT NOT NULL,
  event_types           TEXT[] NOT NULL,
  secret                TEXT NOT NULL,
  status                TEXT DEFAULT 'active' CHECK (status IN ('active','paused','failed')),
  failure_count         INTEGER DEFAULT 0,
  last_success          TIMESTAMPTZ,
  last_failure          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE api_request_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID,
  api_key_id            UUID,
  method                TEXT,
  path                  TEXT,
  status_code           INTEGER,
  response_ms           INTEGER,
  ip_address            TEXT,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_api_keys_org ON api_keys(org_id);
CREATE INDEX idx_api_webhooks_org ON api_webhook_subscriptions(org_id);
CREATE INDEX idx_api_log_key ON api_request_log(api_key_id, created_at DESC);
CREATE INDEX idx_api_log_time ON api_request_log(created_at DESC);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_request_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org owner/admin manage API keys"
  ON api_keys FOR ALL USING (get_org_role(org_id) IN ('owner','admin'));
CREATE POLICY "Org owner/admin manage webhooks"
  ON api_webhook_subscriptions FOR ALL USING (get_org_role(org_id) IN ('owner','admin'));
CREATE POLICY "Org members view API logs"
  ON api_request_log FOR SELECT USING (is_org_member(org_id));

-- ------------------------------------------------------------
-- from 022_documents.sql
-- ------------------------------------------------------------

-- ============================================================
-- RASMALAK CRM V2 — DOCUMENTS
-- Migration 022: Document templates, documents, versions
-- ============================================================

CREATE TABLE crm_document_templates (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  name_ar               TEXT,
  content               TEXT NOT NULL,
  content_ar            TEXT,
  merge_fields          JSONB DEFAULT '[]',
  category              TEXT DEFAULT 'proposal',
  language              TEXT DEFAULT 'ar',
  is_active             BOOLEAN DEFAULT TRUE,
  created_by            UUID REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE crm_documents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  template_id           UUID REFERENCES crm_document_templates(id) ON DELETE SET NULL,
  deal_id               UUID REFERENCES crm_deals(id) ON DELETE SET NULL,
  contact_id            UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  name                  TEXT NOT NULL,
  name_ar               TEXT,
  file_url              TEXT NOT NULL,
  file_size             INTEGER,
  language              TEXT DEFAULT 'ar',
  version               INTEGER DEFAULT 1,
  status                TEXT DEFAULT 'draft' CHECK (status IN ('draft','sent','viewed','signed','expired')),
  signed_at             TIMESTAMPTZ,
  generated_by          UUID REFERENCES auth.users(id),
  generated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE crm_document_versions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id           UUID NOT NULL REFERENCES crm_documents(id) ON DELETE CASCADE,
  version               INTEGER NOT NULL,
  file_url              TEXT NOT NULL,
  changes_summary       TEXT,
  created_by            UUID REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_doc_templates_org ON crm_document_templates(org_id);
CREATE INDEX idx_documents_org ON crm_documents(org_id);
CREATE INDEX idx_documents_deal ON crm_documents(deal_id);
CREATE INDEX idx_doc_versions_doc ON crm_document_versions(document_id);

ALTER TABLE crm_document_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_document_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members manage doc templates"
  ON crm_document_templates FOR ALL USING (is_org_member(org_id));
CREATE POLICY "Org members manage documents"
  ON crm_documents FOR ALL USING (is_org_member(org_id));
CREATE POLICY "Org members view doc versions"
  ON crm_document_versions FOR SELECT
  USING (document_id IN (SELECT id FROM crm_documents WHERE is_org_member(org_id)));
CREATE POLICY "Org members create doc versions"
  ON crm_document_versions FOR INSERT
  WITH CHECK (document_id IN (SELECT id FROM crm_documents WHERE is_org_member(org_id)));

-- ------------------------------------------------------------
-- from 023_verticals.sql
-- ------------------------------------------------------------

-- ============================================================
-- RASMALAK CRM V2 — VERTICALS
-- Migration 023: Vertical industry templates
-- ============================================================

CREATE TABLE crm_vertical_templates (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  TEXT UNIQUE NOT NULL,
  name                  TEXT NOT NULL,
  name_ar               TEXT NOT NULL,
  description           TEXT,
  description_ar        TEXT,
  industry              TEXT NOT NULL,
  region                TEXT,
  pipeline_config       JSONB NOT NULL,
  custom_fields         JSONB NOT NULL DEFAULT '{}',
  workflow_templates    JSONB DEFAULT '[]',
  ai_prompts            JSONB DEFAULT '{}',
  icon                  TEXT,
  is_published          BOOLEAN DEFAULT TRUE,
  created_at            TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE crm_vertical_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read vertical templates"
  ON crm_vertical_templates FOR SELECT USING (true);

-- ------------------------------------------------------------
-- added in the baseline
-- ------------------------------------------------------------

-- Open deals whose latest activity (a logged communication or an edit) is older than the cutoff.
-- SECURITY INVOKER so row-level security decides which organization's deals are visible.
create or replace function find_stale_deals(p_org_id uuid, p_cutoff timestamptz)
returns table (id uuid, title text, value numeric, assigned_to uuid, last_activity_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select d.id, d.title, d.value, d.assigned_to,
         greatest(d.updated_at, max(c.occurred_at)) as last_activity_at
  from crm_deals d
  join crm_deal_stages s on s.id = d.stage_id
  left join crm_communications c on c.deal_id = d.id
  where d.org_id = p_org_id
    and not s.is_won and not s.is_lost
  group by d.id
  having greatest(d.updated_at, max(c.occurred_at)) < p_cutoff
  order by last_activity_at
  limit 50;
$$;

-- A single UPDATE so concurrent workflow runs cannot lose increments (D11).
create or replace function crm_increment_workflow_run(p_workflow_id uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  update crm_workflows
     set run_count = coalesce(run_count, 0) + 1,
         last_run_at = now()
   where id = p_workflow_id;
$$;
