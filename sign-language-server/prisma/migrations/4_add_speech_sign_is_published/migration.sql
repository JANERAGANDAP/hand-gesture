-- Staging gate for Sign Library uploads: false hides the row from
-- STUDENT-role GET /api/signs requests while TEACHER/ADMIN still see it.
-- Defaults true so existing rows and any caller that doesn't send
-- `publish` keep today's "instant" behavior — no data backfill needed.
ALTER TABLE "SpeechSign" ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT true;
