-- Extensions first: skills.embedding needs the vector type.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateEnum
CREATE TYPE "Mode" AS ENUM ('ONLINE', 'IN_PERSON', 'BOTH');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "SwipeAction" AS ENUM ('LIKE', 'PASS', 'SUPER');

-- CreateEnum
CREATE TYPE "MatchType" AS ENUM ('SWAP', 'CREDIT', 'CHAIN');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('PROPOSED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "ChainStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "bio" TEXT,
    "city" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "mode" "Mode" NOT NULL DEFAULT 'BOTH',
    "languages" TEXT[],
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "google_id" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "rating_avg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "sessions_done" INTEGER NOT NULL DEFAULT 0,
    "no_show_count" INTEGER NOT NULL DEFAULT 0,
    "credits" INTEGER NOT NULL DEFAULT 2,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "onboarded" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_slots" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_min" INTEGER NOT NULL,
    "end_min" INTEGER NOT NULL,

    CONSTRAINT "availability_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "aliases" TEXT[],
    "embedding" vector(384),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_skill_haves" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "years" DOUBLE PRECISION,
    "proof_url" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "user_skill_haves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_skill_wants" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "current_level" INTEGER NOT NULL DEFAULT 1,
    "goal_level" INTEGER NOT NULL DEFAULT 3,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',

    CONSTRAINT "user_skill_wants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "swipes" (
    "id" TEXT NOT NULL,
    "swiper_id" TEXT NOT NULL,
    "swiped_id" TEXT NOT NULL,
    "action" "SwipeAction" NOT NULL,
    "score" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "swipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" TEXT NOT NULL,
    "user_a_id" TEXT NOT NULL,
    "user_b_id" TEXT NOT NULL,
    "type" "MatchType" NOT NULL,
    "score" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_msg_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocks" (
    "id" TEXT NOT NULL,
    "blocker_id" TEXT NOT NULL,
    "blocked_id" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "reported_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "match_id" TEXT,
    "teacher_id" TEXT NOT NULL,
    "learner_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "duration_min" INTEGER NOT NULL DEFAULT 60,
    "mode" "Mode" NOT NULL,
    "meeting_url" TEXT,
    "location" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'PROPOSED',
    "reminder_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "reviewer_id" TEXT NOT NULL,
    "reviewee_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_tx" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "session_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_tx_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "swap_chains" (
    "id" TEXT NOT NULL,
    "status" "ChainStatus" NOT NULL DEFAULT 'PROPOSED',
    "score" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "swap_chains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chain_members" (
    "id" TEXT NOT NULL,
    "chain_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "teach_skill" TEXT NOT NULL,
    "accepted" BOOLEAN,

    CONSTRAINT "chain_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");

-- CreateIndex
CREATE INDEX "users_city_idx" ON "users"("city");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "availability_slots_user_id_day_of_week_idx" ON "availability_slots"("user_id", "day_of_week");

-- CreateIndex
CREATE UNIQUE INDEX "skills_name_key" ON "skills"("name");

-- CreateIndex
CREATE UNIQUE INDEX "skills_slug_key" ON "skills"("slug");

-- CreateIndex
CREATE INDEX "user_skill_haves_skill_id_level_idx" ON "user_skill_haves"("skill_id", "level");

-- CreateIndex
CREATE UNIQUE INDEX "user_skill_haves_user_id_skill_id_key" ON "user_skill_haves"("user_id", "skill_id");

-- CreateIndex
CREATE INDEX "user_skill_wants_skill_id_idx" ON "user_skill_wants"("skill_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_skill_wants_user_id_skill_id_key" ON "user_skill_wants"("user_id", "skill_id");

-- CreateIndex
CREATE INDEX "swipes_swiped_id_action_idx" ON "swipes"("swiped_id", "action");

-- CreateIndex
CREATE UNIQUE INDEX "swipes_swiper_id_swiped_id_key" ON "swipes"("swiper_id", "swiped_id");

-- CreateIndex
CREATE UNIQUE INDEX "matches_user_a_id_user_b_id_key" ON "matches"("user_a_id", "user_b_id");

-- CreateIndex
CREATE INDEX "messages_match_id_created_at_idx" ON "messages"("match_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "blocks_blocker_id_blocked_id_key" ON "blocks"("blocker_id", "blocked_id");

-- CreateIndex
CREATE INDEX "reports_reported_id_idx" ON "reports"("reported_id");

-- CreateIndex
CREATE INDEX "sessions_teacher_id_starts_at_idx" ON "sessions"("teacher_id", "starts_at");

-- CreateIndex
CREATE INDEX "sessions_learner_id_starts_at_idx" ON "sessions"("learner_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_session_id_reviewer_id_key" ON "reviews"("session_id", "reviewer_id");

-- CreateIndex
CREATE INDEX "credit_tx_user_id_created_at_idx" ON "credit_tx"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "chain_members_chain_id_user_id_key" ON "chain_members"("chain_id", "user_id");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_slots" ADD CONSTRAINT "availability_slots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_skill_haves" ADD CONSTRAINT "user_skill_haves_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_skill_haves" ADD CONSTRAINT "user_skill_haves_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_skill_wants" ADD CONSTRAINT "user_skill_wants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_skill_wants" ADD CONSTRAINT "user_skill_wants_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swipes" ADD CONSTRAINT "swipes_swiper_id_fkey" FOREIGN KEY ("swiper_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swipes" ADD CONSTRAINT "swipes_swiped_id_fkey" FOREIGN KEY ("swiped_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_a_id_fkey" FOREIGN KEY ("user_a_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_b_id_fkey" FOREIGN KEY ("user_b_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reported_id_fkey" FOREIGN KEY ("reported_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_learner_id_fkey" FOREIGN KEY ("learner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewee_id_fkey" FOREIGN KEY ("reviewee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_tx" ADD CONSTRAINT "credit_tx_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_tx" ADD CONSTRAINT "credit_tx_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chain_members" ADD CONSTRAINT "chain_members_chain_id_fkey" FOREIGN KEY ("chain_id") REFERENCES "swap_chains"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chain_members" ADD CONSTRAINT "chain_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chain_members" ADD CONSTRAINT "chain_members_teach_skill_fkey" FOREIGN KEY ("teach_skill") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
