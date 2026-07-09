import { useMutation, useQuery } from "@tanstack/react-query";
import {
  vendorSchema,
  type VendorInput,
  type VendorRecord,
} from "@phit-erp/shared";
import { useState } from "react";
import { toast } from "sonner";
import { FormField } from "components/shared/FormField";
import { LoadingState } from "components/shared/LoadingState";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";

const defaultForm: VendorInput = {
  name: "",
  panNumber: "",
  vatNumber: "",
  contactPerson: "",
  phone: "",
  email: "",
  address: "",
  isActive: true,
};

export const VendorsPanel = ({ canWrite }: { canWrite: boolean }) => {
  const [form, setForm] = useState(defaultForm);

  const vendorsQuery = useQuery({
    queryKey: ["vendors"],
    queryFn: () => unwrap<VendorRecord[]>(api.get("/accounting/vendors")),
  });

  const create = useMutation({
    mutationFn: (payload: VendorInput) =>
      unwrap(api.post("/accounting/vendors", payload)),
    onSuccess: async () => {
      toast.success("Vendor created");
      setForm(defaultForm);
      await queryClient.invalidateQueries({ queryKey: ["vendors"] });
    },
    onError: (e) => toast.error(parseErrorMessage(e)),
  });

  if (vendorsQuery.isLoading) return <LoadingState />;

  return (
    <div className="space-y-6">
      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle>Add Vendor</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3 md:grid-cols-3"
              onSubmit={(e) => {
                e.preventDefault();
                const parsed = vendorSchema.safeParse(form);
                if (!parsed.success)
                  return toast.error(
                    parsed.error.issues[0]?.message ?? "Invalid vendor",
                  );
                void create.mutateAsync(parsed.data);
              }}
            >
              <FormField label="Name">
                <Input
                  value={form.name}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, name: e.target.value }))
                  }
                />
              </FormField>
              <FormField label="PAN">
                <Input
                  value={form.panNumber}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, panNumber: e.target.value }))
                  }
                />
              </FormField>
              <FormField label="Phone">
                <Input
                  value={form.phone}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, phone: e.target.value }))
                  }
                />
              </FormField>
              <div className="md:col-span-3">
                <Button type="submit" disabled={create.isPending}>
                  Save Vendor
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Vendors</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHead>
              <tr>
                <Th>Name</Th>
                <Th>PAN</Th>
                <Th>Phone</Th>
                <Th>Status</Th>
              </tr>
            </TableHead>
            <TableBody>
              {(vendorsQuery.data ?? []).map((vendor) => (
                <tr key={vendor._id}>
                  <Td>{vendor.name}</Td>
                  <Td>{vendor.panNumber || "—"}</Td>
                  <Td>{vendor.phone || "—"}</Td>
                  <Td>{vendor.isActive ? "Active" : "Inactive"}</Td>
                </tr>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};
