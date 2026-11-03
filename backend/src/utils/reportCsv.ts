import type { Response } from "express";

/** "<type>-<from>-<to>.csv"; an open end of the range reads "start" / "today". */
export const reportCsvFileName = (reportType: string, fromDateBs?: string, toDateBs?: string): string =>
  `${[reportType, fromDateBs || "start", toDateBs || "today"].join("-").replace(/[^\w-]+/g, "_")}.csv`;

/** Send a report CSV as a download. The UTF-8 BOM lets Excel show Nepali text correctly. */
export const sendReportCsv = (
  res: Response,
  csv: string,
  reportType: string,
  range: { fromDateBs?: string; toDateBs?: string }
): Response => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${reportCsvFileName(reportType, range.fromDateBs, range.toDateBs)}"`
  );
  return res.send(`﻿${csv}`);
};
