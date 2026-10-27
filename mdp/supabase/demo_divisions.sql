-- DEMO DATABASE ONLY (dupr-demo branch). Divisions that fit the DUPR test accounts' real ratings
-- (Nicolo 4.01, Meg 3.80, Izza 3.20, Rorie 2.99 as DUPR sent them today):
--   * Open 4.0+ takes any DUPR account, so Nicolo + anyone can register and pay (step 9).
--   * Pro 4.5+ needs DUPR+, so the DUPR access check refuses it (step 8).
update tournaments set divisions = '[
  {"name":"Pro 4.5+","min":4.5,"price":3500,"second_price":2600,"spots":16,"requires":"PREMIUM_L1"},
  {"name":"Open 4.0+","min":4.0,"price":3200,"second_price":2400,"spots":24},
  {"name":"Advanced 3.75","min":3.5,"max":3.75,"price":2800,"second_price":2100,"spots":24},
  {"name":"Intermediate 3.5","min":3.0,"max":3.5,"price":2800,"second_price":2100,"spots":32},
  {"name":"Novice 3.0","max":3.0,"price":2400,"second_price":1800,"spots":32},
  {"name":"Mixed 3.5","max":3.5,"gender":"X","price":2800,"second_price":2100,"spots":24}
]'::jsonb
where name = 'MDP Season 4';

select name, jsonb_array_length(divisions) as divisions from tournaments where name = 'MDP Season 4';
