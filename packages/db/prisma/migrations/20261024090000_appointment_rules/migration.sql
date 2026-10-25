-- Appointment validation: reschedule history, who booked, per-consultant working hours.
-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "rescheduledFrom" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "hours" JSONB;

-- CreateIndex
CREATE INDEX "Appointment_tenantId_staffId_startsAt_idx" ON "Appointment"("tenantId", "staffId", "startsAt");
