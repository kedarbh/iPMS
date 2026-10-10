-- Whether the user goes through Axiom finance. False only for a Field Engineer
-- whose own company handles their advances and settlements; set at creation.
ALTER TABLE "user" ADD COLUMN "financeEnabled" boolean NOT NULL DEFAULT true;
