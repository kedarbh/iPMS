-- The requester can add free-text remarks on an advance, settlement or reimbursement.
ALTER TABLE "finance_request" ADD COLUMN "remarks" VARCHAR(1000);
