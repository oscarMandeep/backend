-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "proposed_by_id" TEXT,
ADD COLUMN     "resolution_prompt_sent_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "credit_tx_user_id_session_id_reason_key" ON "credit_tx"("user_id", "session_id", "reason");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_proposed_by_id_fkey" FOREIGN KEY ("proposed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

