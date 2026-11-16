-- Seed the 2026-11 pricing (Amazon 定价表 PDF + 海柜结算单):
-- a today-effective version (copy of #1) carrying the five fixed-route LEG
-- rules and the two package suggestions. Apply once per database.

BEGIN;

-- Today's version cloned from the governing 2026-06 version
INSERT INTO pay.wage_rule_versions(name, effective_from, owner_multiplier, bobtail_multiplier, overage_increment, notes)
SELECT 'CA Local 2026-11 版', DATE '2026-11-15', v.owner_multiplier, v.bobtail_multiplier, v.overage_increment,
       '自版本 #' || v.id || ' 复制调价（Amazon 定价表 + 海柜打包价）'
FROM pay.wage_rule_versions v
WHERE v.id = 1
  AND NOT EXISTS (SELECT 1 FROM pay.wage_rule_versions WHERE effective_from = DATE '2026-11-15');

INSERT INTO pay.wage_rule_tiers(version_id, miles_from, amount)
SELECT v.id, t.miles_from, t.amount
FROM pay.wage_rule_versions v
JOIN pay.wage_rule_tiers t ON t.version_id = 1
WHERE v.effective_from = DATE '2026-11-15';

INSERT INTO pay.wage_rule_special_routes(version_id, from_postal, to_postal, one_way_amount, note)
SELECT v.id, r.from_postal, r.to_postal, r.one_way_amount, r.note
FROM pay.wage_rule_versions v
JOIN pay.wage_rule_special_routes r ON r.version_id = 1
WHERE v.effective_from = DATE '2026-11-15';

INSERT INTO pay.wage_rule_prices(version_id, driver_id, unit, from_class, to_class, operation, label, driver_amount, owner_amount)
SELECT v.id, s.driver_id, s.unit, s.from_class, s.to_class, s.operation, s.label, s.driver_amount, s.owner_amount
FROM pay.wage_rule_versions v
JOIN (VALUES
  (NULL::bigint, 'LEG',        'STK',      'AMAZON_A', NULL,   'ST → A类仓',        110.00, 140.00),
  (NULL::bigint, 'LEG',        'STK',      'AMAZON_B', NULL,   'ST → B类仓',         90.00, 120.00),
  (NULL::bigint, 'LEG',        'HW',       'SHIPPER',  NULL,   'HW ↔ Shipper',       90.00, 120.00),
  (NULL::bigint, 'LEG',        NULL,       'SHIPPER',  'PU',   '提柜 → Shipper',    110.00, 140.00),
  (NULL::bigint, 'LEG',        'SHIPPER',  NULL,       'EMPTY','Shipper → 还空',    110.00, 140.00),
  (NULL::bigint, 'ROUND_TRIP', NULL,       NULL,       NULL,   '东湾海柜一圈',       200.00, NULL),
  (NULL::bigint, 'DAY',        NULL,       NULL,       NULL,   '海柜日结',           410.00, NULL)
) AS s(driver_id, unit, from_class, to_class, operation, label, driver_amount, owner_amount) ON TRUE
WHERE v.effective_from = DATE '2026-11-15';

COMMIT;
