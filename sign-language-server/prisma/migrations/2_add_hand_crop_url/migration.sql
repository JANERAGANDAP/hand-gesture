-- AlterTable
-- Adds the cropped hand-shape image URL used to train the CNN hand-shape
-- classifier (Phase 1 of CNN integration). Nullable: existing gesture rows
-- were recorded before this capture step and remain DTW-only.
ALTER TABLE "SignGesture" ADD COLUMN "handCropUrl" TEXT;
