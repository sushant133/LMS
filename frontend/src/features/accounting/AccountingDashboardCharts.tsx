import type { AccountingDashboardResponse } from "@phit-erp/shared";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { formatCurrencyNpr } from "lib/utils";

const CHART_COLORS = ["#059669", "#0ea5e9", "#8b5cf6", "#f59e0b", "#ef4444", "#64748b"];

interface Props {
  data: AccountingDashboardResponse;
}

export const AccountingDashboardCharts = ({ data }: Props) => (
  <div className="grid gap-6 xl:grid-cols-2">
    <Card>
      <CardHeader><CardTitle>Collection Trend</CardTitle></CardHeader>
      <CardContent className="h-64">
        {(data.collectionTrend ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">No collection trend data yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.collectionTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => formatCurrencyNpr(Number(value))} />
              <Bar dataKey="amount" fill="#059669" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Revenue Sources</CardTitle></CardHeader>
      <CardContent className="h-64">
        {(data.revenueSources ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">No revenue breakdown yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data.revenueSources}
                dataKey="amount"
                nameKey="label"
                cx="50%"
                cy="50%"
                outerRadius={90}
                label={(props) => String(props.name ?? "").replace(/_/g, " ")}
              >
                {data.revenueSources.map((_, index) => (
                  <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => formatCurrencyNpr(Number(value))} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  </div>
);