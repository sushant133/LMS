import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ClassRecord, FeeCollectionInput, FeeCollectionRecord, FeeStructureInput, FeeStructureRecord, StudentRecord } from "@nepal-school-erp/shared";
import { feeCollectionSchema, feeStructureSchema } from "@nepal-school-erp/shared";
import { toast } from "sonner";
import { FormField } from "components/shared/FormField";
import { NepaliDateField } from "components/shared/NepaliDateField";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { formatCurrencyNpr, parseErrorMessage } from "lib/utils";

const defaultStructureValue: FeeStructureInput = {
  title: "",
  classIds: [],
  feeType: "MONTHLY",
  frequency: "MONTHLY",
  academicYearBs: "2083/2084",
  amountNpr: 0,
  isOptional: false
};

const defaultCollectionValue: FeeCollectionInput = {
  studentId: "",
  feeStructureId: "",
  receiptNumber: "",
  paidDateBs: "",
  amountPaidNpr: 0,
  discountNpr: 0,
  scholarshipNpr: 0,
  lateFeeNpr: 0,
  notes: ""
};

export const FeeManager = () => {
  const [structureForm, setStructureForm] = useState<FeeStructureInput>(defaultStructureValue);
  const [collectionForm, setCollectionForm] = useState<FeeCollectionInput>(defaultCollectionValue);
  const [editingStructureId, setEditingStructureId] = useState<string | null>(null);

  const structuresQuery = useQuery({ queryKey: ["fee-structures"], queryFn: () => unwrap<FeeStructureRecord[]>(api.get("/fees/structures")) });
  const collectionsQuery = useQuery({ queryKey: ["fee-collections"], queryFn: () => unwrap<FeeCollectionRecord[]>(api.get("/fees/collections")) });
  const studentsQuery = useQuery({ queryKey: ["students"], queryFn: () => unwrap<StudentRecord[]>(api.get("/students")) });
  const classesQuery = useQuery({ queryKey: ["classes"], queryFn: () => unwrap<ClassRecord[]>(api.get("/academics/classes")) });

  const structureMutation = useMutation({
    mutationFn: async (payload: FeeStructureInput) =>
      editingStructureId
        ? unwrap<FeeStructureRecord>(api.put(`/fees/structures/${editingStructureId}`, payload))
        : unwrap<FeeStructureRecord>(api.post("/fees/structures", payload)),
    onSuccess: async () => {
      toast.success(editingStructureId ? "Fee structure updated" : "Fee structure created");
      setStructureForm(defaultStructureValue);
      setEditingStructureId(null);
      await queryClient.invalidateQueries({ queryKey: ["fee-structures"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const collectionMutation = useMutation({
    mutationFn: async (payload: FeeCollectionInput) => unwrap<FeeCollectionRecord>(api.post("/fees/collections", payload)),
    onSuccess: async () => {
      toast.success("Fee collected successfully");
      setCollectionForm(defaultCollectionValue);
      await queryClient.invalidateQueries({ queryKey: ["fee-collections"] });
      await queryClient.invalidateQueries({ queryKey: ["students"] });
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Fee Management" description="Set fee structures, apply discounts and scholarships, record NPR receipts, and monitor due balances." />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{editingStructureId ? "Edit Fee Structure" : "Create Fee Structure"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 md:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                const parsed = feeStructureSchema.safeParse(structureForm);
                if (!parsed.success) {
                  toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
                  return;
                }
                void structureMutation.mutateAsync(parsed.data);
              }}
            >
              <div className="md:col-span-2">
                <FormField label="Title">
                  <Input value={structureForm.title} onChange={(event) => setStructureForm((current) => ({ ...current, title: event.target.value }))} />
                </FormField>
              </div>
              <FormField label="Fee Type">
                <Select value={structureForm.feeType} onChange={(event) => setStructureForm((current) => ({ ...current, feeType: event.target.value as FeeStructureInput["feeType"] }))}>
                  {["ADMISSION", "MONTHLY", "EXAM", "ANNUAL", "TRANSPORT", "HOSTEL", "OTHER"].map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Frequency">
                <Select
                  value={structureForm.frequency}
                  onChange={(event) => setStructureForm((current) => ({ ...current, frequency: event.target.value as FeeStructureInput["frequency"] }))}
                >
                  {["MONTHLY", "ANNUAL", "ONE_TIME"].map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Academic Year">
                <Input value={structureForm.academicYearBs} onChange={(event) => setStructureForm((current) => ({ ...current, academicYearBs: event.target.value }))} />
              </FormField>
              <FormField label="Amount (NPR)">
                <Input type="number" value={structureForm.amountNpr} onChange={(event) => setStructureForm((current) => ({ ...current, amountNpr: Number(event.target.value) }))} />
              </FormField>
              <div className="md:col-span-2">
                <FormField label="Class IDs (comma separated)">
                  <Input
                    value={structureForm.classIds.join(", ")}
                    onChange={(event) =>
                      setStructureForm((current) => ({
                        ...current,
                        classIds: event.target.value
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean)
                      }))
                    }
                  />
                </FormField>
              </div>
              <div className="md:col-span-2 flex justify-end gap-2">
                {editingStructureId ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditingStructureId(null);
                      setStructureForm(defaultStructureValue);
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
                <Button type="submit">{editingStructureId ? "Update Fee Structure" : "Create Fee Structure"}</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Collect Fee</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 md:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                const parsed = feeCollectionSchema.safeParse(collectionForm);
                if (!parsed.success) {
                  toast.error(parsed.error.issues[0]?.message ?? "Validation failed");
                  return;
                }
                void collectionMutation.mutateAsync(parsed.data);
              }}
            >
              <FormField label="Student">
                <Select value={collectionForm.studentId} onChange={(event) => setCollectionForm((current) => ({ ...current, studentId: event.target.value }))}>
                  <option value="">Select student</option>
                  {(studentsQuery.data ?? []).map((student) => (
                    <option key={student._id} value={student._id}>
                      {student.user.fullName}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Fee Structure">
                <Select value={collectionForm.feeStructureId} onChange={(event) => setCollectionForm((current) => ({ ...current, feeStructureId: event.target.value }))}>
                  <option value="">Select structure</option>
                  {(structuresQuery.data ?? []).map((structure) => (
                    <option key={structure._id} value={structure._id}>
                      {structure.title}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Receipt Number">
                <Input value={collectionForm.receiptNumber} onChange={(event) => setCollectionForm((current) => ({ ...current, receiptNumber: event.target.value }))} />
              </FormField>
              <FormField label="Paid Date (BS)">
                <NepaliDateField value={collectionForm.paidDateBs} onChange={(value) => setCollectionForm((current) => ({ ...current, paidDateBs: value }))} />
              </FormField>
              <FormField label="Amount Paid">
                <Input type="number" value={collectionForm.amountPaidNpr} onChange={(event) => setCollectionForm((current) => ({ ...current, amountPaidNpr: Number(event.target.value) }))} />
              </FormField>
              <FormField label="Discount">
                <Input type="number" value={collectionForm.discountNpr} onChange={(event) => setCollectionForm((current) => ({ ...current, discountNpr: Number(event.target.value) }))} />
              </FormField>
              <FormField label="Scholarship">
                <Input type="number" value={collectionForm.scholarshipNpr} onChange={(event) => setCollectionForm((current) => ({ ...current, scholarshipNpr: Number(event.target.value) }))} />
              </FormField>
              <FormField label="Late Fee">
                <Input type="number" value={collectionForm.lateFeeNpr} onChange={(event) => setCollectionForm((current) => ({ ...current, lateFeeNpr: Number(event.target.value) }))} />
              </FormField>
              <div className="md:col-span-2">
                <FormField label="Notes">
                  <Input value={collectionForm.notes ?? ""} onChange={(event) => setCollectionForm((current) => ({ ...current, notes: event.target.value }))} />
                </FormField>
              </div>
              <div className="md:col-span-2 flex justify-end">
                <Button type="submit">Collect Fee</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Fee Structures</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(structuresQuery.data ?? []).map((structure) => (
              <div key={structure._id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-slate-900">{structure.title}</h3>
                    <p className="text-sm text-slate-500">
                      {structure.feeType} / {structure.academicYearBs}
                    </p>
                  </div>
                  <Badge>{formatCurrencyNpr(structure.amountNpr)}</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Receipts</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHead>
                <tr>
                  <Th>Receipt</Th>
                  <Th>Student</Th>
                  <Th>Paid</Th>
                  <Th>Date</Th>
                </tr>
              </TableHead>
              <TableBody>
                {(collectionsQuery.data ?? []).map((collection) => (
                  <tr key={collection._id}>
                    <Td>{collection.receiptNumber}</Td>
                    <Td>{(studentsQuery.data ?? []).find((student) => student._id === collection.studentId)?.user.fullName ?? collection.studentId}</Td>
                    <Td>{formatCurrencyNpr(collection.amountPaidNpr)}</Td>
                    <Td>{collection.paidDateBs}</Td>
                  </tr>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

