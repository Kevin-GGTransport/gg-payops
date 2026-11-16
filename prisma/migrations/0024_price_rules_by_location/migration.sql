-- G&G PayOps
-- 0024: pricing unified into location-keyed price rules.
--   pay.wage_rule_prices: from_class/to_class (STK/HW/SHIPPER/AMAZON_A/B)
--     are replaced by from_location_id/to_location_id - a rule pins concrete
--     dictionary locations, NULL = any side. Seeded rows translate: HW↔SHIPPER
--     / 提柜 / 还空 land on their location ids; the two STK→A/B-class rows go
--     (the A/B classification never happened) and come back as per-warehouse
--     rules once the user names them.
--   Old BASE half-price model retired: every location with standard_pay > 0
--     gets explicit per-leg rules (HW→X and SHIPPER→X at half the round-trip
--     standard, owner column left empty = driver price x owner multiplier),
--     then ops.locations.standard_pay_amount and amazon_class drop.
-- Idempotent-ish: guarded by the _migrations registration done alongside.

BEGIN;

ALTER TABLE pay.wage_rule_prices
  ADD COLUMN from_location_id bigint REFERENCES ops.locations(id),
  ADD COLUMN to_location_id bigint REFERENCES ops.locations(id);

CREATE INDEX idx_wage_prices_from_loc ON pay.wage_rule_prices (from_location_id);
CREATE INDEX idx_wage_prices_to_loc ON pay.wage_rule_prices (to_location_id);

-- Translate the seeded class-keyed rows onto location ids
UPDATE pay.wage_rule_prices r
SET from_location_id = (SELECT id FROM ops.locations WHERE code = 'HW' LIMIT 1),
    to_location_id = (SELECT id FROM ops.locations WHERE code = 'SHIPPER' LIMIT 1)
WHERE r.label = 'HW ↔ Shipper';

UPDATE pay.wage_rule_prices r
SET to_location_id = (SELECT id FROM ops.locations WHERE code = 'SHIPPER' LIMIT 1)
WHERE r.label = '提柜 → Shipper';

UPDATE pay.wage_rule_prices r
SET from_location_id = (SELECT id FROM ops.locations WHERE code = 'SHIPPER' LIMIT 1)
WHERE r.label = 'Shipper → 还空';

-- Class-keyed rows cannot resolve without the A/B classification: drop them
DELETE FROM pay.wage_rule_prices WHERE label IN ('ST → A类仓', 'ST → B类仓');

ALTER TABLE pay.wage_rule_prices
  DROP COLUMN from_class,
  DROP COLUMN to_class;

-- Carry the old BASE half-price into explicit rules: every non-BASE location
-- with a round-trip standard bills half per leg from either base
INSERT INTO pay.wage_rule_prices(version_id, driver_id, unit, from_location_id, to_location_id,
                                 operation, label, driver_amount, owner_amount)
SELECT v.id, NULL, 'LEG', b.id, x.id, NULL,
       'HW → ' || x.code, round(x.standard_pay_amount / 2, 2), NULL
FROM pay.wage_rule_versions v
CROSS JOIN ops.locations b
JOIN ops.locations x ON x.standard_pay_amount > 0 AND x.location_type <> 'BASE' AND x.status = 'ACTIVE'
WHERE v.effective_from = DATE '2026-11-15' AND b.code = 'HW'
  AND NOT EXISTS (
    SELECT 1 FROM pay.wage_rule_prices p
    WHERE p.version_id = v.id AND p.from_location_id = b.id AND p.to_location_id = x.id
  );

INSERT INTO pay.wage_rule_prices(version_id, driver_id, unit, from_location_id, to_location_id,
                                 operation, label, driver_amount, owner_amount)
SELECT v.id, NULL, 'LEG', b.id, x.id, NULL,
       'SHIPPER → ' || x.code, round(x.standard_pay_amount / 2, 2), NULL
FROM pay.wage_rule_versions v
CROSS JOIN ops.locations b
JOIN ops.locations x ON x.standard_pay_amount > 0 AND x.location_type <> 'BASE' AND x.status = 'ACTIVE'
WHERE v.effective_from = DATE '2026-11-15' AND b.code = 'SHIPPER'
  AND NOT EXISTS (
    SELECT 1 FROM pay.wage_rule_prices p
    WHERE p.version_id = v.id AND p.from_location_id = b.id AND p.to_location_id = x.id
  );

-- Location dictionary is a pure address book now
ALTER TABLE ops.locations
  DROP COLUMN standard_pay_amount,
  DROP COLUMN amazon_class;

COMMIT;
