-- New default role for self-registered/Google users is STUDENT, not TEACHER.
-- Existing rows are untouched (their explicit role stays whatever it was);
-- this only changes the column default for future inserts.
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'STUDENT';

-- Admin-controlled allowlist. A row here promotes that email to TEACHER
-- the next time it registers or signs in with Google.
CREATE TABLE "TeacherInvite" (
    "id" SERIAL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "invitedBy" TEXT,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "TeacherInvite_email_key" ON "TeacherInvite"("email");
