-- AlterEnum
ALTER TYPE "ScanStatus" ADD VALUE 'INCOMPLETE';

-- AlterTable
ALTER TABLE "Scan" ADD COLUMN     "integrity" JSONB;
