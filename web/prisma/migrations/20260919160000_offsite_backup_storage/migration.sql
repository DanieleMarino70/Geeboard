-- One S3-compatible bucket per workspace, for backups that must outlive
-- the node that made them. The secret key is stored encrypted; nothing
-- here is ever shown back to a browser once written.
CREATE TABLE "backup_storage" (
  "id"               TEXT NOT NULL DEFAULT 's3',
  "endpoint"         TEXT NOT NULL,
  "region"           TEXT NOT NULL,
  "bucket"           TEXT NOT NULL,
  "prefix"           TEXT NOT NULL DEFAULT '',
  "pathStyle"        BOOLEAN NOT NULL DEFAULT true,
  "accessKeyId"      TEXT NOT NULL,
  "secretAccessKey"  TEXT NOT NULL,
  "scheduledOffsite" BOOLEAN NOT NULL DEFAULT true,
  "checkedAt"        TIMESTAMP(3),
  "checkError"       TEXT,
  "configuredById"   TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "backup_storage_pkey" PRIMARY KEY ("id")
);
