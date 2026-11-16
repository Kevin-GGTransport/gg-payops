-- 2026-11-16 sync from the dock drayage sheet (703785df…png in 定价表/):
--   SSA/Trapac/ETS/PCC terminals get locations tagged 码头; rules bind #码头
--   so re-tagging a terminal re-prices it. HW院 25503 = existing HW location
--   (25503 Industrial Blvd, Hayward); SHIPPER YARD = existing SHIPPER.
--   The 还柜/车架/空车 three-tier split needs a CHASSIS operation (EMPTY
--   would collide: 还柜 80 vs 车架 50 vs bobtail 25).
--   Sheet rows 5/6 (SHIPPER YARD <-> terminal 30/30) are already covered by
--   the global 提柜→Shipper / Shipper→还空 rules.
-- Idempotent: safe to re-run on both local and prod.

BEGIN;

-- 1. Port terminals (addresses left blank - fill in via 位置管理)
INSERT INTO ops.locations (code, name, location_type, class_tag, city, state_code, country_code, is_base, status)
SELECT c.code, c.code, 'OTHER', '码头', 'Oakland', 'CA', 'US', false, 'ACTIVE'
FROM (VALUES ('SSA'), ('TRAPAC'), ('ETS'), ('PCC')) AS c(code)
WHERE NOT EXISTS (SELECT 1 FROM ops.locations l WHERE l.code = c.code);

-- 2. Chassis-only move (no container -> no load#, like EMPTY/BOBTAIL)
INSERT INTO ops.operation_types (code, label, requires_load)
SELECT 'CHASSIS', 'CHASSIS', false
WHERE NOT EXISTS (SELECT 1 FROM ops.operation_types WHERE code = 'CHASSIS');

-- 3. Dock rules (owner stays NULL -> driver x owner_multiplier, per the
--    sheet's single wage column and every other sheet's 数值2=数值1x2)
INSERT INTO pay.wage_rule_prices
  (version_id, unit, from_location_id, from_tag, to_location_id, to_tag, operation, label, driver_amount, owner_amount, driver_id)
SELECT v.id, 'LEG', f.id, '码头', NULL, NULL, 'PU', '码头 → HW · 提柜', 80, NULL, NULL
FROM pay.wage_rule_versions v CROSS JOIN ops.locations f
WHERE v.effective_from = '2026-11-15' AND f.code = 'HW'
  AND NOT EXISTS (SELECT 1 FROM pay.wage_rule_prices p WHERE p.version_id = v.id AND p.label = '码头 → HW · 提柜');

INSERT INTO pay.wage_rule_prices
  (version_id, unit, from_location_id, from_tag, to_location_id, to_tag, operation, label, driver_amount, owner_amount, driver_id)
SELECT v.id, 'LEG', f.id, NULL, NULL, '码头', 'EMPTY', 'HW → 码头 · 还柜', 80, NULL, NULL
FROM pay.wage_rule_versions v CROSS JOIN ops.locations f
WHERE v.effective_from = '2026-11-15' AND f.code = 'HW'
  AND NOT EXISTS (SELECT 1 FROM pay.wage_rule_prices p WHERE p.version_id = v.id AND p.label = 'HW → 码头 · 还柜');

INSERT INTO pay.wage_rule_prices
  (version_id, unit, from_location_id, from_tag, to_location_id, to_tag, operation, label, driver_amount, owner_amount, driver_id)
SELECT v.id, 'LEG', f.id, NULL, NULL, '码头', 'CHASSIS', 'HW → 码头 · 车架', 50, NULL, NULL
FROM pay.wage_rule_versions v CROSS JOIN ops.locations f
WHERE v.effective_from = '2026-11-15' AND f.code = 'HW'
  AND NOT EXISTS (SELECT 1 FROM pay.wage_rule_prices p WHERE p.version_id = v.id AND p.label = 'HW → 码头 · 车架');

INSERT INTO pay.wage_rule_prices
  (version_id, unit, from_location_id, from_tag, to_location_id, to_tag, operation, label, driver_amount, owner_amount, driver_id)
SELECT v.id, 'LEG', f.id, NULL, NULL, '码头', 'BOBTAIL', 'HW → 码头 · 空车', 25, NULL, NULL
FROM pay.wage_rule_versions v CROSS JOIN ops.locations f
WHERE v.effective_from = '2026-11-15' AND f.code = 'HW'
  AND NOT EXISTS (SELECT 1 FROM pay.wage_rule_prices p WHERE p.version_id = v.id AND p.label = 'HW → 码头 · 空车');

COMMIT;
