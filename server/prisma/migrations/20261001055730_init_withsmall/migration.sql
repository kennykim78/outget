-- CreateTable
CREATE TABLE "AnimalType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT,
    "group" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "aliases" TEXT NOT NULL DEFAULT '[]',
    "parentTypeId" TEXT,
    "taxonId" TEXT,
    "careProfileId" TEXT,
    "careOverrides" TEXT NOT NULL DEFAULT '{}',
    "mascot" TEXT,
    "oneLiner" TEXT,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "reviewStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "reviewerType" TEXT NOT NULL,
    "verifiedBy" TEXT,
    "verifiedAt" TEXT,
    "contentKind" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "AnimalType_taxonId_fkey" FOREIGN KEY ("taxonId") REFERENCES "Taxon" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AnimalType_careProfileId_fkey" FOREIGN KEY ("careProfileId") REFERENCES "CareProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Taxon" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scientificName" TEXT NOT NULL,
    "koreanName" TEXT NOT NULL,
    "rank" TEXT NOT NULL DEFAULT 'SPECIES',
    "legal" TEXT NOT NULL DEFAULT '{}',
    "revisionOf" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "reviewerType" TEXT NOT NULL,
    "verifiedBy" TEXT,
    "verifiedAt" TEXT,
    "contentKind" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '[]'
);

-- CreateTable
CREATE TABLE "TaxonLegalRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taxonId" TEXT NOT NULL,
    "legalGroup" TEXT,
    "citesAppendix" TEXT,
    "whitelistListed" BOOLEAN,
    "sourceUrl" TEXT NOT NULL,
    "sourceTitle" TEXT NOT NULL,
    "verifiedAt" TEXT NOT NULL,
    "effectiveFrom" TEXT NOT NULL,
    "effectiveTo" TEXT,
    CONSTRAINT "TaxonLegalRevision_taxonId_fkey" FOREIGN KEY ("taxonId") REFERENCES "Taxon" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CareProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "taxonIds" TEXT NOT NULL DEFAULT '[]',
    "axes" TEXT,
    "facts" TEXT NOT NULL DEFAULT '{}',
    "careNotes" TEXT NOT NULL DEFAULT '[]',
    "seasonal" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "reviewerType" TEXT NOT NULL,
    "verifiedBy" TEXT,
    "verifiedAt" TEXT,
    "contentKind" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '[]'
);

-- CreateTable
CREATE TABLE "SupplyItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "glyph" TEXT,
    "description" TEXT,
    "lifecycle" TEXT NOT NULL,
    "replaceCycleDays" INTEGER,
    "inspectCycleDays" INTEGER,
    "compatibleAlternativeIds" TEXT NOT NULL DEFAULT '[]',
    "specSchema" TEXT NOT NULL,
    "reviewStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "reviewerType" TEXT NOT NULL,
    "verifiedBy" TEXT,
    "verifiedAt" TEXT,
    "contentKind" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '[]'
);

-- CreateTable
CREATE TABLE "SupplyRequirement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "careProfileId" TEXT NOT NULL,
    "supplyItemId" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "notNowReason" TEXT,
    "orderHint" TEXT NOT NULL,
    "minSpec" TEXT NOT NULL,
    "recommendedSpec" TEXT,
    "why" TEXT NOT NULL,
    "caution" TEXT,
    "avoid" TEXT,
    "searchKeyword" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "reviewerType" TEXT NOT NULL,
    "verifiedBy" TEXT,
    "verifiedAt" TEXT,
    "contentKind" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "SupplyRequirement_careProfileId_fkey" FOREIGN KEY ("careProfileId") REFERENCES "CareProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SupplyRequirement_supplyItemId_fkey" FOREIGN KEY ("supplyItemId") REFERENCES "SupplyItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CompatibilityRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "careProfileId" TEXT,
    "a" TEXT NOT NULL,
    "b" TEXT NOT NULL,
    "rules" TEXT NOT NULL,
    "reviewStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "reviewerType" TEXT NOT NULL,
    "verifiedBy" TEXT,
    "verifiedAt" TEXT,
    "contentKind" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '[]'
);

-- CreateTable
CREATE TABLE "SetupBundle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "careProfileId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "glyph" TEXT,
    "purpose" TEXT,
    "note" TEXT,
    "estimatedRangeText" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "reviewerType" TEXT NOT NULL,
    "verifiedBy" TEXT,
    "verifiedAt" TEXT,
    "contentKind" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "SetupBundle_careProfileId_fkey" FOREIGN KEY ("careProfileId") REFERENCES "CareProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SetupBundleItem" (
    "bundleId" TEXT NOT NULL,
    "supplyItemId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "note" TEXT,

    PRIMARY KEY ("bundleId", "position"),
    CONSTRAINT "SetupBundleItem_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "SetupBundle" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SetupBundleItem_supplyItemId_fkey" FOREIGN KEY ("supplyItemId") REFERENCES "SupplyItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CuratedProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplyItemId" TEXT NOT NULL,
    "careProfileIds" TEXT NOT NULL DEFAULT '[]',
    "title" TEXT NOT NULL,
    "imageAsset" TEXT,
    "imageLicense" TEXT NOT NULL DEFAULT 'NONE',
    "specValues" TEXT NOT NULL DEFAULT '{}',
    "meetsMinSpec" BOOLEAN NOT NULL DEFAULT false,
    "eligibility" TEXT,
    "specVerifiedBy" TEXT,
    "specVerifiedAt" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REVIEW',
    "sponsored" BOOLEAN NOT NULL DEFAULT false,
    "disclosure" BOOLEAN NOT NULL DEFAULT false,
    "reviewStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "reviewerType" TEXT NOT NULL,
    "verifiedBy" TEXT,
    "verifiedAt" TEXT,
    "contentKind" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "CuratedProduct_supplyItemId_fkey" FOREIGN KEY ("supplyItemId") REFERENCES "SupplyItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VetClinic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "lat" REAL,
    "lng" REAL,
    "treats" TEXT NOT NULL DEFAULT '[]',
    "hours" TEXT,
    "night" BOOLEAN,
    "emergency" BOOLEAN,
    "source" TEXT NOT NULL DEFAULT 'SEED',
    "status" TEXT NOT NULL DEFAULT 'REPORTED',
    "verificationMethod" TEXT,
    "verifiedAt" TEXT,
    "verificationNote" TEXT
);

-- CreateTable
CREATE TABLE "Testimonial" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quote" TEXT NOT NULL,
    "animalTypeId" TEXT NOT NULL,
    "situation" TEXT NOT NULL,
    "linkedAction" TEXT NOT NULL,
    "verifiedUsage" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL,
    "consentAt" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "reviewerImage" TEXT,
    "reviewerImageConsent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TEXT NOT NULL DEFAULT ''
);

-- CreateTable
CREATE TABLE "ReactionSignal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "anonKey" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "nickname" TEXT NOT NULL DEFAULT '집사',
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "createdAt" TEXT NOT NULL DEFAULT ''
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "jti" TEXT NOT NULL PRIMARY KEY,
    "sub" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false
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
CREATE TABLE "Badge" (
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "grantedAt" TEXT NOT NULL,

    PRIMARY KEY ("userId", "type")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnimalType_slug_key" ON "AnimalType"("slug");

-- CreateIndex
CREATE INDEX "AnimalType_reviewStatus_idx" ON "AnimalType"("reviewStatus");

-- CreateIndex
CREATE INDEX "Taxon_reviewStatus_idx" ON "Taxon"("reviewStatus");

-- CreateIndex
CREATE INDEX "TaxonLegalRevision_taxonId_idx" ON "TaxonLegalRevision"("taxonId");

-- CreateIndex
CREATE INDEX "CareProfile_reviewStatus_idx" ON "CareProfile"("reviewStatus");

-- CreateIndex
CREATE INDEX "SupplyItem_reviewStatus_idx" ON "SupplyItem"("reviewStatus");

-- CreateIndex
CREATE INDEX "SupplyRequirement_reviewStatus_idx" ON "SupplyRequirement"("reviewStatus");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyRequirement_careProfileId_supplyItemId_key" ON "SupplyRequirement"("careProfileId", "supplyItemId");

-- CreateIndex
CREATE INDEX "CompatibilityRule_reviewStatus_idx" ON "CompatibilityRule"("reviewStatus");

-- CreateIndex
CREATE INDEX "SetupBundle_reviewStatus_idx" ON "SetupBundle"("reviewStatus");

-- CreateIndex
CREATE UNIQUE INDEX "SetupBundle_careProfileId_tier_key" ON "SetupBundle"("careProfileId", "tier");

-- CreateIndex
CREATE UNIQUE INDEX "SetupBundleItem_bundleId_supplyItemId_key" ON "SetupBundleItem"("bundleId", "supplyItemId");

-- CreateIndex
CREATE INDEX "CuratedProduct_reviewStatus_idx" ON "CuratedProduct"("reviewStatus");

-- CreateIndex
CREATE INDEX "CuratedProduct_supplyItemId_idx" ON "CuratedProduct"("supplyItemId");

-- CreateIndex
CREATE INDEX "VetClinic_status_idx" ON "VetClinic"("status");

-- CreateIndex
CREATE INDEX "VetClinic_region_idx" ON "VetClinic"("region");

-- CreateIndex
CREATE INDEX "Testimonial_status_verifiedUsage_idx" ON "Testimonial"("status", "verifiedUsage");

-- CreateIndex
CREATE INDEX "ReactionSignal_targetType_targetId_kind_idx" ON "ReactionSignal"("targetType", "targetId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ReactionSignal_anonKey_targetType_targetId_kind_key" ON "ReactionSignal"("anonKey", "targetType", "targetId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
