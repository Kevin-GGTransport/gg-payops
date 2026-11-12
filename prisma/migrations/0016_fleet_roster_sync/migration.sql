-- G&G PayOps
-- 0016: fleet roster sync from the dispatch sheet (2026-11-12).
--       Drivers: replace placeholder D-codes with real truck numbers, fix
--       names and types per sheet (purple truck code = owner-operated,
--       black = company truck); merge the junk placeholder driver whose
--       full_name was literally the truck code "0608" (same person as
--       刘志豪, id 19; no trips referenced it).
--       Trucks: register all 22 trucks, each with an open ownership row
--       (NULL owner = company-owned, per 0014 convention).
--       Fleet name from column A is kept in notes on both sides.
--       Idempotent: UPDATEs re-apply harmlessly, INSERTs skip existing keys.

BEGIN;

DELETE FROM ops.drivers WHERE id = 20 AND driver_code = 'D020';

UPDATE ops.drivers SET driver_code='877',  full_name='张晓澄',      driver_type='DRIVER'::ops.driver_type, notes='车队：G&G',                   updated_at=now() WHERE id=1;
UPDATE ops.drivers SET driver_code='118',  full_name='赵胜峰',      driver_type='DRIVER'::ops.driver_type, notes='车队：Kinda；照片备注 10/16',  updated_at=now() WHERE id=2;
UPDATE ops.drivers SET driver_code='907',  full_name='郭晓光',      driver_type='DRIVER'::ops.driver_type, notes='车队：Old Pal',               updated_at=now() WHERE id=3;
UPDATE ops.drivers SET driver_code='3183', full_name='薛彦明',      driver_type='DRIVER'::ops.driver_type, notes='车队：G&G',                   updated_at=now() WHERE id=4;
UPDATE ops.drivers SET driver_code='3651', full_name='张华明',      driver_type='DRIVER'::ops.driver_type, notes='车队：Kinda',                 updated_at=now() WHERE id=5;
UPDATE ops.drivers SET driver_code='0527', full_name='邓嘉毅Jay D', driver_type='OWNER'::ops.driver_type,  notes='车队：OS',                    updated_at=now() WHERE id=6;
UPDATE ops.drivers SET driver_code='901',  full_name='吴家健',      driver_type='DRIVER'::ops.driver_type, notes='车队：Rightway',              updated_at=now() WHERE id=8;
UPDATE ops.drivers SET driver_code='777',  full_name='李忆豪',      driver_type='DRIVER'::ops.driver_type, notes='车队：Old Pal',               updated_at=now() WHERE id=9;
UPDATE ops.drivers SET driver_code='2113', full_name='刘嘉耀',      driver_type='DRIVER'::ops.driver_type, notes='车队：AA',                    updated_at=now() WHERE id=10;
UPDATE ops.drivers SET driver_code='007',  full_name='刘洪',        driver_type='DRIVER'::ops.driver_type, notes='车队：Old Pal',               updated_at=now() WHERE id=11;
UPDATE ops.drivers SET driver_code='168',  full_name='陈炳中Don',   driver_type='OWNER'::ops.driver_type,  notes='车队：D&T',                   updated_at=now() WHERE id=12;
UPDATE ops.drivers SET driver_code='505',  full_name='施宇杰',      driver_type='OWNER'::ops.driver_type,  notes='车队：JCB',                   updated_at=now() WHERE id=13;
UPDATE ops.drivers SET driver_code='19',   full_name='肖雪冬Marco', driver_type='OWNER'::ops.driver_type,  notes='车队：HE',                    updated_at=now() WHERE id=14;
UPDATE ops.drivers SET driver_code='8',    full_name='冯学飞',      driver_type='OWNER'::ops.driver_type,  notes='车队：KM',                    updated_at=now() WHERE id=15;
-- no truck yet (暂无): keep the placeholder code until a truck is assigned
UPDATE ops.drivers SET                          full_name='钟兴海', driver_type='OWNER'::ops.driver_type,  notes='车队：JIN AO（暂无车）',       updated_at=now() WHERE id=16;
UPDATE ops.drivers SET                          full_name='杨凯民', driver_type='OWNER'::ops.driver_type,  notes='车队：KMY（暂无车）',         updated_at=now() WHERE id=17;
UPDATE ops.drivers SET driver_code='2109', full_name='姚义红',      driver_type='DRIVER'::ops.driver_type, notes='车队：Kinda',                 updated_at=now() WHERE id=18;
UPDATE ops.drivers SET driver_code='0608', full_name='刘志豪',      driver_type='OWNER'::ops.driver_type,  notes='车队：G&G',                   updated_at=now() WHERE id=19;
UPDATE ops.drivers SET driver_code='3033', full_name='David高',     driver_type='DRIVER'::ops.driver_type, notes='车队：XiangYun；不能上长途',   updated_at=now() WHERE id=21;
UPDATE ops.drivers SET driver_code='1688', full_name='许建强John',  driver_type='DRIVER'::ops.driver_type, notes='车队：YG；原录入名 John油税',  updated_at=now() WHERE id=23;

INSERT INTO ops.drivers(driver_code, full_name, driver_type, notes) VALUES
  ('16',     '李屈',   'DRIVER'::ops.driver_type, '车队：Helo'),
  ('905',    '李伟权', 'DRIVER'::ops.driver_type, '车队：AA'),
  ('909',    '翁浩德', 'DRIVER'::ops.driver_type, '车队：Old Pal-Helo'),
  ('拾壹11', '乔鸿恩', 'DRIVER'::ops.driver_type, '车队：Ruizheng')
ON CONFLICT (driver_code) DO NOTHING;

INSERT INTO ops.trucks(truck_code, notes) VALUES
  ('16',    '车队：Helo'),
  ('905',   '车队：AA'),
  ('909',   '车队：Old Pal-Helo'),
  ('3033',  '车队：XiangYun'),
  ('877',   '车队：G&G'),
  ('2109',  '车队：Kinda'),
  ('3183',  '车队：G&G'),
  ('2113',  '车队：AA'),
  ('118',   '车队：Kinda'),
  ('3651',  '车队：Kinda'),
  ('777',   '车队：Old Pal'),
  ('907',   '车队：Old Pal'),
  ('007',   '车队：Old Pal'),
  ('901',   '车队：Rightway'),
  ('1688',  '车队：YG'),
  ('0527',  '车队：OS'),
  ('8',     '车队：KM'),
  ('168',   '车队：D&T'),
  ('505',   '车队：JCB'),
  ('19',    '车队：HE'),
  ('0608',  '车队：G&G'),
  ('拾壹11', '车队：Ruizheng')
ON CONFLICT (truck_code) DO NOTHING;

-- Owner-operated trucks (purple codes): open row pointing at the owner driver
INSERT INTO ops.truck_ownerships(truck_id, owner_driver_id, valid_from)
SELECT t.id, d.id, DATE '2026-11-12'
FROM ops.trucks t
JOIN ops.drivers d ON d.driver_code = t.truck_code
WHERE t.truck_code IN ('0527', '8', '168', '505', '19', '0608')
  AND NOT EXISTS (
    SELECT 1 FROM ops.truck_ownerships o WHERE o.truck_id = t.id AND o.valid_to IS NULL
  );

-- Company trucks (black codes): open row with NULL owner
INSERT INTO ops.truck_ownerships(truck_id, owner_driver_id, valid_from)
SELECT t.id, NULL, DATE '2026-11-12'
FROM ops.trucks t
WHERE t.truck_code NOT IN ('0527', '8', '168', '505', '19', '0608')
  AND NOT EXISTS (
    SELECT 1 FROM ops.truck_ownerships o WHERE o.truck_id = t.id AND o.valid_to IS NULL
  );

COMMIT;
