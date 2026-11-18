CREATE TABLE "Gesture" (
    "id" SERIAL NOT NULL,
    "word" TEXT NOT NULL,
    "wordKey" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'English',
    "translations" JSONB NOT NULL DEFAULT '{}'::JSONB,
    "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Gesture_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Gesture_wordKey_key" ON "Gesture"("wordKey");
ALTER TABLE "SpeechSign" RENAME TO "SignAsset";
ALTER TABLE "SignAsset" RENAME CONSTRAINT "SpeechSign_pkey" TO "SignAsset_pkey";
ALTER INDEX "SpeechSign_word_idx" RENAME TO "SignAsset_word_idx";
ALTER TABLE "SignGesture" ADD COLUMN "gestureId" INTEGER;
ALTER TABLE "SignAsset" ADD COLUMN "gestureId" INTEGER;

WITH labels AS (
    SELECT
        "word",
        btrim(regexp_replace(regexp_replace(lower(btrim("word")), '[^a-z0-9 ]', '', 'g'), '[[:space:]]+', ' ', 'g')) AS "wordKey",
        COALESCE(NULLIF("language", ''), 'FSL') AS "language",
        1 AS priority
    FROM "SignGesture"
    UNION ALL
    SELECT
        s."word",
        btrim(regexp_replace(regexp_replace(lower(btrim(s."word")), '[^a-z0-9 ]', '', 'g'), '[[:space:]]+', ' ', 'g')) AS "wordKey",
        COALESCE(
            (SELECT k."language" FROM "Keyword" k WHERE k."keyword" = s."word" ORDER BY k."id" LIMIT 1),
            'English'
        ) AS "language",
        0 AS priority
    FROM "SignAsset" s
),
unique_labels AS (
    SELECT DISTINCT ON ("wordKey") "word", "wordKey", "language"
    FROM labels
    WHERE "wordKey" <> ''
    ORDER BY "wordKey", priority, "word"
)
INSERT INTO "Gesture" ("word", "wordKey", "language", "aliases", "updatedAt")
SELECT "word", "wordKey", "language", ARRAY["word"]::TEXT[], CURRENT_TIMESTAMP
FROM unique_labels
ON CONFLICT ("wordKey") DO NOTHING;

UPDATE "SignGesture" s
SET "gestureId" = g."id"
FROM "Gesture" g
WHERE g."wordKey" = btrim(regexp_replace(regexp_replace(lower(btrim(s."word")), '[^a-z0-9 ]', '', 'g'), '[[:space:]]+', ' ', 'g'));

UPDATE "SignAsset" s
SET "gestureId" = g."id"
FROM "Gesture" g
WHERE g."wordKey" = btrim(regexp_replace(regexp_replace(lower(btrim(s."word")), '[^a-z0-9 ]', '', 'g'), '[[:space:]]+', ' ', 'g'));

CREATE INDEX "Gesture_word_idx" ON "Gesture"("word");
CREATE INDEX "Gesture_language_idx" ON "Gesture"("language");
CREATE INDEX "Gesture_isActive_idx" ON "Gesture"("isActive");
CREATE INDEX "SignGesture_gestureId_idx" ON "SignGesture"("gestureId");
CREATE INDEX "SignAsset_gestureId_idx" ON "SignAsset"("gestureId");

ALTER TABLE "SignGesture"
ADD CONSTRAINT "SignGesture_gestureId_fkey"
FOREIGN KEY ("gestureId") REFERENCES "Gesture"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SignAsset"
ADD CONSTRAINT "SignAsset_gestureId_fkey"
FOREIGN KEY ("gestureId") REFERENCES "Gesture"("id") ON DELETE SET NULL ON UPDATE CASCADE;
