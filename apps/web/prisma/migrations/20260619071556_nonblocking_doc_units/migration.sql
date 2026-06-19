-- AlterTable
ALTER TABLE "DocUnit" ADD COLUMN     "jobId" TEXT,
ALTER COLUMN "walrusBlobId" DROP NOT NULL;
