-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "jti" TEXT NOT NULL PRIMARY KEY,
    "sub" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "AgentProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "bizName" TEXT,
    "bizNo" TEXT,
    "contact" TEXT,
    "bizDocRef" TEXT,
    "activeRegion" TEXT NOT NULL,
    "scheduleText" TEXT NOT NULL,
    "reputation" INTEGER NOT NULL,
    "lat" REAL,
    "lng" REAL
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "requestId" TEXT,
    "status" TEXT NOT NULL,
    "chatThreadId" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "dealMethod" TEXT
);

-- CreateTable
CREATE TABLE "Request" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "options" TEXT,
    "hopePrice" INTEGER NOT NULL,
    "deadline" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "adoptedBy" TEXT,
    "matchId" TEXT,
    "vpPrice" INTEGER,
    "vpAgentId" TEXT,
    "vpVerifiedAt" TEXT,
    "vpNote" TEXT
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "threadId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "DiscountPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "authorId" TEXT NOT NULL,
    "storeBrand" TEXT NOT NULL,
    "discountRate" INTEGER,
    "discountPrice" INTEGER,
    "listPrice" INTEGER,
    "unverifiedBase" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "photo" TEXT,
    "createdAt" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "lat" REAL,
    "lng" REAL
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matchId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Badge" (
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "grantedAt" TEXT NOT NULL,

    PRIMARY KEY ("userId", "type")
);

-- CreateTable
CREATE TABLE "Bounty" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requesterId" TEXT NOT NULL,
    "mission" TEXT NOT NULL,
    "status" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "BountySubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bountyId" TEXT NOT NULL,
    "solverId" TEXT NOT NULL,
    "photo" TEXT,
    "createdAt" TEXT NOT NULL,
    "badgeAwarded" BOOLEAN NOT NULL
);

-- CreateTable
CREATE TABLE "GroupSlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "scheduleText" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "joinedCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AgentProfile_ownerUserId_key" ON "AgentProfile"("ownerUserId");
