import { queryClient } from "lib/queryClient";
import { invalidateDashboardQueries } from "lib/dashboardQueries";

/**
 * Invalidate every accounting-related cache so Dashboard, Ledger, Journal,
 * Reports, Fee/Salary/Refund desks, and registers stay in sync after any post.
 */
export const invalidateAccountingQueries = async (): Promise<void> => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["accounting"] }),
    queryClient.invalidateQueries({ queryKey: ["accounting-dashboard"] }),
    queryClient.invalidateQueries({ queryKey: ["accounting-structures"] }),
    queryClient.invalidateQueries({ queryKey: ["accounting-receipts"] }),
    queryClient.invalidateQueries({ queryKey: ["accounting-fee-records"] }),
    queryClient.invalidateQueries({ queryKey: ["accounting-student-accounts"] }),
    queryClient.invalidateQueries({ queryKey: ["accounting-student-financial"] }),
    queryClient.invalidateQueries({ queryKey: ["student-financial-history"] }),
    queryClient.invalidateQueries({ queryKey: ["accounting-expenses"] }),
    queryClient.invalidateQueries({ queryKey: ["accounting-purchases"] }),
    queryClient.invalidateQueries({ queryKey: ["accounting-income"] }),
    queryClient.invalidateQueries({ queryKey: ["accounting-salaries"] }),
    queryClient.invalidateQueries({ queryKey: ["accounting-salary-records"] }),
    queryClient.invalidateQueries({ queryKey: ["accounting-salary-employees"] }),
    queryClient.invalidateQueries({ queryKey: ["accounting-cash-book"] }),
    queryClient.invalidateQueries({ queryKey: ["accounting-refund-records"] }),
    queryClient.invalidateQueries({ queryKey: ["fee-refunds"] }),
    queryClient.invalidateQueries({ queryKey: ["accounting-report"] }),
    // Journal + ledger (aligned keys used across panels)
    queryClient.invalidateQueries({ queryKey: ["journal-entries"] }),
    queryClient.invalidateQueries({ queryKey: ["accounting-journal-entries"] }),
    queryClient.invalidateQueries({ queryKey: ["goshwara-vouchers"] }),
    queryClient.invalidateQueries({ queryKey: ["chart-of-accounts"] }),
    queryClient.invalidateQueries({ queryKey: ["accounting-coa"] }),
    queryClient.invalidateQueries({ queryKey: ["students"] }),
    invalidateDashboardQueries(),
  ]);
};
