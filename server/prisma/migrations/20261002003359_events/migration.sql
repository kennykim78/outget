-- CreateTable
CREATE TABLE "EventLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "ts" TEXT NOT NULL,
    "animalTypeId" TEXT,
    "props" TEXT NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "receivedDate" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "EventLog_name_receivedDate_idx" ON "EventLog"("name", "receivedDate");

-- CreateIndex
CREATE INDEX "EventLog_sessionKey_idx" ON "EventLog"("sessionKey");
