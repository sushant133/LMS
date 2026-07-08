import { useMutation, useQuery } from "@tanstack/react-query";
import {
  canManageInstitution,
  formatAcademicYearLabel,
  type AcademicCalendarEventInput,
  type AcademicCalendarEventRecord,
  type AcademicCalendarFilters
} from "@phit-erp/shared";
import { Download, FileSpreadsheet, Printer, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, TableHead, Td, Th } from "components/ui/table";
import { useAuth } from "features/auth/AuthProvider";
import { api, unwrap } from "lib/api";
import { downloadPdfFromElementById, printElementById } from "lib/printUtils";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";
import { AcademicCalendarMonth } from "./AcademicCalendarMonth";
import { EventDetailDialog } from "./EventDetailDialog";
import { EventFormDialog } from "./EventFormDialog";
import {
  buildAcademicYearMonths,
  defaultCalendarFilters,
  eventTypeOptions,
  exportEventsExcel,
  filterEventsLocally,
  formatMonthKey,
  getEventTypeLabel,
  groupEventsByDate,
  resolvePreferredAcademicYear
} from "./academicCalendarUtils";

export const AcademicCalendarHub = () => {
  const { user } = useAuth();
  const canManage = canManageInstitution(user?.role ?? "");
  const schoolAcademicYearBs = user?.school?.academicYearBs ?? "";
  const [academicYearBs, setAcademicYearBs] = useState(schoolAcademicYearBs);
  const [draftFilters, setDraftFilters] = useState<AcademicCalendarFilters>(defaultCalendarFilters());
  const [appliedFilters, setAppliedFilters] = useState<AcademicCalendarFilters>(defaultCalendarFilters());
  const [selectedDateBs, setSelectedDateBs] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<AcademicCalendarEventRecord[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<AcademicCalendarEventRecord | null>(null);

  const yearsQuery = useQuery({
    queryKey: ["academic-calendar", "years"],
    queryFn: () => unwrap<string[]>(api.get("/academic-calendar/years"))
  });

  const dashboardQuery = useQuery({
    queryKey: ["academic-calendar", "dashboard", academicYearBs],
    queryFn: () =>
      unwrap<{ todayBs: string; academicYearBs?: string }>(
        api.get("/academic-calendar/dashboard", { params: academicYearBs ? { academicYearBs } : undefined })
      ),
    enabled: Boolean(academicYearBs) || yearsQuery.isSuccess
  });

  const eventsQuery = useQuery({
    queryKey: ["academic-calendar", "events", academicYearBs],
    queryFn: () =>
      unwrap<AcademicCalendarEventRecord[]>(
        api.get("/academic-calendar/events", { params: { academicYearBs } })
      ),
    enabled: Boolean(academicYearBs)
  });

  const resolvedYear =
    academicYearBs ||
    resolvePreferredAcademicYear(yearsQuery.data, schoolAcademicYearBs || dashboardQuery.data?.academicYearBs);
  const todayBs = dashboardQuery.data?.todayBs ?? "";
  const allMonths = buildAcademicYearMonths(resolvedYear);
  const months = appliedFilters.monthBs
    ? allMonths.filter((month) => formatMonthKey(month.year, month.month) === appliedFilters.monthBs)
    : allMonths;
  const events = eventsQuery.data ?? [];
  const filteredEvents = useMemo(
    () => filterEventsLocally(events, appliedFilters),
    [events, appliedFilters]
  );
  const eventsByDate = useMemo(() => groupEventsByDate(events), [events]);

  /** Holiday & Event List shows only the clicked date (still respects active filters). */
  const dateScopedEvents = useMemo(() => {
    if (!selectedDateBs) return [];
    return filteredEvents.filter((event) => event.dateBs === selectedDateBs);
  }, [filteredEvents, selectedDateBs]);

  const saveMutation = useMutation({
    mutationFn: async ({ payload, isEdit }: { payload: AcademicCalendarEventInput; isEdit: boolean }) => {
      if (isEdit && editingEvent) {
        return unwrap<AcademicCalendarEventRecord>(api.put(`/academic-calendar/events/${editingEvent._id}`, payload));
      }
      return unwrap<AcademicCalendarEventRecord>(api.post("/academic-calendar/events", payload));
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["academic-calendar"] });
      setFormOpen(false);
      setEditingEvent(null);
      setDetailOpen(false);
      toast.success(variables.isEdit ? "Event updated" : "Event saved");
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const deleteMutation = useMutation({
    mutationFn: (eventId: string) => unwrap(api.delete(`/academic-calendar/events/${eventId}`)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["academic-calendar"] });
      setDetailOpen(false);
      toast.success("Event deleted");
    },
    onError: (error) => toast.error(parseErrorMessage(error))
  });

  const handleDateClick = (dateBs: string, dayEvents: AcademicCalendarEventRecord[]) => {
    setSelectedDateBs(dateBs);
    setSelectedEvents(dayEvents);

    if (canManage && dayEvents.length === 0) {
      setEditingEvent(null);
      setFormOpen(true);
      return;
    }

    if (dayEvents.length > 0) {
      setDetailOpen(true);
    }
  };

  const handleApplyFilters = () => {
    setAppliedFilters({ ...draftFilters, academicYearBs: resolvedYear });
  };

  const handleExportExcel = () => {
    const rows = selectedDateBs ? dateScopedEvents : filteredEvents;
    exportEventsExcel(rows, `academic-calendar-${resolvedYear.replace("/", "-")}.xlsx`);
  };

  const handlePrint = () => printElementById("academic-calendar-print");
  const handleDownloadPdf = () =>
    downloadPdfFromElementById("academic-calendar-print", `academic-calendar-${resolvedYear.replace("/", "-")}.pdf`);

  // Always land on the institution's current academic year (not the newest year in the list).
  useEffect(() => {
    if (academicYearBs) return;

    const preferred = resolvePreferredAcademicYear(
      yearsQuery.data,
      schoolAcademicYearBs || dashboardQuery.data?.academicYearBs
    );
    if (preferred) {
      setAcademicYearBs(preferred);
    }
  }, [academicYearBs, yearsQuery.data, schoolAcademicYearBs, dashboardQuery.data?.academicYearBs]);

  // If auth school year loads after mount and user hasn't picked another year, sync to current.
  useEffect(() => {
    if (!schoolAcademicYearBs) return;
    if (!academicYearBs) {
      setAcademicYearBs(schoolAcademicYearBs);
    }
  }, [schoolAcademicYearBs, academicYearBs]);

  useEffect(() => {
    setAppliedFilters((current) => ({ ...current, academicYearBs: resolvedYear }));
  }, [resolvedYear]);

  // Keep selected-date list in sync when events reload after create/edit/delete.
  useEffect(() => {
    if (!selectedDateBs) {
      setSelectedEvents([]);
      return;
    }
    setSelectedEvents(eventsByDate.get(selectedDateBs) ?? []);
  }, [eventsByDate, selectedDateBs]);

  // Clear date selection when academic year changes.
  useEffect(() => {
    setSelectedDateBs("");
    setSelectedEvents([]);
    setDetailOpen(false);
  }, [resolvedYear]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Academic Calendar ${formatAcademicYearLabel(resolvedYear)}`}
        description="Official institutional calendar using Bikram Sambat (BS) with English month names."
        action={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={handlePrint}>
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
            <Button type="button" variant="outline" onClick={handleDownloadPdf}>
              <Download className="mr-2 h-4 w-4" />
              PDF
            </Button>
            <Button type="button" variant="outline" onClick={handleExportExcel}>
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Excel
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="grid gap-4 p-4 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Academic Year</label>
            <Select value={resolvedYear} onChange={(event) => setAcademicYearBs(event.target.value)}>
              {(yearsQuery.data ?? [resolvedYear]).map((year) => (
                <option key={year} value={year}>
                  {formatAcademicYearLabel(year)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">BS Month</label>
            <Select
              value={draftFilters.monthBs ?? ""}
              onChange={(event) => setDraftFilters((current) => ({ ...current, monthBs: event.target.value }))}
            >
              <option value="">All months</option>
              {allMonths.map((month) => (
                <option key={formatMonthKey(month.year, month.month)} value={formatMonthKey(month.year, month.month)}>
                  {month.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Event Category</label>
            <Select
              value={draftFilters.eventType ?? ""}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  eventType: (event.target.value || undefined) as AcademicCalendarFilters["eventType"]
                }))
              }
            >
              <option value="">All categories</option>
              {eventTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Search</label>
            <div className="flex gap-2">
              <Input
                value={draftFilters.keyword ?? ""}
                onChange={(event) => setDraftFilters((current) => ({ ...current, keyword: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    handleApplyFilters();
                  }
                }}
                placeholder="BS/AD date, name, type..."
              />
              <Button type="button" onClick={handleApplyFilters}>
                <Search className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div id="academic-calendar-print" className="space-y-6">
        {eventsQuery.isPending ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 12 }).map((_, index) => (
              <div key={index} className="h-52 animate-pulse rounded-2xl border border-slate-200 bg-white" />
            ))}
          </div>
        ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {months.map((month) => (
            <AcademicCalendarMonth
              key={`${month.year}-${month.month}`}
              year={month.year}
              month={month.month}
              monthName={month.name}
              eventsByDate={eventsByDate}
              todayBs={todayBs}
              selectedDateBs={selectedDateBs}
              onDateClick={handleDateClick}
            />
          ))}
        </div>
        )}

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <div>
              <CardTitle>Holiday &amp; Event List</CardTitle>
              <p className="mt-1 text-sm text-slate-500">
                {selectedDateBs
                  ? `Showing holidays and events for ${selectedDateBs}`
                  : "Click a date on the calendar to view its holidays and events."}
              </p>
            </div>
            {selectedDateBs ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedDateBs("");
                  setSelectedEvents([]);
                  setDetailOpen(false);
                }}
              >
                Clear date
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {!selectedDateBs ? (
              <EmptyState
                title="No date selected"
                description="Click any date in the academic calendar above to list holidays and events for that day."
              />
            ) : dateScopedEvents.length === 0 ? (
              <EmptyState
                title="No holidays or events on this date"
                description={
                  canManage
                    ? `Nothing is scheduled for ${selectedDateBs}. You can add an event from the date dialog.`
                    : `Nothing is scheduled for ${selectedDateBs}.`
                }
              />
            ) : (
              <Table>
                <TableHead>
                  <tr>
                    <Th>BS Date</Th>
                    <Th>AD Date</Th>
                    <Th>Day</Th>
                    <Th>Holiday/Event</Th>
                    <Th>Type</Th>
                    <Th>Reason</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {dateScopedEvents.map((event) => (
                    <tr
                      key={event._id}
                      className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                      onClick={() => {
                        setSelectedEvents(eventsByDate.get(event.dateBs) ?? [event]);
                        setDetailOpen(true);
                      }}
                    >
                      <Td>{event.dateBs}</Td>
                      <Td>{event.dateAd}</Td>
                      <Td>{event.dayOfWeek}</Td>
                      <Td className={event.isHoliday ? "font-medium text-red-700" : ""}>{event.name}</Td>
                      <Td>{getEventTypeLabel(event.eventType)}</Td>
                      <Td>{event.reason ?? "—"}</Td>
                    </tr>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="no-print flex flex-wrap gap-3 text-xs text-slate-600">
          {eventTypeOptions.map((option) => (
            <span key={option.value} className="inline-flex items-center gap-1">
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: option.color }} />
              {option.label}
            </span>
          ))}
        </div>
      </div>

      <EventDetailDialog
        open={detailOpen}
        dateBs={selectedDateBs}
        events={selectedEvents}
        canManage={canManage}
        deleting={deleteMutation.isPending}
        onClose={() => setDetailOpen(false)}
        onEdit={(event) => {
          setEditingEvent(event);
          setFormOpen(true);
          setDetailOpen(false);
        }}
        onDelete={(event) => deleteMutation.mutate(event._id)}
        onAdd={() => {
          setEditingEvent(null);
          setFormOpen(true);
          setDetailOpen(false);
        }}
      />

      <EventFormDialog
        open={formOpen}
        academicYearBs={resolvedYear}
        dateBs={selectedDateBs}
        editingEvent={editingEvent}
        saving={saveMutation.isPending}
        onClose={() => {
          setFormOpen(false);
          setEditingEvent(null);
        }}
        onSave={async (payload) => {
          await saveMutation.mutateAsync({ payload, isEdit: Boolean(editingEvent) });
        }}
      />
    </div>
  );
};