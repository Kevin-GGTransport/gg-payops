-- G&G PayOps PostgreSQL schema
-- Version: 0.1
-- Target: PostgreSQL 16+
-- Purpose: initial database design for common administration, transportation master data,
--          and driver payroll settlement.
--
-- This file is intended for a fresh database. It does not seed business data.

BEGIN;

CREATE SCHEMA IF NOT EXISTS common;
CREATE SCHEMA IF NOT EXISTS ops;
CREATE SCHEMA IF NOT EXISTS pay;

DO $$
BEGIN
  CREATE TYPE common.record_status AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- common.organizations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS common.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(32) NOT NULL,
  name varchar(120) NOT NULL,
  legal_name varchar(180),
  timezone varchar(64) NOT NULL DEFAULT 'America/Los_Angeles',
  currency_code char(3) NOT NULL DEFAULT 'USD',
  status common.record_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_organizations_code UNIQUE (code),
  CONSTRAINT ck_organizations_currency CHECK (currency_code ~ '^[A-Z]{3}$')
);

COMMENT ON TABLE common.organizations IS 'Organization / company records.';

-- ---------------------------------------------------------------------------
-- common.users
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS common.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  email varchar(255) NOT NULL,
  email_lower varchar(255) GENERATED ALWAYS AS (lower(email)) STORED,
  employee_no varchar(32),
  display_name varchar(80) NOT NULL,
  password_hash varchar(255) NOT NULL,
  phone varchar(32),
  locale varchar(16) NOT NULL DEFAULT 'zh-CN',
  is_active boolean NOT NULL DEFAULT true,
  mfa_enabled boolean NOT NULL DEFAULT false,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_users_email UNIQUE (email_lower)
);

CREATE INDEX IF NOT EXISTS idx_users_organization ON common.users(organization_id, is_active);

COMMENT ON TABLE common.users IS 'Back-office login users. Drivers are stored separately in ops.drivers.';

-- ---------------------------------------------------------------------------
-- common.roles and permissions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS common.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  code varchar(64) NOT NULL,
  name varchar(80) NOT NULL,
  description varchar(255),
  is_system boolean NOT NULL DEFAULT false,
  status common.record_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_roles_org_code UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS common.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module varchar(64) NOT NULL,
  resource varchar(64) NOT NULL,
  action varchar(64) NOT NULL,
  code varchar(180) NOT NULL,
  name varchar(120) NOT NULL,
  is_system boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_permissions_code UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS common.role_permissions (
  role_id uuid NOT NULL REFERENCES common.roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES common.permissions(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS common.user_roles (
  user_id uuid NOT NULL REFERENCES common.users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES common.roles(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by_user_id uuid REFERENCES common.users(id),
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_roles_organization ON common.roles(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON common.user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON common.role_permissions(permission_id);

-- ---------------------------------------------------------------------------
-- common.user_sessions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS common.user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES common.users(id) ON DELETE CASCADE,
  refresh_token_hash varchar(255) NOT NULL,
  ip_address varchar(64),
  user_agent varchar(512),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_sessions_token UNIQUE (refresh_token_hash)
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active
  ON common.user_sessions(user_id, expires_at)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- common.audit_logs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS common.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  actor_user_id uuid REFERENCES common.users(id),
  action varchar(64) NOT NULL,
  entity_type varchar(80) NOT NULL,
  entity_id uuid NOT NULL,
  before_data jsonb,
  after_data jsonb,
  changed_fields text[],
  reason varchar(500),
  ip_address varchar(64),
  user_agent varchar(512),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_entity
  ON common.audit_logs(organization_id, entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor
  ON common.audit_logs(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action
  ON common.audit_logs(organization_id, action, created_at DESC);

COMMENT ON TABLE common.audit_logs IS 'Append-only audit trail. Never update or delete these rows.';

-- ---------------------------------------------------------------------------
-- common.attachments
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS common.attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  entity_type varchar(80) NOT NULL,
  entity_id uuid NOT NULL,
  attachment_type varchar(64) NOT NULL,
  file_name varchar(255) NOT NULL,
  storage_key varchar(500) NOT NULL,
  mime_type varchar(120) NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  checksum_sha256 varchar(128),
  uploaded_by_user_id uuid REFERENCES common.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attachments_entity
  ON common.attachments(organization_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_attachments_type
  ON common.attachments(organization_id, attachment_type);

-- ---------------------------------------------------------------------------
-- common.dictionaries
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS common.dictionaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  dict_type varchar(64) NOT NULL,
  code varchar(64) NOT NULL,
  label varchar(120) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  effective_from date,
  effective_to date,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_dictionaries_org_type_code UNIQUE (organization_id, dict_type, code),
  CONSTRAINT ck_dictionary_period CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_dictionaries_lookup
  ON common.dictionaries(organization_id, dict_type, is_active, sort_order);

-- ---------------------------------------------------------------------------
-- common.number_sequences
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS common.number_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  sequence_type varchar(64) NOT NULL,
  prefix varchar(32) NOT NULL DEFAULT '',
  current_value bigint NOT NULL DEFAULT 0 CHECK (current_value >= 0),
  padding_length smallint NOT NULL DEFAULT 5 CHECK (padding_length BETWEEN 1 AND 18),
  reset_policy varchar(32) NOT NULL DEFAULT 'NEVER',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_number_sequences_org_type UNIQUE (organization_id, sequence_type),
  CONSTRAINT ck_number_reset_policy CHECK (reset_policy IN ('NEVER', 'YEARLY', 'MONTHLY', 'PERIOD'))
);

-- ---------------------------------------------------------------------------
-- common.notifications
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS common.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  recipient_user_id uuid NOT NULL REFERENCES common.users(id) ON DELETE CASCADE,
  notification_type varchar(64) NOT NULL,
  title varchar(160) NOT NULL,
  content text NOT NULL,
  entity_type varchar(80),
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient
  ON common.notifications(recipient_user_id, read_at, created_at DESC);

-- ---------------------------------------------------------------------------
-- ops enum types
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  CREATE TYPE ops.location_type AS ENUM ('BASE', 'WAREHOUSE', 'ZIP', 'CUSTOMER', 'OTHER');
  CREATE TYPE ops.pay_target AS ENUM ('FROM', 'TO', 'BOTH', 'NONE');
  CREATE TYPE ops.route_source_type AS ENUM ('MANUAL_VERIFIED', 'MAP_ESTIMATED', 'DRIVER_REPORTED', 'IMPORTED', 'OTHER');
  CREATE TYPE ops.verification_status AS ENUM ('UNVERIFIED', 'VERIFIED', 'REJECTED');
  CREATE TYPE ops.parameter_status AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- ops.state_codes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ops.state_codes (
  code char(2) PRIMARY KEY,
  name varchar(80) NOT NULL,
  country_code char(2) NOT NULL DEFAULT 'US',
  is_active boolean NOT NULL DEFAULT true
);

COMMENT ON TABLE ops.state_codes IS 'US state reference used by route state mileage splits.';

-- ---------------------------------------------------------------------------
-- ops.drivers
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ops.drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  driver_code varchar(32) NOT NULL,
  full_name varchar(120) NOT NULL,
  phone varchar(32),
  email varchar(255),
  license_no varchar(64),
  license_class varchar(32),
  license_expires_on date,
  hire_date date,
  termination_date date,
  linked_user_id uuid REFERENCES common.users(id),
  status common.record_status NOT NULL DEFAULT 'ACTIVE',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_drivers_org_code UNIQUE (organization_id, driver_code),
  CONSTRAINT ck_driver_dates CHECK (termination_date IS NULL OR hire_date IS NULL OR termination_date >= hire_date),
  CONSTRAINT uq_drivers_linked_user UNIQUE (linked_user_id)
);

CREATE INDEX IF NOT EXISTS idx_drivers_org_status ON ops.drivers(organization_id, status, full_name);

-- ---------------------------------------------------------------------------
-- ops.trucks
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ops.trucks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  truck_code varchar(32) NOT NULL,
  plate_no varchar(32),
  truck_type varchar(64),
  capacity_note varchar(120),
  status common.record_status NOT NULL DEFAULT 'ACTIVE',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_trucks_org_code UNIQUE (organization_id, truck_code)
);

CREATE INDEX IF NOT EXISTS idx_trucks_org_status ON ops.trucks(organization_id, status, truck_code);

-- ---------------------------------------------------------------------------
-- ops.driver_truck_assignments
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ops.driver_truck_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  driver_id uuid NOT NULL REFERENCES ops.drivers(id),
  truck_id uuid NOT NULL REFERENCES ops.trucks(id),
  valid_from date NOT NULL,
  valid_to date,
  is_primary boolean NOT NULL DEFAULT false,
  note varchar(255),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_driver_truck_period CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE INDEX IF NOT EXISTS idx_driver_truck_driver_period
  ON ops.driver_truck_assignments(driver_id, valid_from DESC, valid_to DESC);
CREATE INDEX IF NOT EXISTS idx_driver_truck_truck_period
  ON ops.driver_truck_assignments(truck_id, valid_from DESC, valid_to DESC);

-- ---------------------------------------------------------------------------
-- ops.locations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ops.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  code varchar(16) NOT NULL,
  name varchar(120) NOT NULL,
  location_type ops.location_type NOT NULL DEFAULT 'WAREHOUSE',
  address_line varchar(255),
  city varchar(80),
  state_code char(2) REFERENCES ops.state_codes(code),
  postal_code varchar(16),
  country_code char(2) NOT NULL DEFAULT 'US',
  latitude numeric(9,6),
  longitude numeric(9,6),
  is_base boolean NOT NULL DEFAULT false,
  standard_pay_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (standard_pay_amount >= 0),
  status common.record_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_locations_org_code UNIQUE (organization_id, code),
  CONSTRAINT ck_location_lat CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT ck_location_lng CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

CREATE INDEX IF NOT EXISTS idx_locations_org_type
  ON ops.locations(organization_id, location_type, status, code);
CREATE INDEX IF NOT EXISTS idx_locations_base
  ON ops.locations(organization_id, id)
  WHERE is_base = true;

COMMENT ON COLUMN ops.locations.code IS 'Operational code such as Base, SCK8, SMF3, or a five-digit ZIP.';

-- ---------------------------------------------------------------------------
-- ops.operation_codes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ops.operation_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  code varchar(16) NOT NULL,
  name varchar(80) NOT NULL,
  description varchar(255),
  pay_target ops.pay_target NOT NULL,
  pay_factor numeric(7,6) NOT NULL CHECK (pay_factor >= 0),
  is_bobtail_return_rule boolean NOT NULL DEFAULT false,
  status common.record_status NOT NULL DEFAULT 'ACTIVE',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_operation_codes_org_code UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_operation_codes_org_status
  ON ops.operation_codes(organization_id, status, sort_order);

-- ---------------------------------------------------------------------------
-- ops.pay_parameter_versions and items
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ops.pay_parameter_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  version_code varchar(32) NOT NULL,
  description varchar(255),
  effective_from date NOT NULL,
  effective_to date,
  status ops.parameter_status NOT NULL DEFAULT 'DRAFT',
  created_by_user_id uuid REFERENCES common.users(id),
  approved_by_user_id uuid REFERENCES common.users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_pay_parameter_versions_org_code UNIQUE (organization_id, version_code),
  CONSTRAINT ck_pay_parameter_period CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_pay_parameter_versions_effective
  ON ops.pay_parameter_versions(organization_id, effective_from DESC, effective_to DESC);

CREATE TABLE IF NOT EXISTS ops.pay_parameter_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parameter_version_id uuid NOT NULL REFERENCES ops.pay_parameter_versions(id) ON DELETE CASCADE,
  parameter_key varchar(64) NOT NULL,
  numeric_value numeric(18,6) NOT NULL,
  unit varchar(24) NOT NULL,
  description varchar(255),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_pay_parameter_items_key UNIQUE (parameter_version_id, parameter_key)
);

-- ---------------------------------------------------------------------------
-- ops.routes and state mileage splits
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ops.routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  from_location_id uuid NOT NULL REFERENCES ops.locations(id),
  to_location_id uuid NOT NULL REFERENCES ops.locations(id),
  total_miles numeric(10,2) NOT NULL CHECK (total_miles >= 0),
  source_type ops.route_source_type NOT NULL DEFAULT 'MANUAL_VERIFIED',
  source_reference varchar(500),
  verification_status ops.verification_status NOT NULL DEFAULT 'UNVERIFIED',
  verified_by_user_id uuid REFERENCES common.users(id),
  verified_at timestamptz,
  effective_from date NOT NULL,
  effective_to date,
  status common.record_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_route_period CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT ck_route_not_same_location CHECK (from_location_id <> to_location_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_routes_org_from_to_effective
  ON ops.routes(organization_id, from_location_id, to_location_id, effective_from);

CREATE INDEX IF NOT EXISTS idx_routes_lookup
  ON ops.routes(organization_id, from_location_id, to_location_id, effective_from DESC, effective_to DESC);
CREATE INDEX IF NOT EXISTS idx_routes_verification
  ON ops.routes(organization_id, verification_status, status);

CREATE TABLE IF NOT EXISTS ops.route_state_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  route_id uuid NOT NULL REFERENCES ops.routes(id) ON DELETE CASCADE,
  state_code char(2) NOT NULL REFERENCES ops.state_codes(code),
  state_miles numeric(10,2) NOT NULL CHECK (state_miles >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_route_state_splits_route_state UNIQUE (route_id, state_code)
);

CREATE INDEX IF NOT EXISTS idx_route_state_splits_state
  ON ops.route_state_splits(state_code, state_miles DESC);

COMMENT ON TABLE ops.routes IS 'Directional route mileage. A to B and B to A are separate records.';
COMMENT ON TABLE ops.route_state_splits IS 'State mileage split for a route. Verified routes must balance to route total miles.';

CREATE OR REPLACE FUNCTION ops.check_route_state_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_route_id uuid;
  v_total_miles numeric;
  v_verification ops.verification_status;
  v_state_total numeric;
BEGIN
  IF TG_TABLE_NAME = 'routes' THEN
    v_route_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    v_route_id := OLD.route_id;
  ELSE
    v_route_id := NEW.route_id;
  END IF;

  SELECT total_miles, verification_status
    INTO v_total_miles, v_verification
  FROM ops.routes
  WHERE id = v_route_id
  FOR UPDATE;

  SELECT COALESCE(SUM(state_miles), 0)
    INTO v_state_total
  FROM ops.route_state_splits
  WHERE route_id = v_route_id;

  IF v_verification = 'VERIFIED' AND v_state_total <> v_total_miles THEN
    RAISE EXCEPTION
      'Verified route % state mileage total % does not equal route total %',
      v_route_id, v_state_total, v_total_miles;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_routes_state_balance ON ops.routes;
CREATE TRIGGER trg_routes_state_balance
AFTER INSERT OR UPDATE OF total_miles, verification_status ON ops.routes
FOR EACH ROW EXECUTE FUNCTION ops.check_route_state_balance();

DROP TRIGGER IF EXISTS trg_route_state_splits_balance ON ops.route_state_splits;
CREATE TRIGGER trg_route_state_splits_balance
AFTER INSERT OR UPDATE OR DELETE ON ops.route_state_splits
FOR EACH ROW EXECUTE FUNCTION ops.check_route_state_balance();

-- ---------------------------------------------------------------------------
-- pay enum types
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  CREATE TYPE pay.period_status AS ENUM ('OPEN', 'REVIEWING', 'LOCKED', 'CLOSED');
  CREATE TYPE pay.statement_status AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'LOCKED', 'PAID');
  CREATE TYPE pay.calculation_status AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');
  CREATE TYPE pay.issue_severity AS ENUM ('BLOCKER', 'WARNING', 'INFO');
  CREATE TYPE pay.issue_status AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED', 'REOPENED');
  CREATE TYPE pay.workflow_action AS ENUM ('CREATE', 'SUBMIT', 'APPROVE', 'REJECT', 'LOCK', 'MARK_PAID', 'REOPEN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- pay.pay_periods
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pay.pay_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  period_code varchar(32) NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status pay.period_status NOT NULL DEFAULT 'OPEN',
  description varchar(255),
  locked_by_user_id uuid REFERENCES common.users(id),
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_pay_periods_org_code UNIQUE (organization_id, period_code),
  CONSTRAINT ck_pay_periods_date_range CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_pay_periods_dates
  ON pay.pay_periods(organization_id, start_date DESC, end_date DESC);

-- ---------------------------------------------------------------------------
-- pay.pay_statements
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pay.pay_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  statement_no varchar(40) NOT NULL,
  pay_period_id uuid NOT NULL REFERENCES pay.pay_periods(id),
  driver_id uuid NOT NULL REFERENCES ops.drivers(id),
  truck_id uuid REFERENCES ops.trucks(id),
  parameter_version_id uuid NOT NULL REFERENCES ops.pay_parameter_versions(id),
  status pay.statement_status NOT NULL DEFAULT 'DRAFT',
  currency_code char(3) NOT NULL DEFAULT 'USD',
  total_miles numeric(10,2) NOT NULL DEFAULT 0 CHECK (total_miles >= 0),
  total_base_pay numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_base_pay >= 0),
  total_point_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_point_amount >= 0),
  total_mileage_pay numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_mileage_pay >= 0),
  total_pay_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_pay_amount >= 0),
  calculated_at timestamptz,
  submitted_at timestamptz,
  submitted_by_user_id uuid REFERENCES common.users(id),
  reviewed_at timestamptz,
  reviewed_by_user_id uuid REFERENCES common.users(id),
  review_note varchar(500),
  locked_at timestamptz,
  locked_by_user_id uuid REFERENCES common.users(id),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_pay_statements_no UNIQUE (organization_id, statement_no),
  CONSTRAINT uq_pay_statements_period_driver UNIQUE (pay_period_id, driver_id),
  CONSTRAINT ck_pay_statement_total CHECK (
    total_pay_amount = total_base_pay + total_point_amount + total_mileage_pay
  )
);

CREATE INDEX IF NOT EXISTS idx_pay_statements_period_status
  ON pay.pay_statements(pay_period_id, status, driver_id);
CREATE INDEX IF NOT EXISTS idx_pay_statements_driver
  ON pay.pay_statements(driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pay_statements_parameter
  ON pay.pay_statements(parameter_version_id);

COMMENT ON TABLE pay.pay_statements IS 'One payroll statement per driver per pay period.';

-- ---------------------------------------------------------------------------
-- pay.calculation_runs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pay.calculation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  pay_statement_id uuid NOT NULL REFERENCES pay.pay_statements(id) ON DELETE CASCADE,
  parameter_version_id uuid NOT NULL REFERENCES ops.pay_parameter_versions(id),
  engine_version varchar(40) NOT NULL,
  input_hash varchar(128) NOT NULL,
  status pay.calculation_status NOT NULL DEFAULT 'RUNNING',
  error_message text,
  diagnostics jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_by_user_id uuid REFERENCES common.users(id)
);

CREATE INDEX IF NOT EXISTS idx_calculation_runs_statement
  ON pay.calculation_runs(pay_statement_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calculation_runs_status
  ON pay.calculation_runs(status, started_at DESC);

COMMENT ON TABLE pay.calculation_runs IS 'Reproducibility record for each payroll recalculation.';

-- ---------------------------------------------------------------------------
-- pay.trips
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pay.trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  pay_statement_id uuid NOT NULL REFERENCES pay.pay_statements(id) ON DELETE CASCADE,
  trip_no integer NOT NULL CHECK (trip_no > 0),
  start_leg_date date NOT NULL,
  end_leg_date date NOT NULL,
  actual_miles numeric(10,2) NOT NULL CHECK (actual_miles >= 0),
  base_pay_amount numeric(12,2) NOT NULL CHECK (base_pay_amount >= 0),
  point_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (point_amount >= 0),
  payable_miles numeric(10,2) NOT NULL CHECK (payable_miles >= 0),
  mileage_rate numeric(7,4) NOT NULL CHECK (mileage_rate >= 0),
  mileage_pay_amount numeric(12,2) NOT NULL CHECK (mileage_pay_amount >= 0),
  total_pay_amount numeric(12,2) NOT NULL CHECK (total_pay_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_trips_statement_no UNIQUE (pay_statement_id, trip_no),
  CONSTRAINT ck_trips_date_range CHECK (end_leg_date >= start_leg_date),
  CONSTRAINT ck_trip_total CHECK (
    total_pay_amount = base_pay_amount + point_amount + mileage_pay_amount
  )
);

CREATE INDEX IF NOT EXISTS idx_trips_statement
  ON pay.trips(pay_statement_id, trip_no);

-- ---------------------------------------------------------------------------
-- pay.trip_legs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pay.trip_legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  pay_statement_id uuid NOT NULL REFERENCES pay.pay_statements(id) ON DELETE CASCADE,
  trip_id uuid NOT NULL REFERENCES pay.trips(id) ON DELETE CASCADE,
  line_no integer NOT NULL CHECK (line_no > 0),
  leg_date date NOT NULL,
  from_code varchar(16) NOT NULL,
  to_code varchar(16) NOT NULL,
  from_location_id uuid REFERENCES ops.locations(id),
  to_location_id uuid REFERENCES ops.locations(id),
  operation_code varchar(16) NOT NULL,
  operation_code_id uuid REFERENCES ops.operation_codes(id),
  load_input varchar(1000),
  route_id uuid REFERENCES ops.routes(id),
  route_miles numeric(10,2) CHECK (route_miles >= 0),
  actual_miles numeric(10,2) NOT NULL CHECK (actual_miles >= 0),
  payable_miles numeric(10,2) NOT NULL CHECK (payable_miles >= 0),
  point_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (point_amount >= 0),
  point_rule_note varchar(255),
  is_return_to_base boolean NOT NULL DEFAULT false,
  note varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_trip_legs_statement_line UNIQUE (pay_statement_id, line_no),
  CONSTRAINT uq_trip_legs_trip_line UNIQUE (trip_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_trip_legs_statement
  ON pay.trip_legs(pay_statement_id, line_no);
CREATE INDEX IF NOT EXISTS idx_trip_legs_trip
  ON pay.trip_legs(trip_id, line_no);
CREATE INDEX IF NOT EXISTS idx_trip_legs_route
  ON pay.trip_legs(route_id);
CREATE INDEX IF NOT EXISTS idx_trip_legs_operation
  ON pay.trip_legs(operation_code_id);

COMMENT ON TABLE pay.trip_legs IS 'One finance-entered route segment. Operational codes are snapshotted here for reproducibility.';

-- ---------------------------------------------------------------------------
-- pay.trip_leg_loads
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pay.trip_leg_loads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  pay_statement_id uuid NOT NULL REFERENCES pay.pay_statements(id) ON DELETE CASCADE,
  trip_id uuid NOT NULL REFERENCES pay.trips(id) ON DELETE CASCADE,
  trip_leg_id uuid NOT NULL REFERENCES pay.trip_legs(id) ON DELETE CASCADE,
  load_number varchar(64) NOT NULL,
  weight_miles numeric(10,2) NOT NULL CHECK (weight_miles >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_trip_leg_loads_leg_load UNIQUE (trip_leg_id, load_number)
);

CREATE INDEX IF NOT EXISTS idx_trip_leg_loads_statement_load
  ON pay.trip_leg_loads(pay_statement_id, load_number);
CREATE INDEX IF NOT EXISTS idx_trip_leg_loads_trip_load
  ON pay.trip_leg_loads(trip_id, load_number);

-- ---------------------------------------------------------------------------
-- pay.load_allocations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pay.load_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  pay_statement_id uuid NOT NULL REFERENCES pay.pay_statements(id) ON DELETE CASCADE,
  trip_id uuid NOT NULL REFERENCES pay.trips(id) ON DELETE CASCADE,
  load_number varchar(64) NOT NULL,
  weight_miles numeric(10,2) NOT NULL CHECK (weight_miles >= 0),
  allocation_ratio numeric(9,8) NOT NULL CHECK (allocation_ratio >= 0),
  allocated_miles numeric(10,2) NOT NULL CHECK (allocated_miles >= 0),
  allocated_pay_amount numeric(12,2) NOT NULL CHECK (allocated_pay_amount >= 0),
  is_tail_difference_holder boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_load_allocations_trip_load UNIQUE (trip_id, load_number)
);

CREATE INDEX IF NOT EXISTS idx_load_allocations_statement_load
  ON pay.load_allocations(pay_statement_id, load_number);

COMMENT ON TABLE pay.load_allocations IS 'Per-trip mileage and payroll allocation for one Load number.';

-- ---------------------------------------------------------------------------
-- pay.statement_load_summaries
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pay.statement_load_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  pay_statement_id uuid NOT NULL REFERENCES pay.pay_statements(id) ON DELETE CASCADE,
  load_number varchar(64) NOT NULL,
  allocated_miles numeric(10,2) NOT NULL CHECK (allocated_miles >= 0),
  allocated_pay_amount numeric(12,2) NOT NULL CHECK (allocated_pay_amount >= 0),
  trip_count integer NOT NULL CHECK (trip_count > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_statement_load_summaries_load UNIQUE (pay_statement_id, load_number)
);

CREATE INDEX IF NOT EXISTS idx_statement_load_summaries_load
  ON pay.statement_load_summaries(pay_statement_id, load_number);

-- ---------------------------------------------------------------------------
-- pay.trip_state_mileages and statement state mileages
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pay.trip_state_mileages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  pay_statement_id uuid NOT NULL REFERENCES pay.pay_statements(id) ON DELETE CASCADE,
  trip_id uuid NOT NULL REFERENCES pay.trips(id) ON DELETE CASCADE,
  state_code char(2) NOT NULL REFERENCES ops.state_codes(code),
  state_miles numeric(10,2) NOT NULL CHECK (state_miles >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_trip_state_mileages UNIQUE (trip_id, state_code)
);

CREATE INDEX IF NOT EXISTS idx_trip_state_mileages_statement
  ON pay.trip_state_mileages(pay_statement_id, state_code);

CREATE TABLE IF NOT EXISTS pay.statement_state_mileages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  pay_statement_id uuid NOT NULL REFERENCES pay.pay_statements(id) ON DELETE CASCADE,
  state_code char(2) NOT NULL REFERENCES ops.state_codes(code),
  state_miles numeric(10,2) NOT NULL CHECK (state_miles >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_statement_state_mileages UNIQUE (pay_statement_id, state_code)
);

CREATE INDEX IF NOT EXISTS idx_statement_state_mileages_state
  ON pay.statement_state_mileages(pay_statement_id, state_code);

-- ---------------------------------------------------------------------------
-- pay.issues
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pay.issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  pay_statement_id uuid NOT NULL REFERENCES pay.pay_statements(id) ON DELETE CASCADE,
  trip_id uuid REFERENCES pay.trips(id) ON DELETE SET NULL,
  trip_leg_id uuid REFERENCES pay.trip_legs(id) ON DELETE SET NULL,
  issue_code varchar(64) NOT NULL,
  issue_type varchar(80) NOT NULL,
  severity pay.issue_severity NOT NULL,
  status pay.issue_status NOT NULL DEFAULT 'OPEN',
  title varchar(160) NOT NULL,
  message text NOT NULL,
  suggested_action varchar(500),
  resolved_by_user_id uuid REFERENCES common.users(id),
  resolved_at timestamptz,
  resolution_note varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_issues_statement_status
  ON pay.issues(pay_statement_id, status, severity);
CREATE INDEX IF NOT EXISTS idx_issues_organization_status
  ON pay.issues(organization_id, status, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_issues_trip
  ON pay.issues(trip_id);
CREATE INDEX IF NOT EXISTS idx_issues_leg
  ON pay.issues(trip_leg_id);

COMMENT ON TABLE pay.issues IS 'Settlement exceptions and review warnings.';

-- ---------------------------------------------------------------------------
-- pay.statement_workflow_logs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pay.statement_workflow_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES common.organizations(id),
  pay_statement_id uuid NOT NULL REFERENCES pay.pay_statements(id) ON DELETE CASCADE,
  action pay.workflow_action NOT NULL,
  actor_user_id uuid REFERENCES common.users(id),
  from_status pay.statement_status,
  to_status pay.statement_status,
  comment varchar(1000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_statement_workflow_statement
  ON pay.statement_workflow_logs(pay_statement_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_statement_workflow_actor
  ON pay.statement_workflow_logs(actor_user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Protect approved, locked, and paid statements from direct result edits.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION pay.protect_immutable_statement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_statement_id uuid;
  v_status pay.statement_status;
BEGIN
  v_statement_id := COALESCE(NEW.pay_statement_id, OLD.pay_statement_id);

  SELECT status
    INTO v_status
  FROM pay.pay_statements
  WHERE id = v_statement_id
  FOR UPDATE;

  IF v_status IN ('APPROVED', 'LOCKED', 'PAID') THEN
    RAISE EXCEPTION
      'Cannot modify calculation result % because statement status is %',
      v_statement_id, v_status;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trips_protect_statement ON pay.trips;
CREATE TRIGGER trg_trips_protect_statement
BEFORE INSERT OR UPDATE OR DELETE ON pay.trips
FOR EACH ROW EXECUTE FUNCTION pay.protect_immutable_statement();

DROP TRIGGER IF EXISTS trg_trip_legs_protect_statement ON pay.trip_legs;
CREATE TRIGGER trg_trip_legs_protect_statement
BEFORE INSERT OR UPDATE OR DELETE ON pay.trip_legs
FOR EACH ROW EXECUTE FUNCTION pay.protect_immutable_statement();

DROP TRIGGER IF EXISTS trg_trip_leg_loads_protect_statement ON pay.trip_leg_loads;
CREATE TRIGGER trg_trip_leg_loads_protect_statement
BEFORE INSERT OR UPDATE OR DELETE ON pay.trip_leg_loads
FOR EACH ROW EXECUTE FUNCTION pay.protect_immutable_statement();

DROP TRIGGER IF EXISTS trg_load_allocations_protect_statement ON pay.load_allocations;
CREATE TRIGGER trg_load_allocations_protect_statement
BEFORE INSERT OR UPDATE OR DELETE ON pay.load_allocations
FOR EACH ROW EXECUTE FUNCTION pay.protect_immutable_statement();

DROP TRIGGER IF EXISTS trg_statement_loads_protect_statement ON pay.statement_load_summaries;
CREATE TRIGGER trg_statement_loads_protect_statement
BEFORE INSERT OR UPDATE OR DELETE ON pay.statement_load_summaries
FOR EACH ROW EXECUTE FUNCTION pay.protect_immutable_statement();

DROP TRIGGER IF EXISTS trg_trip_state_mileages_protect_statement ON pay.trip_state_mileages;
CREATE TRIGGER trg_trip_state_mileages_protect_statement
BEFORE INSERT OR UPDATE OR DELETE ON pay.trip_state_mileages
FOR EACH ROW EXECUTE FUNCTION pay.protect_immutable_statement();

DROP TRIGGER IF EXISTS trg_statement_state_mileages_protect_statement ON pay.statement_state_mileages;
CREATE TRIGGER trg_statement_state_mileages_protect_statement
BEFORE INSERT OR UPDATE OR DELETE ON pay.statement_state_mileages
FOR EACH ROW EXECUTE FUNCTION pay.protect_immutable_statement();

COMMIT;
