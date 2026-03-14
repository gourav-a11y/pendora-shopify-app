/*
  Warnings:

  - You are about to drop the column `filePath` on the `ProductFile` table. All the data in the column will be lost.
  - Added the required column `fileUrl` to the `ProductFile` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProductFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "displayName" TEXT,
    "downloadEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ProductFile" ("createdAt", "displayName", "downloadEnabled", "fileName", "fileSize", "id", "mimeType", "productId", "productTitle", "shop", "updatedAt") SELECT "createdAt", "displayName", "downloadEnabled", "fileName", "fileSize", "id", "mimeType", "productId", "productTitle", "shop", "updatedAt" FROM "ProductFile";
DROP TABLE "ProductFile";
ALTER TABLE "new_ProductFile" RENAME TO "ProductFile";
CREATE INDEX "ProductFile_shop_productId_idx" ON "ProductFile"("shop", "productId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
