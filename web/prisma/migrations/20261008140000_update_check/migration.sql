-- 0.9.5: the panel learns, now and then, that a newer release of itself exists.
--
-- update_checks is one row, rewritten by the poller at most twice a day from the release.json that every release carries. It holds
-- what was read (the file, validated), when it was read, the ETag the next request is made conditional on, and why the last attempt
-- failed if it did. A page never asks GitHub: it reads this row. "notifiedKey" is the release and state an audit line was last
-- written for, so a release that is still out is announced once and not at every look.

CREATE TABLE "update_checks" (
    "id" TEXT NOT NULL DEFAULT 'panel',
    "checkedAt" TIMESTAMP(3),
    "succeededAt" TIMESTAMP(3),
    "etag" TEXT,
    "error" TEXT,
    "release" JSONB,
    "notifiedKey" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "update_checks_pkey" PRIMARY KEY ("id")
);
