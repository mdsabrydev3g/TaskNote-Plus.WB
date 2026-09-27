import { and, eq, isNull, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * Tenancy enforcement (§6.6)
 * ---------------------------------------------------------------------------
 * Every content table carries `user_id`. Rather than rely on every call site
 * remembering to add `.where(eq(table.userId, user.id))`, all content access
 * goes through these helpers, which *require* the owner id as an argument.
 *
 * This mirrors Postgres Row-Level Security in application space. When you turn
 * on RLS on Neon (see docs/RLS.md), these helpers keep the app queries aligned
 * with the policy so nothing silently breaks.
 */

export type ScopedTable = {
  userId: PgColumn;
  deletedAt?: PgColumn;
};

export type UserId = string;

/** Base predicate: this row belongs to this user and is not soft-deleted. */
export function ownedBy(table: ScopedTable, userId: UserId): SQL {
  const clauses: SQL[] = [eq(table.userId, userId)];
  if (table.deletedAt) clauses.push(isNull(table.deletedAt));
  return and(...clauses) as SQL;
}

/** Includes soft-deleted rows — used by sync, exports, and trash views. */
export function ownedByIncludingDeleted(table: ScopedTable, userId: UserId): SQL {
  return eq(table.userId, userId) as SQL;
}

/**
 * A per-user handle. Create one per request and pass it down; it carries the
 * owner id so no downstream function has to trust a parameter it was handed.
 */
export class UserScope {
  constructor(readonly userId: UserId) {}

  where(table: ScopedTable): SQL {
    return ownedBy(table, this.userId);
  }

  whereWithDeleted(table: ScopedTable): SQL {
    return ownedByIncludingDeleted(table, this.userId);
  }

  /** Verifies a fetched row really belongs to this user before it is acted on. */
  assertOwns(row: { userId?: string | null } | null | undefined): boolean {
    return Boolean(row && row.userId === this.userId);
  }
}

/**
 * Guard used by route handlers that accept an entity id from the client.
 * Fetching then asserting is the pattern; this makes the assertion explicit
 * and uniform so a missing check is easy to spot in review.
 */
export function assertOwnership<T extends { userId?: string | null }>(
  row: T | undefined | null,
  scope: UserScope,
): T {
  if (!row || row.userId !== scope.userId) {
    throw new ForbiddenError();
  }
  return row;
}

export class ForbiddenError extends Error {
  constructor(message = "Resource not found or not accessible") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class ValidationError extends Error {
  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = "ValidationError";
  }
}
