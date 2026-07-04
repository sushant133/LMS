import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { transportAssignmentSchema, transportRouteSchema, type TransportAssignmentInput, type TransportRouteInput } from "@nepal-school-erp/shared";
import { toast } from "sonner";
import { FormField } from "components/shared/FormField";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, Td, Th, TableHead } from "components/ui/table";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { formatCurrencyNpr, parseErrorMessage } from "lib/utils";

export const TransportManager = () => {
  const [routeForm, setRouteForm] = useState<TransportRouteInput>({
    name: "", vehicleNumber: "", driverName: "", driverPhone: "", stops: [{ name: "Main Gate", pickupTime: "07:30" }], monthlyFeeNpr: 0, isActive: true
  });
  const [assignForm, setAssignForm] = useState<TransportAssignmentInput>({ routeId: "", studentId: "", pickupStop: "", dropStop: "", isActive: true });

  const routesQuery = useQuery({
    queryKey: ["transport-routes"],
    queryFn: () =>
      unwrap<Array<{ _id: string; name: string; vehicleNumber: string; driverName: string; monthlyFeeNpr: number; stops: { name: string }[] }>>(
        api.get("/transport/routes")
      )
  });
  const assignmentsQuery = useQuery({
    queryKey: ["transport-assignments"],
    queryFn: () =>
      unwrap<Array<{ _id: string; routeId?: { name: string }; studentId?: { user: { fullName: string } }; pickupStop: string; dropStop: string }>>(
        api.get("/transport/assignments")
      )
  });
  const studentsQuery = useQuery({
    queryKey: ["students"],
    queryFn: () => unwrap<Array<{ _id: string; user: { fullName: string } }>>(api.get("/students"))
  });

  const createRoute = useMutation({
    mutationFn: (payload: TransportRouteInput) => unwrap(api.post("/transport/routes", payload)),
    onSuccess: async () => { toast.success("Route created"); await queryClient.invalidateQueries({ queryKey: ["transport-routes"] }); },
    onError: (e) => toast.error(parseErrorMessage(e))
  });

  const assignStudent = useMutation({
    mutationFn: (payload: TransportAssignmentInput) => unwrap(api.post("/transport/assignments", payload)),
    onSuccess: async () => { toast.success("Student assigned"); await queryClient.invalidateQueries({ queryKey: ["transport-assignments"] }); },
    onError: (e) => toast.error(parseErrorMessage(e))
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Transport" description="Manage bus routes, stops, and student assignments." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>New route</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <FormField label="Route name"><Input value={routeForm.name} onChange={(e) => setRouteForm((c) => ({ ...c, name: e.target.value }))} /></FormField>
            <FormField label="Vehicle"><Input value={routeForm.vehicleNumber} onChange={(e) => setRouteForm((c) => ({ ...c, vehicleNumber: e.target.value }))} /></FormField>
            <FormField label="Driver"><Input value={routeForm.driverName} onChange={(e) => setRouteForm((c) => ({ ...c, driverName: e.target.value }))} /></FormField>
            <FormField label="Driver phone"><Input value={routeForm.driverPhone} onChange={(e) => setRouteForm((c) => ({ ...c, driverPhone: e.target.value }))} /></FormField>
            <FormField label="Monthly fee (NPR)"><Input type="number" value={routeForm.monthlyFeeNpr} onChange={(e) => setRouteForm((c) => ({ ...c, monthlyFeeNpr: e.target.valueAsNumber }))} /></FormField>
            <Button onClick={() => { const p = transportRouteSchema.safeParse(routeForm); if (!p.success) return toast.error("Invalid route"); createRoute.mutate(p.data); }}>Create route</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Assign student</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <FormField label="Route">
              <Select value={assignForm.routeId} onChange={(e) => setAssignForm((c) => ({ ...c, routeId: e.target.value }))}>
                <option value="">Select route</option>
                {(routesQuery.data ?? []).map((r: { _id: string; name: string }) => <option key={r._id} value={r._id}>{r.name}</option>)}
              </Select>
            </FormField>
            <FormField label="Student">
              <Select value={assignForm.studentId} onChange={(e) => setAssignForm((c) => ({ ...c, studentId: e.target.value }))}>
                <option value="">Select student</option>
                {(studentsQuery.data ?? []).map((s: { _id: string; user: { fullName: string } }) => <option key={s._id} value={s._id}>{s.user.fullName}</option>)}
              </Select>
            </FormField>
            <FormField label="Pickup stop"><Input value={assignForm.pickupStop} onChange={(e) => setAssignForm((c) => ({ ...c, pickupStop: e.target.value }))} /></FormField>
            <FormField label="Drop stop"><Input value={assignForm.dropStop} onChange={(e) => setAssignForm((c) => ({ ...c, dropStop: e.target.value }))} /></FormField>
            <Button onClick={() => { const p = transportAssignmentSchema.safeParse(assignForm); if (!p.success) return toast.error("Invalid assignment"); assignStudent.mutate(p.data); }}>Assign</Button>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Routes</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHead><tr><Th>Name</Th><Th>Vehicle</Th><Th>Driver</Th><Th>Fee</Th><Th>Stops</Th></tr></TableHead>
            <TableBody>
              {(routesQuery.data ?? []).map((r: { _id: string; name: string; vehicleNumber: string; driverName: string; monthlyFeeNpr: number; stops: { name: string }[] }) => (
                <tr key={r._id}><Td>{r.name}</Td><Td>{r.vehicleNumber}</Td><Td>{r.driverName}</Td><Td>{formatCurrencyNpr(r.monthlyFeeNpr)}</Td><Td>{r.stops.map((s) => s.name).join(", ")}</Td></tr>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Assignments</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHead><tr><Th>Route</Th><Th>Student</Th><Th>Pickup</Th><Th>Drop</Th></tr></TableHead>
            <TableBody>
              {(assignmentsQuery.data ?? []).map((a: { _id: string; routeId?: { name: string }; studentId?: { user: { fullName: string } }; pickupStop: string; dropStop: string }) => (
                <tr key={a._id}><Td>{a.routeId?.name}</Td><Td>{a.studentId?.user?.fullName}</Td><Td>{a.pickupStop}</Td><Td>{a.dropStop}</Td></tr>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};