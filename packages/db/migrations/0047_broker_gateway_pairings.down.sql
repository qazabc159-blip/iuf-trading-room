-- down migration: 0047_broker_gateway_pairings
-- Clean DROP — additive-only forward migration, no other table references this one.
-- Safe: removes only the broker_gateway_pairings table and its indexes (indexes
-- are dropped automatically with the table). No customer credentials were ever
-- stored here, so no sensitive-data residue concern on teardown.
DROP TABLE IF EXISTS broker_gateway_pairings;
