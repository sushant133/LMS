import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, TableHead, Td, Th } from "components/ui/table";
import { Badge } from "components/ui/badge";
import { EmptyState } from "components/shared/EmptyState";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { api, unwrap } from "lib/api";
import { parseErrorMessage } from "lib/utils";
import { NepaliDateField } from "components/shared/NepaliDateField";

interface PoolMeta {
  pool: string;
  label: string;
  labelNp?: string;
  ratePercent: number;
  accountCode: string;
}

interface AssetRow {
  _id: string;
  assetCode: string;
  name: string;
  pool: string;
  acquisitionDateBs: string;
  acquisitionCostNpr: number;
  salvageValueNpr: number;
  openingAccumulatedDepreciationNpr: number;
  accumulatedDepreciationNpr: number;
  ratePercent: number;
  method: string;
  status: string;
  location: string;
}

interface RegisterResponse {
  rows: Array<{
    assetCode: string;
    name: string;
    poolLabel: string;
    acquisitionDateBs: string;
    ratePercent: number;
    method: string;
    status: string;
    acquisitionCostNpr: number;
    accumulatedDepreciationNpr: number;
    writtenDownValueNpr: number;
  }>;
  totals: {
    acquisitionCostNpr: number;
    accumulatedDepreciationNpr: number;
    writtenDownValueNpr: number;
    assetCount: number;
  };
}

interface DepreciationPreview {
  fiscalYearBs: string;
  alreadyPosted: boolean;
  postedTotalNpr: number;
  totalNpr: number;
  lines: Array<{
    assetCode: string;
    assetName: string;
    pool: string;
    ratePercent: number;
    acquisitionFactor: number;
    openingWdvNpr: number;
    depreciationNpr: number;
    closingWdvNpr: number;
  }>;
}

const npr = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `NPR ${Number(value).toLocaleString("en-NP")}`;

const emptyForm = {
  assetCode: "",
  name: "",
  pool: "B",
  acquisitionDateBs: "",
  acquisitionCostNpr: "",
  salvageValueNpr: "",
  openingAccumulatedDepreciationNpr: "",
  location: "",
  vendorName: "",
  serialNumber: "",
  method: "WDV",
  postToLedger: false,
};

export const FixedAssetsPanel = ({ canWrite, isAdmin }: { canWrite: boolean; isAdmin: boolean }) => {
  const [form, setForm] = useState({ ...emptyForm });
  const [showForm, setShowForm] = useState(false);
  const [fiscalYearBs, setFiscalYearBs] = useState("");
  const [runDateBs, setRunDateBs] = useState("");
  const [includeDisposed, setIncludeDisposed] = useState(false);

  const poolsQuery = useQuery({
    queryKey: ["depreciation-pools"],
    queryFn: () => unwrap<PoolMeta[]>(api.get("/accounting/depreciation-pools")),
  });

  const assetsQuery = useQuery({
    queryKey: ["fixed-assets"],
    queryFn: () => unwrap<AssetRow[]>(api.get("/accounting/assets")),
  });

  const registerQuery = useQuery({
    queryKey: ["asset-register", includeDisposed],
    queryFn: () =>
      unwrap<RegisterResponse>(
        api.get("/accounting/assets/register", { params: { includeDisposed } }),
      ),
  });

  const runsQuery = useQuery({
    queryKey: ["depreciation-runs"],
    queryFn: () => unwrap<Array<Record<string, unknown>>>(api.get("/accounting/depreciation/runs")),
  });

  const previewQuery = useQuery({
    queryKey: ["depreciation-preview", fiscalYearBs],
    queryFn: () =>
      unwrap<DepreciationPreview>(
        api.get("/accounting/depreciation/preview", { params: { fiscalYearBs } }),
      ),
    enabled: fiscalYearBs.trim().length > 0,
  });

  const pools = poolsQuery.data ?? [];
  const selectedPool = useMemo(
    () => pools.find((p) => p.pool === form.pool),
    [pools, form.pool],
  );

  const refreshAll = async () => {
    await Promise.all([
      assetsQuery.refetch(),
      registerQuery.refetch(),
      runsQuery.refetch(),
      previewQuery.refetch(),
    ]);
  };

  const createAsset = useMutation({
    mutationFn: () =>
      unwrap(
        api.post("/accounting/assets", {
          ...form,
          acquisitionCostNpr: Number(form.acquisitionCostNpr || 0),
          salvageValueNpr: Number(form.salvageValueNpr || 0),
          openingAccumulatedDepreciationNpr: Number(form.openingAccumulatedDepreciationNpr || 0),
        }),
      ),
    onSuccess: async () => {
      toast.success("Fixed asset added");
      setForm({ ...emptyForm });
      setShowForm(false);
      await refreshAll();
    },
    onError: (error) => toast.error(parseErrorMessage(error) || "Could not add asset"),
  });

  const runDepreciation = useMutation({
    mutationFn: () =>
      unwrap(api.post("/accounting/depreciation/run", { fiscalYearBs, runDateBs })),
    onSuccess: async (result) => {
      const total = (result as { totalNpr?: number })?.totalNpr ?? 0;
      toast.success(`Depreciation of ${npr(total)} posted`);
      await refreshAll();
    },
    onError: (error) => toast.error(parseErrorMessage(error) || "Could not post depreciation"),
  });

  const register = registerQuery.data;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Fixed Asset Register</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              Depreciation pools follow Income Tax Act 2058, Schedule 2.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={includeDisposed}
                onChange={(event) => setIncludeDisposed(event.target.checked)}
              />
              Show disposed
            </label>
            {canWrite ? (
              <Button size="sm" onClick={() => setShowForm((open) => !open)}>
                {showForm ? "Cancel" : "Add asset"}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {showForm && canWrite ? (
            <div className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 lg:grid-cols-3">
              <FormField label="Asset code">
                <Input
                  value={form.assetCode}
                  onChange={(e) => setForm({ ...form, assetCode: e.target.value })}
                  placeholder="FA-001"
                />
              </FormField>
              <FormField label="Asset name">
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Desktop computer"
                />
              </FormField>
              <FormField label={`Pool${selectedPool ? ` — ${selectedPool.ratePercent}%` : ""}`}>
                <Select
                  value={form.pool}
                  onChange={(e) => setForm({ ...form, pool: e.target.value })}
                >
                  {pools.map((pool) => (
                    <option key={pool.pool} value={pool.pool}>
                      {pool.pool} — {pool.label} ({pool.ratePercent}%)
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Acquisition date (BS)">
                <NepaliDateField
                  value={form.acquisitionDateBs}
                  onChange={(value) => setForm({ ...form, acquisitionDateBs: value })}
                />
              </FormField>
              <FormField label="Acquisition cost (NPR)">
                <Input
                  type="number"
                  value={form.acquisitionCostNpr}
                  onChange={(e) => setForm({ ...form, acquisitionCostNpr: e.target.value })}
                />
              </FormField>
              <FormField label="Salvage value (NPR)">
                <Input
                  type="number"
                  value={form.salvageValueNpr}
                  onChange={(e) => setForm({ ...form, salvageValueNpr: e.target.value })}
                />
              </FormField>
              <FormField label="Depreciation already charged (NPR)">
                <Input
                  type="number"
                  value={form.openingAccumulatedDepreciationNpr}
                  onChange={(e) =>
                    setForm({ ...form, openingAccumulatedDepreciationNpr: e.target.value })
                  }
                  placeholder="For assets bought before this register"
                />
              </FormField>
              <FormField label="Location">
                <Input
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                />
              </FormField>
              <FormField label="Supplier">
                <Input
                  value={form.vendorName}
                  onChange={(e) => setForm({ ...form, vendorName: e.target.value })}
                />
              </FormField>
              <div className="lg:col-span-3">
                <label className="flex items-start gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={form.postToLedger}
                    onChange={(e) => setForm({ ...form, postToLedger: e.target.checked })}
                  />
                  <span>
                    Also post a purchase voucher to the ledger.
                    <span className="block text-xs text-slate-500">
                      Leave unticked when the purchase is already recorded — ticking it
                      would double-count the asset.
                    </span>
                  </span>
                </label>
              </div>
              <div className="lg:col-span-3">
                <Button
                  onClick={() => createAsset.mutate()}
                  disabled={
                    createAsset.isPending ||
                    !form.assetCode.trim() ||
                    !form.name.trim() ||
                    !form.acquisitionDateBs ||
                    !(Number(form.acquisitionCostNpr) > 0)
                  }
                >
                  {createAsset.isPending ? "Saving..." : "Save asset"}
                </Button>
              </div>
            </div>
          ) : null}

          {registerQuery.isLoading ? (
            <LoadingState />
          ) : !register || register.rows.length === 0 ? (
            <EmptyState
              title="No fixed assets yet"
              description="Add land, buildings, vehicles, computers and equipment to start tracking depreciation."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Code</Th>
                    <Th>Asset</Th>
                    <Th>Pool</Th>
                    <Th>Acquired</Th>
                    <Th>Rate</Th>
                    <Th className="text-right">Cost</Th>
                    <Th className="text-right">Accum. Dep.</Th>
                    <Th className="text-right">WDV</Th>
                    <Th>Status</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {register.rows.map((row) => (
                    <tr key={row.assetCode}>
                      <Td>{row.assetCode}</Td>
                      <Td>{row.name}</Td>
                      <Td className="text-xs text-slate-500">{row.poolLabel}</Td>
                      <Td>{row.acquisitionDateBs}</Td>
                      <Td>{row.ratePercent}%</Td>
                      <Td className="text-right">{npr(row.acquisitionCostNpr)}</Td>
                      <Td className="text-right">{npr(row.accumulatedDepreciationNpr)}</Td>
                      <Td className="text-right font-medium">{npr(row.writtenDownValueNpr)}</Td>
                      <Td>
                        <Badge
                          className={
                            row.status === "ACTIVE"
                              ? undefined
                              : "bg-slate-100 text-slate-600"
                          }
                        >
                          {row.status}
                        </Badge>
                      </Td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <Td colSpan={5}>TOTAL ({register.totals.assetCount} assets)</Td>
                    <Td className="text-right">{npr(register.totals.acquisitionCostNpr)}</Td>
                    <Td className="text-right">{npr(register.totals.accumulatedDepreciationNpr)}</Td>
                    <Td className="text-right">{npr(register.totals.writtenDownValueNpr)}</Td>
                    <Td />
                  </tr>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Depreciation Run</CardTitle>
          <p className="mt-1 text-sm text-slate-500">
            Charges one voucher for the whole year: Dr Depreciation · Cr Accumulated Depreciation.
            Assets bought mid-year are pro-rated (100% / ⅔ / ⅓ by acquisition period).
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <FormField label="Fiscal year (BS)">
              <Input
                value={fiscalYearBs}
                onChange={(e) => setFiscalYearBs(e.target.value)}
                placeholder="2083/2084"
              />
            </FormField>
            <FormField label="Posting date (BS)">
              <NepaliDateField value={runDateBs} onChange={setRunDateBs} />
            </FormField>
            <div className="flex items-end">
              {isAdmin ? (
                <Button
                  onClick={() => runDepreciation.mutate()}
                  disabled={
                    runDepreciation.isPending ||
                    !fiscalYearBs.trim() ||
                    !runDateBs ||
                    previewQuery.data?.alreadyPosted ||
                    (previewQuery.data?.totalNpr ?? 0) <= 0
                  }
                >
                  {runDepreciation.isPending ? "Posting..." : "Post depreciation"}
                </Button>
              ) : null}
            </div>
          </div>

          {previewQuery.data?.alreadyPosted ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Depreciation of {npr(previewQuery.data.postedTotalNpr)} has already been posted
              for FY {previewQuery.data.fiscalYearBs}. A year can only be charged once.
            </div>
          ) : null}

          {previewQuery.isFetching ? (
            <LoadingState />
          ) : previewQuery.data && previewQuery.data.lines.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Code</Th>
                    <Th>Asset</Th>
                    <Th>Pool</Th>
                    <Th>Rate</Th>
                    <Th>Factor</Th>
                    <Th className="text-right">Opening WDV</Th>
                    <Th className="text-right">Depreciation</Th>
                    <Th className="text-right">Closing WDV</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {previewQuery.data.lines.map((line) => (
                    <tr key={line.assetCode}>
                      <Td>{line.assetCode}</Td>
                      <Td>{line.assetName}</Td>
                      <Td>{line.pool}</Td>
                      <Td>{line.ratePercent}%</Td>
                      <Td>{line.acquisitionFactor === 1 ? "Full" : `×${line.acquisitionFactor}`}</Td>
                      <Td className="text-right">{npr(line.openingWdvNpr)}</Td>
                      <Td className="text-right font-medium">{npr(line.depreciationNpr)}</Td>
                      <Td className="text-right">{npr(line.closingWdvNpr)}</Td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <Td colSpan={6}>TOTAL</Td>
                    <Td className="text-right">{npr(previewQuery.data.totalNpr)}</Td>
                    <Td />
                  </tr>
                </TableBody>
              </Table>
            </div>
          ) : fiscalYearBs.trim() ? (
            <EmptyState
              title="Nothing to depreciate"
              description="No active assets are depreciable for this fiscal year."
            />
          ) : null}

          {(runsQuery.data?.length ?? 0) > 0 ? (
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">Previous runs</p>
              <div className="flex flex-wrap gap-2">
                {(runsQuery.data ?? []).map((run) => (
                  <Badge key={String(run._id)}>
                    FY {String(run.fiscalYearBs)} · {npr(Number(run.totalDepreciationNpr))}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
};
