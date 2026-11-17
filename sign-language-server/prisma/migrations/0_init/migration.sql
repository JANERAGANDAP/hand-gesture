-- CreateTable
CREATE TABLE "AISentenceHistory" (
    "id" SERIAL NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'FSL',
    "rawGestureInput" TEXT NOT NULL,
    "composedSentence" TEXT NOT NULL,
    "normalizedInput" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AISentenceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Keyword" (
    "id" SERIAL NOT NULL,
    "language" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Keyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelTraining" (
    "id" SERIAL NOT NULL,
    "modelName" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "precision" DOUBLE PRECISION,
    "recall" DOUBLE PRECISION,
    "f1Score" DOUBLE PRECISION,
    "trainingSamples" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelTraining_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecognitionLog" (
    "id" SERIAL NOT NULL,
    "predictedWord" TEXT,
    "confidence" DOUBLE PRECISION,
    "features" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecognitionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignGesture" (
    "id" SERIAL NOT NULL,
    "word" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'FSL',
    "gestureType" TEXT NOT NULL DEFAULT 'dynamic',
    "features" JSONB NOT NULL,
    "sequence" JSONB,
    "frameCount" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignGesture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeechSign" (
    "id" SERIAL NOT NULL,
    "word" TEXT NOT NULL,
    "file" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpeechSign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AISentenceHistory_language_idx" ON "AISentenceHistory"("language" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Keyword_language_keyword_key" ON "Keyword"("language" ASC, "keyword" ASC);

-- CreateIndex
CREATE INDEX "RecognitionLog_predictedWord_idx" ON "RecognitionLog"("predictedWord" ASC);

-- CreateIndex
CREATE INDEX "SignGesture_gestureType_idx" ON "SignGesture"("gestureType" ASC);

-- CreateIndex
CREATE INDEX "SignGesture_isActive_idx" ON "SignGesture"("isActive" ASC);

-- CreateIndex
CREATE INDEX "SignGesture_language_idx" ON "SignGesture"("language" ASC);

-- CreateIndex
CREATE INDEX "SignGesture_word_idx" ON "SignGesture"("word" ASC);

-- CreateIndex
CREATE INDEX "SpeechSign_word_idx" ON "SpeechSign"("word" ASC);

