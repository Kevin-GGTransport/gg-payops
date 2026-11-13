-- G&G PayOps
-- 0018: seed the full USPS state list into ops.state_codes. The table only
--       held CA/NV, so any location outside those two states (GEG2/BFI3/PDX7
--       …) violated locations_state_code_fkey - the map picker made this
--       trivially reachable. Idempotent: ON CONFLICT DO NOTHING.

BEGIN;

INSERT INTO ops.state_codes (code, name, country_code, is_active) VALUES
  ('AL', 'Alabama', 'US', true),
  ('AK', 'Alaska', 'US', true),
  ('AZ', 'Arizona', 'US', true),
  ('AR', 'Arkansas', 'US', true),
  ('CA', 'California', 'US', true),
  ('CO', 'Colorado', 'US', true),
  ('CT', 'Connecticut', 'US', true),
  ('DE', 'Delaware', 'US', true),
  ('DC', 'District of Columbia', 'US', true),
  ('FL', 'Florida', 'US', true),
  ('GA', 'Georgia', 'US', true),
  ('HI', 'Hawaii', 'US', true),
  ('ID', 'Idaho', 'US', true),
  ('IL', 'Illinois', 'US', true),
  ('IN', 'Indiana', 'US', true),
  ('IA', 'Iowa', 'US', true),
  ('KS', 'Kansas', 'US', true),
  ('KY', 'Kentucky', 'US', true),
  ('LA', 'Louisiana', 'US', true),
  ('ME', 'Maine', 'US', true),
  ('MD', 'Maryland', 'US', true),
  ('MA', 'Massachusetts', 'US', true),
  ('MI', 'Michigan', 'US', true),
  ('MN', 'Minnesota', 'US', true),
  ('MS', 'Mississippi', 'US', true),
  ('MO', 'Missouri', 'US', true),
  ('MT', 'Montana', 'US', true),
  ('NE', 'Nebraska', 'US', true),
  ('NV', 'Nevada', 'US', true),
  ('NH', 'New Hampshire', 'US', true),
  ('NJ', 'New Jersey', 'US', true),
  ('NM', 'New Mexico', 'US', true),
  ('NY', 'New York', 'US', true),
  ('NC', 'North Carolina', 'US', true),
  ('ND', 'North Dakota', 'US', true),
  ('OH', 'Ohio', 'US', true),
  ('OK', 'Oklahoma', 'US', true),
  ('OR', 'Oregon', 'US', true),
  ('PA', 'Pennsylvania', 'US', true),
  ('RI', 'Rhode Island', 'US', true),
  ('SC', 'South Carolina', 'US', true),
  ('SD', 'South Dakota', 'US', true),
  ('TN', 'Tennessee', 'US', true),
  ('TX', 'Texas', 'US', true),
  ('UT', 'Utah', 'US', true),
  ('VT', 'Vermont', 'US', true),
  ('VA', 'Virginia', 'US', true),
  ('WA', 'Washington', 'US', true),
  ('WV', 'West Virginia', 'US', true),
  ('WI', 'Wisconsin', 'US', true),
  ('WY', 'Wyoming', 'US', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO common._migrations (name)
SELECT '0018_us_states'
WHERE NOT EXISTS (SELECT 1 FROM common._migrations WHERE name = '0018_us_states');

COMMIT;
