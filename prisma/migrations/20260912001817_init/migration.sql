-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('QUEUED', 'CRAWLING', 'EXTRACTING', 'QUESTIONING', 'INTERROGATING', 'ADJUDICATING', 'SCORING', 'REMEDIATING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "PageStatus" AS ENUM ('OK', 'HTTP_ERROR', 'BLOCKED_BY_ROBOTS', 'EXTRACT_EMPTY', 'TIMEOUT', 'FETCH_FAILED');

-- CreateEnum
CREATE TYPE "FactCategory" AS ENUM ('PRICING', 'ELIGIBILITY', 'LIMITS', 'COMPATIBILITY', 'API', 'GENERAL');

-- CreateEnum
CREATE TYPE "Condition" AS ENUM ('MEMORY', 'BROWSING');

-- CreateEnum
CREATE TYPE "Ruling" AS ENUM ('CONFIRMED', 'DRIFTED', 'FABRICATED', 'UNSUPPORTED');

-- CreateEnum
CREATE TYPE "RemediationKind" AS ENUM ('LLMS_TXT', 'JSON_LD', 'PAGE_COPY');

-- CreateEnum
CREATE TYPE "ScanMode" AS ENUM ('DEMO', 'FREE', 'BYOK');

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('GOOGLE', 'GROQ', 'ANTHROPIC', 'OPENAI');

-- CreateEnum
CREATE TYPE "PipelineStage" AS ENUM ('TRIAGE', 'FACTS', 'QUESTIONS', 'ANSWER_MEMORY', 'ANSWER_BROWSING', 'CLAIMS', 'ADJUDICATE', 'REMEDIATE', 'SEARCH', 'VALIDATE_KEY');

-- CreateTable
CREATE TABLE "Scan" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "status" "ScanStatus" NOT NULL DEFAULT 'QUEUED',
    "parityScore" DOUBLE PRECISION,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "error" TEXT,
    "mode" "ScanMode" NOT NULL DEFAULT 'FREE',
    "clientHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Scan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "extractedText" TEXT,
    "status" "PageStatus" NOT NULL DEFAULT 'OK',
    "httpStatus" INTEGER,
    "error" TEXT,
    "priority" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "factsDropped" INTEGER NOT NULL DEFAULT 0,
    "factsExtractedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fact" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "category" "FactCategory" NOT NULL DEFAULT 'GENERAL',
    "evidenceSpan" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "evidenceVerified" BOOLEAN NOT NULL DEFAULT true,
    "evidenceOffset" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "targetFactIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category" "FactCategory" NOT NULL DEFAULT 'GENERAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "parityScore" DOUBLE PRECISION,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Answer" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "condition" "Condition" NOT NULL,
    "rawText" TEXT,
    "latencyMs" INTEGER,
    "error" TEXT,
    "retrieval" JSONB,
    "searchQuery" TEXT,
    "claimsExtractedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Answer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verdict" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "ruling" "Ruling" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "citedFactId" TEXT,
    "evidenceQuote" TEXT,
    "reasoning" TEXT NOT NULL,
    "downgraded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Verdict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Remediation" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "verdictId" TEXT NOT NULL,
    "kind" "RemediationKind" NOT NULL,
    "content" TEXT NOT NULL,
    "targetUrl" TEXT,
    "rationale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Remediation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmCall" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "runId" TEXT,
    "stage" "PipelineStage" NOT NULL,
    "provider" "Provider" NOT NULL,
    "model" TEXT NOT NULL,
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "costUsd" DOUBLE PRECISION,
    "latencyMs" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmCache" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "namespace" TEXT NOT NULL DEFAULT 'v1',
    "model" TEXT NOT NULL,
    "schemaName" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Scan_createdAt_idx" ON "Scan"("createdAt");

-- CreateIndex
CREATE INDEX "Scan_mode_idx" ON "Scan"("mode");

-- CreateIndex
CREATE INDEX "Scan_clientHash_idx" ON "Scan"("clientHash");

-- CreateIndex
CREATE INDEX "Page_scanId_status_idx" ON "Page"("scanId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Page_scanId_url_key" ON "Page"("scanId", "url");

-- CreateIndex
CREATE INDEX "Fact_scanId_category_idx" ON "Fact"("scanId", "category");

-- CreateIndex
CREATE INDEX "Fact_pageId_idx" ON "Fact"("pageId");

-- CreateIndex
CREATE INDEX "Question_scanId_idx" ON "Question"("scanId");

-- CreateIndex
CREATE UNIQUE INDEX "Run_scanId_index_key" ON "Run"("scanId", "index");

-- CreateIndex
CREATE INDEX "Answer_runId_idx" ON "Answer"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "Answer_runId_questionId_model_condition_key" ON "Answer"("runId", "questionId", "model", "condition");

-- CreateIndex
CREATE INDEX "Claim_answerId_idx" ON "Claim"("answerId");

-- CreateIndex
CREATE UNIQUE INDEX "Verdict_claimId_key" ON "Verdict"("claimId");

-- CreateIndex
CREATE INDEX "Verdict_ruling_idx" ON "Verdict"("ruling");

-- CreateIndex
CREATE INDEX "Remediation_scanId_idx" ON "Remediation"("scanId");

-- CreateIndex
CREATE INDEX "LlmCall_scanId_stage_idx" ON "LlmCall"("scanId", "stage");

-- CreateIndex
CREATE INDEX "LlmCall_scanId_cached_idx" ON "LlmCall"("scanId", "cached");

-- CreateIndex
CREATE INDEX "RateLimitBucket_windowStart_idx" ON "RateLimitBucket"("windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimitBucket_key_windowStart_key" ON "RateLimitBucket"("key", "windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "LlmCache_key_key" ON "LlmCache"("key");

-- CreateIndex
CREATE INDEX "LlmCache_namespace_idx" ON "LlmCache"("namespace");

-- CreateIndex
CREATE INDEX "LlmCache_createdAt_idx" ON "LlmCache"("createdAt");

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fact" ADD CONSTRAINT "Fact_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fact" ADD CONSTRAINT "Fact_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "Answer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Verdict" ADD CONSTRAINT "Verdict_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Verdict" ADD CONSTRAINT "Verdict_citedFactId_fkey" FOREIGN KEY ("citedFactId") REFERENCES "Fact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Remediation" ADD CONSTRAINT "Remediation_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Remediation" ADD CONSTRAINT "Remediation_verdictId_fkey" FOREIGN KEY ("verdictId") REFERENCES "Verdict"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmCall" ADD CONSTRAINT "LlmCall_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
