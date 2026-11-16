-- 2026-11-16 sync from the Amazon pricing PDF (text layer, authoritative):
--   1. seed STK station when missing (mirrors the prod row)
--   2. stamp class tags A类..F类 on the 27 classified warehouses
--   3. fix three rules seeded from a misread of the PDF image
--      (PDF bottom rows: 码头 HW仓库-shipper 50/100, 提柜-shipper 30/60, shipper-还空 30/60)
--   4. add the missing ST → A类/B类 rule (50/100) as tag-bound rules
-- Idempotent: safe to re-run on both local and prod.

BEGIN;

-- 1. STK station (local lacks it; prod has id 38 with these values)
INSERT INTO ops.locations (code, name, location_type, address_line, postal_code, country_code, is_base, status)
SELECT 'STK', 'STK', 'OTHER', 'STK', '95206', 'US', false, 'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM ops.locations WHERE code = 'STK');

-- 2. Classification tags from the PDF table (类别 column)
UPDATE ops.locations SET class_tag = 'A类' WHERE code IN ('SJC7');
UPDATE ops.locations SET class_tag = 'B类' WHERE code IN ('SMF3', 'SCK4', 'SCK1', 'TCY1', 'TCY2', 'QXY5');
UPDATE ops.locations SET class_tag = 'C类' WHERE code IN ('OAK3', 'SCK3', 'SMF7', 'SCK8');
UPDATE ops.locations SET class_tag = 'D类' WHERE code IN ('SMF6', 'MCC1', 'WALMART-SMF1N');
UPDATE ops.locations SET class_tag = 'E类' WHERE code IN ('HLI2', 'MCE1', 'FAT2', 'RNO4', 'MIT2');
UPDATE ops.locations SET class_tag = 'F类' WHERE code IN ('GEG2', 'BFI3', 'PSC2', 'OLM1', 'PDX7', 'IWA6');

-- 3. Correct the three rules seeded from a hallucinated image read (labels are
--    identical across local and prod; version pinned by effective date)
UPDATE pay.wage_rule_prices p
SET driver_amount = 50, owner_amount = 100
FROM pay.wage_rule_versions v
WHERE v.id = p.version_id AND v.effective_from = '2026-11-15'
  AND p.label = 'HW ↔ Shipper';

UPDATE pay.wage_rule_prices p
SET driver_amount = 30, owner_amount = 60
FROM pay.wage_rule_versions v
WHERE v.id = p.version_id AND v.effective_from = '2026-11-15'
  AND p.label = '提柜 → Shipper';

UPDATE pay.wage_rule_prices p
SET driver_amount = 30, owner_amount = 60
FROM pay.wage_rule_versions v
WHERE v.id = p.version_id AND v.effective_from = '2026-11-15'
  AND p.label = 'Shipper → 还空';

-- 4. ST → A类/B类 (PDF row "ST ST-A类/B类 50/100"): tag-bound so re-tagging a
--    location re-prices it, per the rules-follow-tags semantics
INSERT INTO pay.wage_rule_prices
  (version_id, unit, from_location_id, from_tag, to_location_id, to_tag, operation, label, driver_amount, owner_amount, driver_id)
SELECT v.id, 'LEG', s.id, NULL, NULL, t.tag, NULL, 'STK → ' || t.tag, 50, 100, NULL
FROM pay.wage_rule_versions v
CROSS JOIN ops.locations s
CROSS JOIN (VALUES ('A类'), ('B类')) AS t(tag)
WHERE v.effective_from = '2026-11-15'
  AND s.code = 'STK'
  AND NOT EXISTS (
    SELECT 1 FROM pay.wage_rule_prices p
    WHERE p.version_id = v.id AND p.from_location_id = s.id AND p.to_tag = t.tag
  );

COMMIT;
