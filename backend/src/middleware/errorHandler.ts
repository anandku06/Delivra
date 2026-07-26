import type { Request, Response, NextFunction } from "express";

interface AppError extends Error {
  statusCode?: number;
  details?: unknown;
}

/**
 * Global Express error handler.
 * Catches all unhandled errors and returns a consistent JSON response.
 */
export function errorHandler(
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err.statusCode ?? 500;
  const message = err.message ?? "Internal Server Error";

  console.error(`❌ [${statusCode}] ${message}`);
  if (statusCode === 500) {
    console.error(err.stack);
  }

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === "development" && {
      stack: err.stack,
      details: err.details,
    }),
  });
}
