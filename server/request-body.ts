import type { RequestHandler } from "express";
import type { ZodType } from "zod";

/**
 * Request-body schema check (ASVS 13.2.2). Runs before the handler: a body
 * that is not a JSON object, or a known field of the wrong type or size,
 * gets 400 { error, code: "invalid_body", issues } and never reaches the
 * handler. Schemas are loose objects: unknown keys pass through untouched
 * (handlers read only the fields they know), so older clients keep working.
 *
 * The returned function is named checkRequestBody so a test can assert that
 * every POST/PUT/PATCH route carries one (server/request-body.test.ts).
 */
export function validateBody(schema: ZodType): RequestHandler {
  return function checkRequestBody(req, res, next) {
    const r = schema.safeParse(req.body ?? {});
    if (!r.success) {
      return res.status(400).json({
        error: "Invalid request body",
        code: "invalid_body",
        // Paths and messages only, never the submitted values.
        issues: r.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    req.body = r.data;
    next();
  };
}
