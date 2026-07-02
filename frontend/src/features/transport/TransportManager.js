import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { transportAssignmentSchema, transportRouteSchema } from "@nepal-school-erp/shared";
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
    const [routeForm, setRouteForm] = useState({
        name: "", vehicleNumber: "", driverName: "", driverPhone: "", stops: [{ name: "Main Gate", pickupTime: "07:30" }], monthlyFeeNpr: 0, isActive: true
    });
    const [assignForm, setAssignForm] = useState({ routeId: "", studentId: "", pickupStop: "", dropStop: "", isActive: true });
    const routesQuery = useQuery({
        queryKey: ["transport-routes"],
        queryFn: () => unwrap(api.get("/transport/routes"))
    });
    const assignmentsQuery = useQuery({
        queryKey: ["transport-assignments"],
        queryFn: () => unwrap(api.get("/transport/assignments"))
    });
    const studentsQuery = useQuery({
        queryKey: ["students"],
        queryFn: () => unwrap(api.get("/students"))
    });
    const createRoute = useMutation({
        mutationFn: (payload) => unwrap(api.post("/transport/routes", payload)),
        onSuccess: async () => { toast.success("Route created"); await queryClient.invalidateQueries({ queryKey: ["transport-routes"] }); },
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    const assignStudent = useMutation({
        mutationFn: (payload) => unwrap(api.post("/transport/assignments", payload)),
        onSuccess: async () => { toast.success("Student assigned"); await queryClient.invalidateQueries({ queryKey: ["transport-assignments"] }); },
        onError: (e) => toast.error(parseErrorMessage(e))
    });
    return (_jsxs("div", { className: "space-y-6", children: [_jsx(PageHeader, { title: "Transport", description: "Manage bus routes, stops, and student assignments." }), _jsxs("div", { className: "grid gap-6 lg:grid-cols-2", children: [_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "New route" }) }), _jsxs(CardContent, { className: "space-y-3", children: [_jsx(FormField, { label: "Route name", children: _jsx(Input, { value: routeForm.name, onChange: (e) => setRouteForm((c) => ({ ...c, name: e.target.value })) }) }), _jsx(FormField, { label: "Vehicle", children: _jsx(Input, { value: routeForm.vehicleNumber, onChange: (e) => setRouteForm((c) => ({ ...c, vehicleNumber: e.target.value })) }) }), _jsx(FormField, { label: "Driver", children: _jsx(Input, { value: routeForm.driverName, onChange: (e) => setRouteForm((c) => ({ ...c, driverName: e.target.value })) }) }), _jsx(FormField, { label: "Driver phone", children: _jsx(Input, { value: routeForm.driverPhone, onChange: (e) => setRouteForm((c) => ({ ...c, driverPhone: e.target.value })) }) }), _jsx(FormField, { label: "Monthly fee (NPR)", children: _jsx(Input, { type: "number", value: routeForm.monthlyFeeNpr, onChange: (e) => setRouteForm((c) => ({ ...c, monthlyFeeNpr: Number(e.target.value) })) }) }), _jsx(Button, { onClick: () => { const p = transportRouteSchema.safeParse(routeForm); if (!p.success)
                                            return toast.error("Invalid route"); createRoute.mutate(p.data); }, children: "Create route" })] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Assign student" }) }), _jsxs(CardContent, { className: "space-y-3", children: [_jsx(FormField, { label: "Route", children: _jsxs(Select, { value: assignForm.routeId, onChange: (e) => setAssignForm((c) => ({ ...c, routeId: e.target.value })), children: [_jsx("option", { value: "", children: "Select route" }), (routesQuery.data ?? []).map((r) => _jsx("option", { value: r._id, children: r.name }, r._id))] }) }), _jsx(FormField, { label: "Student", children: _jsxs(Select, { value: assignForm.studentId, onChange: (e) => setAssignForm((c) => ({ ...c, studentId: e.target.value })), children: [_jsx("option", { value: "", children: "Select student" }), (studentsQuery.data ?? []).map((s) => _jsx("option", { value: s._id, children: s.user.fullName }, s._id))] }) }), _jsx(FormField, { label: "Pickup stop", children: _jsx(Input, { value: assignForm.pickupStop, onChange: (e) => setAssignForm((c) => ({ ...c, pickupStop: e.target.value })) }) }), _jsx(FormField, { label: "Drop stop", children: _jsx(Input, { value: assignForm.dropStop, onChange: (e) => setAssignForm((c) => ({ ...c, dropStop: e.target.value })) }) }), _jsx(Button, { onClick: () => { const p = transportAssignmentSchema.safeParse(assignForm); if (!p.success)
                                            return toast.error("Invalid assignment"); assignStudent.mutate(p.data); }, children: "Assign" })] })] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Routes" }) }), _jsx(CardContent, { children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Name" }), _jsx(Th, { children: "Vehicle" }), _jsx(Th, { children: "Driver" }), _jsx(Th, { children: "Fee" }), _jsx(Th, { children: "Stops" })] }) }), _jsx(TableBody, { children: (routesQuery.data ?? []).map((r) => (_jsxs("tr", { children: [_jsx(Td, { children: r.name }), _jsx(Td, { children: r.vehicleNumber }), _jsx(Td, { children: r.driverName }), _jsx(Td, { children: formatCurrencyNpr(r.monthlyFeeNpr) }), _jsx(Td, { children: r.stops.map((s) => s.name).join(", ") })] }, r._id))) })] }) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Assignments" }) }), _jsx(CardContent, { children: _jsxs(Table, { children: [_jsx(TableHead, { children: _jsxs("tr", { children: [_jsx(Th, { children: "Route" }), _jsx(Th, { children: "Student" }), _jsx(Th, { children: "Pickup" }), _jsx(Th, { children: "Drop" })] }) }), _jsx(TableBody, { children: (assignmentsQuery.data ?? []).map((a) => (_jsxs("tr", { children: [_jsx(Td, { children: a.routeId?.name }), _jsx(Td, { children: a.studentId?.user?.fullName }), _jsx(Td, { children: a.pickupStop }), _jsx(Td, { children: a.dropStop })] }, a._id))) })] }) })] })] }));
};
