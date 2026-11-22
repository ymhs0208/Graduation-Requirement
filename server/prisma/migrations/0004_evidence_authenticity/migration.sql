ALTER TABLE "Threshold" ADD COLUMN "requiresPaperOriginal" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Submission" ADD COLUMN "certificateNumber" TEXT;
ALTER TABLE "Submission" ADD COLUMN "issuingBody" TEXT;
ALTER TABLE "Submission" ADD COLUMN "issuedOn" TIMESTAMP(3);
ALTER TABLE "Submission" ADD COLUMN "declaredAt" TIMESTAMP(3);
ALTER TABLE "Submission" ADD COLUMN "declarationIp" TEXT;
ALTER TABLE "Submission" ADD COLUMN "verifiedAt" TIMESTAMP(3);
ALTER TABLE "Submission" ADD COLUMN "verifiedById" TEXT;
ALTER TABLE "Submission" ADD COLUMN "verificationMethod" TEXT;
ALTER TABLE "Submission" ADD COLUMN "verificationNote" TEXT;

ALTER TABLE "Upload" ADD COLUMN "sha256" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Upload" ADD COLUMN "producer" TEXT;
ALTER TABLE "Upload" ADD COLUMN "creator" TEXT;
ALTER TABLE "Upload" ADD COLUMN "contentCreatedAt" TIMESTAMP(3);
ALTER TABLE "Upload" ADD COLUMN "contentModifiedAt" TIMESTAMP(3);
ALTER TABLE "Upload" ADD COLUMN "editedBySoftware" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Upload" ADD COLUMN "modifiedAfterCreate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Upload" ADD COLUMN "hasDigitalSignature" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Upload_sha256_idx" ON "Upload"("sha256");
CREATE INDEX "Submission_certificateNumber_idx" ON "Submission"("certificateNumber");

ALTER TABLE "Submission" ADD CONSTRAINT "Submission_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
