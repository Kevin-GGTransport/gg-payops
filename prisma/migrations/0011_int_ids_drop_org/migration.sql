-- G&G PayOps
-- 0011: project-wide auto-increment bigint ids (no uuid ids anywhere); drop organizations table
--       and every organization_id column. Single-company system.

BEGIN;

--------------------------------------------------------------------
-- 0. Drop all FKs touching columns that change in this migration
--------------------------------------------------------------------
ALTER TABLE common.users DROP CONSTRAINT users_organization_id_fkey;
ALTER TABLE common.roles DROP CONSTRAINT roles_organization_id_fkey;
ALTER TABLE ops.trucks DROP CONSTRAINT trucks_organization_id_fkey;
ALTER TABLE ops.driver_truck_assignments DROP CONSTRAINT driver_truck_assignments_organization_id_fkey;
ALTER TABLE ops.locations DROP CONSTRAINT locations_organization_id_fkey;
ALTER TABLE pay.trips DROP CONSTRAINT trips_organization_id_fkey;

ALTER TABLE common.user_sessions DROP CONSTRAINT user_sessions_user_id_fkey;
ALTER TABLE common.user_roles DROP CONSTRAINT user_roles_user_id_fkey;
ALTER TABLE common.user_roles DROP CONSTRAINT user_roles_role_id_fkey;
ALTER TABLE common.user_roles DROP CONSTRAINT user_roles_assigned_by_user_id_fkey;
ALTER TABLE common.role_permissions DROP CONSTRAINT role_permissions_role_id_fkey;
ALTER TABLE common.role_permissions DROP CONSTRAINT role_permissions_permission_id_fkey;
ALTER TABLE ops.drivers DROP CONSTRAINT drivers_linked_user_id_fkey;
ALTER TABLE ops.driver_truck_assignments DROP CONSTRAINT driver_truck_assignments_truck_id_fkey;
ALTER TABLE pay.trips DROP CONSTRAINT trips_from_location_id_fkey;
ALTER TABLE pay.trips DROP CONSTRAINT trips_to_location_id_fkey;

--------------------------------------------------------------------
-- 1. Build old-uuid -> new-int maps for tables that carry data
--------------------------------------------------------------------
ALTER TABLE common.users ADD COLUMN new_id bigint;
UPDATE common.users u SET new_id = m.rn
  FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM common.users) m
  WHERE u.id = m.id;
CREATE TEMP TABLE user_map AS SELECT id AS old_id, new_id FROM common.users;

ALTER TABLE common.roles ADD COLUMN new_id bigint;
UPDATE common.roles r SET new_id = m.rn
  FROM (SELECT id, row_number() OVER (ORDER BY code) AS rn FROM common.roles) m
  WHERE r.id = m.id;
CREATE TEMP TABLE role_map AS SELECT id AS old_id, new_id FROM common.roles;

ALTER TABLE common.permissions ADD COLUMN new_id bigint;
UPDATE common.permissions p SET new_id = m.rn
  FROM (SELECT id, row_number() OVER (ORDER BY code) AS rn FROM common.permissions) m
  WHERE p.id = m.id;
CREATE TEMP TABLE perm_map AS SELECT id AS old_id, new_id FROM common.permissions;

ALTER TABLE common.user_sessions ADD COLUMN new_id bigint;
UPDATE common.user_sessions s SET new_id = m.rn
  FROM (SELECT id, row_number() OVER (ORDER BY created_at) AS rn FROM common.user_sessions) m
  WHERE s.id = m.id;

ALTER TABLE ops.locations ADD COLUMN new_id bigint;
UPDATE ops.locations l SET new_id = m.rn
  FROM (SELECT id, row_number() OVER (ORDER BY code) AS rn FROM ops.locations) m
  WHERE l.id = m.id;

--------------------------------------------------------------------
-- 2. Remap link-table FK values via the maps (shadow bigint columns)
--------------------------------------------------------------------
ALTER TABLE common.role_permissions ADD COLUMN new_role_id bigint, ADD COLUMN new_permission_id bigint;
UPDATE common.role_permissions rp SET new_role_id = rm.new_id FROM role_map rm WHERE rp.role_id = rm.old_id;
UPDATE common.role_permissions rp SET new_permission_id = pm.new_id FROM perm_map pm WHERE rp.permission_id = pm.old_id;

ALTER TABLE common.user_roles ADD COLUMN new_user_id bigint, ADD COLUMN new_role_id bigint, ADD COLUMN new_assigned_by bigint;
UPDATE common.user_roles ur SET new_user_id = um.new_id FROM user_map um WHERE ur.user_id = um.old_id;
UPDATE common.user_roles ur SET new_role_id = rm.new_id FROM role_map rm WHERE ur.role_id = rm.old_id;
UPDATE common.user_roles ur SET new_assigned_by = um.new_id FROM user_map um WHERE ur.assigned_by_user_id = um.old_id;

ALTER TABLE common.user_sessions ADD COLUMN new_user_id bigint;
UPDATE common.user_sessions s SET new_user_id = um.new_id FROM user_map um WHERE s.user_id = um.old_id;

--------------------------------------------------------------------
-- 3. common.users: identity id, drop organization_id
--------------------------------------------------------------------
ALTER TABLE common.users DROP CONSTRAINT users_pkey;
ALTER TABLE common.users DROP COLUMN organization_id;
ALTER TABLE common.users DROP COLUMN id;
ALTER TABLE common.users RENAME COLUMN new_id TO id;
ALTER TABLE common.users ALTER COLUMN id SET NOT NULL;
ALTER TABLE common.users ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;
SELECT setval(pg_get_serial_sequence('common.users', 'id'),
              (SELECT COALESCE(max(id), 1) FROM common.users),
              EXISTS (SELECT 1 FROM common.users));
ALTER TABLE common.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);

--------------------------------------------------------------------
-- 4. common.roles: identity id, drop organization_id, code now global key
--------------------------------------------------------------------
ALTER TABLE common.roles DROP CONSTRAINT roles_pkey;
ALTER TABLE common.roles DROP CONSTRAINT uq_roles_org_code;
DROP INDEX IF EXISTS common.idx_roles_organization;
ALTER TABLE common.roles DROP COLUMN organization_id;
ALTER TABLE common.roles DROP COLUMN id;
ALTER TABLE common.roles RENAME COLUMN new_id TO id;
ALTER TABLE common.roles ALTER COLUMN id SET NOT NULL;
ALTER TABLE common.roles ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;
SELECT setval(pg_get_serial_sequence('common.roles', 'id'),
              (SELECT COALESCE(max(id), 1) FROM common.roles),
              EXISTS (SELECT 1 FROM common.roles));
ALTER TABLE common.roles ADD CONSTRAINT roles_pkey PRIMARY KEY (id);
ALTER TABLE common.roles ADD CONSTRAINT uq_roles_code UNIQUE (code);
CREATE INDEX idx_roles_status ON common.roles (status);

--------------------------------------------------------------------
-- 5. common.permissions: identity id
--------------------------------------------------------------------
ALTER TABLE common.permissions DROP CONSTRAINT permissions_pkey;
ALTER TABLE common.permissions DROP COLUMN id;
ALTER TABLE common.permissions RENAME COLUMN new_id TO id;
ALTER TABLE common.permissions ALTER COLUMN id SET NOT NULL;
ALTER TABLE common.permissions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;
SELECT setval(pg_get_serial_sequence('common.permissions', 'id'),
              (SELECT COALESCE(max(id), 1) FROM common.permissions),
              EXISTS (SELECT 1 FROM common.permissions));
ALTER TABLE common.permissions ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);

--------------------------------------------------------------------
-- 6. common.role_permissions: swap remapped columns, restore PK/FKs
--------------------------------------------------------------------
ALTER TABLE common.role_permissions DROP CONSTRAINT role_permissions_pkey;
ALTER TABLE common.role_permissions DROP COLUMN role_id, DROP COLUMN permission_id;
ALTER TABLE common.role_permissions RENAME COLUMN new_role_id TO role_id;
ALTER TABLE common.role_permissions RENAME COLUMN new_permission_id TO permission_id;
ALTER TABLE common.role_permissions ALTER COLUMN role_id SET NOT NULL;
ALTER TABLE common.role_permissions ALTER COLUMN permission_id SET NOT NULL;
ALTER TABLE common.role_permissions ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id);
ALTER TABLE common.role_permissions
  ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES common.roles(id) ON DELETE CASCADE;
ALTER TABLE common.role_permissions
  ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES common.permissions(id) ON DELETE CASCADE;
CREATE INDEX idx_role_permissions_permission ON common.role_permissions (permission_id);

--------------------------------------------------------------------
-- 7. common.user_roles: swap remapped columns, restore PK/FKs
--------------------------------------------------------------------
ALTER TABLE common.user_roles DROP CONSTRAINT user_roles_pkey;
ALTER TABLE common.user_roles DROP COLUMN user_id, DROP COLUMN role_id, DROP COLUMN assigned_by_user_id;
ALTER TABLE common.user_roles RENAME COLUMN new_user_id TO user_id;
ALTER TABLE common.user_roles RENAME COLUMN new_role_id TO role_id;
ALTER TABLE common.user_roles RENAME COLUMN new_assigned_by TO assigned_by_user_id;
ALTER TABLE common.user_roles ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE common.user_roles ALTER COLUMN role_id SET NOT NULL;
ALTER TABLE common.user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role_id);
ALTER TABLE common.user_roles
  ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES common.users(id) ON DELETE CASCADE;
ALTER TABLE common.user_roles
  ADD CONSTRAINT user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES common.roles(id) ON DELETE CASCADE;
ALTER TABLE common.user_roles
  ADD CONSTRAINT user_roles_assigned_by_user_id_fkey FOREIGN KEY (assigned_by_user_id) REFERENCES common.users(id);
CREATE INDEX idx_user_roles_role ON common.user_roles (role_id);

--------------------------------------------------------------------
-- 8. common.user_sessions: identity id, user_id follows users
--------------------------------------------------------------------
ALTER TABLE common.user_sessions DROP CONSTRAINT user_sessions_pkey;
ALTER TABLE common.user_sessions DROP COLUMN id, DROP COLUMN user_id;
ALTER TABLE common.user_sessions RENAME COLUMN new_id TO id;
ALTER TABLE common.user_sessions RENAME COLUMN new_user_id TO user_id;
ALTER TABLE common.user_sessions ALTER COLUMN id SET NOT NULL;
ALTER TABLE common.user_sessions ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE common.user_sessions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;
SELECT setval(pg_get_serial_sequence('common.user_sessions', 'id'),
              (SELECT COALESCE(max(id), 1) FROM common.user_sessions),
              EXISTS (SELECT 1 FROM common.user_sessions));
ALTER TABLE common.user_sessions ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);
ALTER TABLE common.user_sessions
  ADD CONSTRAINT user_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES common.users(id) ON DELETE CASCADE;
CREATE INDEX idx_user_sessions_user_active ON common.user_sessions (user_id, expires_at) WHERE revoked_at IS NULL;

--------------------------------------------------------------------
-- 9. ops.drivers: linked_user_id follows users (all values NULL)
--------------------------------------------------------------------
ALTER TABLE ops.drivers ALTER COLUMN linked_user_id TYPE bigint USING linked_user_id::text::bigint;
ALTER TABLE ops.drivers
  ADD CONSTRAINT drivers_linked_user_id_fkey FOREIGN KEY (linked_user_id) REFERENCES common.users(id);

--------------------------------------------------------------------
-- 10. ops.locations: identity id, drop organization_id, code global key
--------------------------------------------------------------------
ALTER TABLE ops.locations DROP CONSTRAINT locations_pkey;
ALTER TABLE ops.locations DROP CONSTRAINT uq_locations_org_code;
DROP INDEX IF EXISTS ops.idx_locations_org_type;
DROP INDEX IF EXISTS ops.idx_locations_base;
ALTER TABLE ops.locations DROP COLUMN organization_id;
ALTER TABLE ops.locations DROP COLUMN id;
ALTER TABLE ops.locations RENAME COLUMN new_id TO id;
ALTER TABLE ops.locations ALTER COLUMN id SET NOT NULL;
ALTER TABLE ops.locations ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;
SELECT setval(pg_get_serial_sequence('ops.locations', 'id'),
              (SELECT COALESCE(max(id), 1) FROM ops.locations),
              EXISTS (SELECT 1 FROM ops.locations));
ALTER TABLE ops.locations ADD CONSTRAINT locations_pkey PRIMARY KEY (id);
ALTER TABLE ops.locations ADD CONSTRAINT uq_locations_code UNIQUE (code);
CREATE INDEX idx_locations_type ON ops.locations (location_type, status, code);
CREATE INDEX idx_locations_base ON ops.locations (id) WHERE is_base = true;

--------------------------------------------------------------------
-- 11. ops.trucks (empty): identity id, drop organization_id
--------------------------------------------------------------------
ALTER TABLE ops.trucks DROP CONSTRAINT trucks_pkey;
ALTER TABLE ops.trucks DROP CONSTRAINT uq_trucks_org_code;
DROP INDEX IF EXISTS ops.idx_trucks_org_status;
ALTER TABLE ops.trucks DROP COLUMN organization_id;
ALTER TABLE ops.trucks DROP COLUMN id;
ALTER TABLE ops.trucks ADD COLUMN id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY;
ALTER TABLE ops.trucks ADD CONSTRAINT uq_trucks_code UNIQUE (truck_code);
CREATE INDEX idx_trucks_status ON ops.trucks (status, truck_code);

--------------------------------------------------------------------
-- 12. ops.driver_truck_assignments (empty): identity id, drop organization_id
--------------------------------------------------------------------
ALTER TABLE ops.driver_truck_assignments DROP CONSTRAINT driver_truck_assignments_pkey;
ALTER TABLE ops.driver_truck_assignments DROP COLUMN organization_id;
ALTER TABLE ops.driver_truck_assignments ALTER COLUMN truck_id TYPE bigint USING truck_id::text::bigint;
ALTER TABLE ops.driver_truck_assignments DROP COLUMN id;
ALTER TABLE ops.driver_truck_assignments ADD COLUMN id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY;
ALTER TABLE ops.driver_truck_assignments
  ADD CONSTRAINT driver_truck_assignments_truck_id_fkey FOREIGN KEY (truck_id) REFERENCES ops.trucks(id);

--------------------------------------------------------------------
-- 13. pay.trips (empty): identity id, drop organization_id, location refs follow
--------------------------------------------------------------------
ALTER TABLE pay.trips DROP CONSTRAINT trips_pkey;
DROP INDEX IF EXISTS pay.idx_trips_org_date;
ALTER TABLE pay.trips DROP COLUMN organization_id;
ALTER TABLE pay.trips ALTER COLUMN from_location_id TYPE bigint USING from_location_id::text::bigint;
ALTER TABLE pay.trips ALTER COLUMN to_location_id TYPE bigint USING to_location_id::text::bigint;
ALTER TABLE pay.trips DROP COLUMN id;
ALTER TABLE pay.trips ADD COLUMN id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY;
ALTER TABLE pay.trips
  ADD CONSTRAINT trips_from_location_id_fkey FOREIGN KEY (from_location_id) REFERENCES ops.locations(id);
ALTER TABLE pay.trips
  ADD CONSTRAINT trips_to_location_id_fkey FOREIGN KEY (to_location_id) REFERENCES ops.locations(id);

--------------------------------------------------------------------
-- 14. organizations table itself: nothing references it anymore
--------------------------------------------------------------------
DROP TABLE common.organizations;

COMMIT;
