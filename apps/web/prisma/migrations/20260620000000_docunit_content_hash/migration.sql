-- Add content hash to DocUnit for in-place upsert / dedup of DB + Walrus writes
ALTER TABLE "DocUnit" ADD COLUMN "contentHash" TEXT;

-- Index used to match an incoming unit against existing rows of the same document
CREATE INDEX "DocUnit_documentId_contentHash_idx" ON "DocUnit"("documentId", "contentHash");
