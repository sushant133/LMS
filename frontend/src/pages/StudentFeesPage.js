import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from "@tanstack/react-query";
import { Download, Receipt } from "lucide-react";
import { PageHeader } from "components/shared/PageHeader";
import { LoadingState } from "components/shared/LoadingState";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { formatCurrencyNpr } from "lib/utils";
export const StudentFeesPage = () => {
    const historyQuery = useQuery({
        queryKey: ["student-financial-history"],
        queryFn: () => unwrap(api.get("/student/financial-history"))
    });
    if (historyQuery.isLoading) {
        return _jsx(LoadingState, {});
    }
    const history = historyQuery.data;
    if (!history) {
        return (_jsxs("div", { className: "space-y-6", children: [_jsx(PageHeader, { title: "Fee History", description: "Your payment records and outstanding dues." }), _jsx(Card, { children: _jsx(CardContent, { className: "py-8 text-center text-slate-500", children: "No financial records found." }) })] }));
    }
    const downloadReceipt = (collectionId, receiptNumber) => {
        window.open(`${api.defaults.baseURL}/accounting/collections/${collectionId}/receipt`, "_blank", "noopener,noreferrer");
        void receiptNumber;
    };
    return (_jsxs("div", { className: "space-y-6", children: [_jsx(PageHeader, { title: "Fee History", description: "View your complete payment history, outstanding dues, and download receipts." }), _jsxs("div", { className: "grid gap-4 md:grid-cols-4", children: [_jsxs(Card, { children: [_jsx(CardHeader, { className: "pb-2", children: _jsx(CardTitle, { className: "text-sm text-slate-500", children: "Outstanding Due" }) }), _jsx(CardContent, { className: "text-2xl font-semibold text-rose-600", children: formatCurrencyNpr(history.outstandingDueNpr) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { className: "pb-2", children: _jsx(CardTitle, { className: "text-sm text-slate-500", children: "Total Paid" }) }), _jsx(CardContent, { className: "text-2xl font-semibold text-emerald-600", children: formatCurrencyNpr(history.totalPaidNpr) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { className: "pb-2", children: _jsx(CardTitle, { className: "text-sm text-slate-500", children: "Discounts" }) }), _jsx(CardContent, { className: "text-2xl font-semibold", children: formatCurrencyNpr(history.totalDiscountNpr) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { className: "pb-2", children: _jsx(CardTitle, { className: "text-sm text-slate-500", children: "Scholarships" }) }), _jsx(CardContent, { className: "text-2xl font-semibold", children: formatCurrencyNpr(history.totalScholarshipNpr) })] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsxs(CardTitle, { className: "flex items-center gap-2", children: [_jsx(Receipt, { className: "h-5 w-5" }), "Payment History"] }) }), _jsx(CardContent, { className: "overflow-x-auto", children: history.collections.length === 0 ? (_jsx("p", { className: "text-sm text-slate-500", children: "No payments recorded yet." })) : (_jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Receipt" }), _jsx(Th, { children: "Date" }), _jsx(Th, { children: "Amount Paid" }), _jsx(Th, { children: "Discount" }), _jsx(Th, { children: "Remaining Due" }), _jsx(Th, { children: "Method" }), _jsx(Th, {})] }) }), _jsx(TableBody, { children: history.collections.map((collection) => (_jsxs("tr", { children: [_jsx(Td, { className: "font-medium", children: collection.receiptNumber }), _jsx(Td, { children: collection.paidDateBs }), _jsx(Td, { children: formatCurrencyNpr(collection.amountPaidNpr) }), _jsx(Td, { children: formatCurrencyNpr(collection.discountNpr ?? 0) }), _jsx(Td, { children: _jsx(Badge, { className: (collection.remainingDueNpr ?? 0) > 0 ? "bg-rose-100 text-rose-800" : undefined, children: formatCurrencyNpr(collection.remainingDueNpr ?? 0) }) }), _jsx(Td, { children: (collection.paymentMethod ?? "CASH").replace(/_/g, " ") }), _jsx(Td, { children: _jsxs(Button, { size: "sm", variant: "outline", onClick: () => downloadReceipt(collection._id, collection.receiptNumber), children: [_jsx(Download, { className: "mr-1 h-4 w-4" }), "PDF"] }) })] }, collection._id))) })] })) })] })] }));
};
