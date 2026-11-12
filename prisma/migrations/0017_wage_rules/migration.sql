-- G&G PayOps
-- 0017: wage rule versions, replacing the hardcoded tiers in src/lib/wage.ts.
--       Source of truth: paper spec 司机工资明细算法 CA Local V1.02406
--       (effective 2026-06-01). One row per version keyed by effective_from
--       (unique); tier rows store driver-price bands (the paper's owner column
--       is exactly 2x, so a multiplier covers it); overage_increment is added
--       per 50mi past the top tier; special routes are fixed-price postal
--       pairs (94545<->99301 Washington run, one-way $550 = half of the
--       $1100 round trip; a leg that stops midway simply falls back to tiers).
--       Idempotent: CREATE IF NOT EXISTS + NOT EXISTS guards on seed rows.

BEGIN;

CREATE TABLE IF NOT EXISTS pay.wage_rule_versions (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name               varchar(120) NOT NULL,
  effective_from     date NOT NULL,
  owner_multiplier   numeric(5,2)  NOT NULL DEFAULT 2.00,
  bobtail_multiplier numeric(5,2)  NOT NULL DEFAULT 0.50,
  overage_increment  numeric(12,2) NOT NULL DEFAULT 30.00,
  status             varchar(16)   NOT NULL DEFAULT 'ACTIVE',
  notes              varchar(255),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_wage_rule_effective UNIQUE (effective_from)
);

CREATE TABLE IF NOT EXISTS pay.wage_rule_tiers (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  version_id bigint NOT NULL REFERENCES pay.wage_rule_versions(id) ON DELETE CASCADE,
  miles_from int NOT NULL CHECK (miles_from >= 1),
  amount     numeric(12,2) NOT NULL CHECK (amount >= 0),
  CONSTRAINT uq_wage_tier_version_miles UNIQUE (version_id, miles_from)
);

CREATE TABLE IF NOT EXISTS pay.wage_rule_special_routes (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  version_id     bigint NOT NULL REFERENCES pay.wage_rule_versions(id) ON DELETE CASCADE,
  from_postal    varchar(10) NOT NULL,
  to_postal      varchar(10) NOT NULL,
  one_way_amount numeric(12,2) NOT NULL CHECK (one_way_amount >= 0),
  note           varchar(255)
);
CREATE INDEX IF NOT EXISTS idx_wage_special_routes_version
  ON pay.wage_rule_special_routes(version_id);

-- Seed: the paper spec, verbatim (driver-price bands)
INSERT INTO pay.wage_rule_versions(name, effective_from, owner_multiplier, bobtail_multiplier, overage_increment, notes)
SELECT 'CA Local 2026-06 版', DATE '2026-06-01', 2.00, 0.50, 30.00,
       '纸质《司机工资明细算法 CA Local V1.02406》初始导入'
WHERE NOT EXISTS (SELECT 1 FROM pay.wage_rule_versions WHERE effective_from = DATE '2026-06-01');

INSERT INTO pay.wage_rule_tiers(version_id, miles_from, amount)
SELECT v.id, t.miles_from, t.amount
FROM pay.wage_rule_versions v
JOIN (VALUES (1, 50.00), (50, 80.00), (100, 120.00), (150, 150.00), (200, 180.00), (250, 210.00)
) AS t(miles_from, amount) ON true
WHERE v.effective_from = DATE '2026-06-01'
  AND NOT EXISTS (
    SELECT 1 FROM pay.wage_rule_tiers tt
    WHERE tt.version_id = v.id AND tt.miles_from = t.miles_from
  );

INSERT INTO pay.wage_rule_special_routes(version_id, from_postal, to_postal, one_way_amount, note)
SELECT v.id, '94545', '99301', 550.00,
       '华盛顿线：来回 $1100（2×单程）；中途提卸货按实际迈数落里程档'
FROM pay.wage_rule_versions v
WHERE v.effective_from = DATE '2026-06-01'
  AND NOT EXISTS (
    SELECT 1 FROM pay.wage_rule_special_routes r
    WHERE r.version_id = v.id AND r.from_postal = '94545' AND r.to_postal = '99301'
  );

COMMIT;
