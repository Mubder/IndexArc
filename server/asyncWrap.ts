import type { NextFunction, Request, Response } from "express";

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

// Express 4 does not catch rejected promises from async handlers — a throw
// after an await leaves the request hanging forever (and can half-apply a
// multi-step operation). Wrap every async route handler.
export function wrapAsync(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
