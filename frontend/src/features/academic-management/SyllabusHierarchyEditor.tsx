import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { Textarea } from "components/ui/textarea";
import { FormField } from "components/shared/FormField";
import {
  formatSubUnitDisplayNo,
  formatSubUnitSiblingPreview,
  formatUnitLabel,
  nepaliStructuralLabels,
  nepaliTextClass,
} from "lib/nepaliSubject";
import { cn } from "lib/utils";
import { NEPALI_MONTHS } from "./academicManagementUtils";
import {
  type ChapterDraft,
  type SectionKind,
  type SubUnitDraft,
  type UnitDraft,
  addChildAtPath,
  addSiblingAfterPath,
  appendTopLevelSub,
  countSubUnits,
  emptyChapter,
  emptySubUnit,
  emptyUnit,
  formatSectionLabel,
  moveItem,
  moveSubAtPath,
  removeSubAtPath,
  renumberChapters,
  updateSubAtPath,
} from "./syllabusFormUtils";

interface SyllabusHierarchyEditorProps {
  chapters: ChapterDraft[];
  onChange: (chapters: ChapterDraft[] | ((prev: ChapterDraft[]) => ChapterDraft[])) => void;
  readOnly?: boolean;
  /** When true (e.g. editing existing syllabus), expand all sections and units. */
  defaultExpandAll?: boolean;
  /** Nepali subject: Devanagari font on titles/headings/descriptions. */
  nepaliText?: boolean;
}

/**
 * Recursive sub-unit editor — heading only, unlimited depth.
 *
 * Per row actions:
 *  - Same level → next sibling (1.1.1 → 1.1.2 → 1.1.3)
 *  - Nest → child under this row (1.1 → 1.1.1 → 1.1.1.1)
 */
const SubUnitNodeEditor = ({
  sub,
  path,
  unitNo,
  siblingCount,
  onUpdateTree,
  readOnly,
  nepaliText = false,
}: {
  sub: SubUnitDraft;
  path: number[];
  unitNo: number;
  siblingCount: number;
  onUpdateTree: (
    mutator: (subs: SubUnitDraft[]) => SubUnitDraft[],
  ) => void;
  readOnly?: boolean;
  nepaliText?: boolean;
}) => {
  // Display-only numbering: English 1.1 / Nepali क. ख. — DB still uses numeric subUnitNo
  const displayNo = formatSubUnitDisplayNo(unitNo, path, nepaliText);
  const children: SubUnitDraft[] = Array.isArray(sub.children)
    ? (sub.children as SubUnitDraft[])
    : [];
  const index = path[path.length - 1] ?? 0;
  const nextSiblingPreview = formatSubUnitSiblingPreview(
    unitNo,
    path,
    nepaliText,
    "nextSibling",
  );
  const firstChildPreview = formatSubUnitSiblingPreview(
    unitNo,
    path,
    nepaliText,
    "firstChild",
  );

  const patch = (p: Partial<SubUnitDraft>) => {
    onUpdateTree((subs) => updateSubAtPath(subs, path, p));
  };

  return (
    <div
      className={cn(
        "space-y-1.5",
        path.length > 0 && "ml-0",
        path.length > 1 && "ml-3 border-l-2 border-l-brand-100 pl-3",
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 shadow-sm">
        <span
          className={cn(
            "shrink-0 rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-800",
            nepaliText ? nepaliTextClass : "font-mono",
          )}
          title={`Auto number: ${displayNo}`}
        >
          {displayNo}
        </span>
        <Input
          className="h-8 min-w-[10rem] flex-1 border-slate-200 bg-white px-2 text-sm"
          value={sub.heading}
          disabled={readOnly}
          nepali={nepaliText}
          onChange={(e) => patch({ heading: e.target.value })}
          placeholder={
            nepaliText
              ? `${displayNo} शीर्षक (युनिकोड नेपालीमा लेख्नुहोस् वा पेस्ट गर्नुहोस्)`
              : `Heading for ${displayNo}`
          }
          aria-label={`Heading ${displayNo}`}
        />
        {!readOnly ? (
          <div className="flex flex-wrap items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 shrink-0 border-sky-200 bg-sky-50 text-sky-900 hover:bg-sky-100"
              title={`Add same level after this → ${nextSiblingPreview}`}
              onClick={() => {
                onUpdateTree((subs) =>
                  addSiblingAfterPath(subs, path, emptySubUnit()),
                );
              }}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Same ({nextSiblingPreview})
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 shrink-0 border-violet-200 bg-violet-50 text-violet-900 hover:bg-violet-100"
              title={`Add nested child under this → ${firstChildPreview}`}
              onClick={() => {
                onUpdateTree((subs) =>
                  addChildAtPath(subs, path, emptySubUnit()),
                );
              }}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Nest ({firstChildPreview})
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 shrink-0 text-rose-600 border-rose-200"
              title="Remove this sub-unit (optional — can leave unit with none)"
              onClick={() =>
                onUpdateTree((subs) => removeSubAtPath(subs, path))
              }
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 px-2"
              disabled={index === 0}
              title="Move up (renumbers automatically)"
              onClick={() =>
                onUpdateTree((subs) => moveSubAtPath(subs, path, -1))
              }
            >
              ↑
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 px-2"
              disabled={index >= siblingCount - 1}
              title="Move down (renumbers automatically)"
              onClick={() =>
                onUpdateTree((subs) => moveSubAtPath(subs, path, 1))
              }
            >
              ↓
            </Button>
          </div>
        ) : null}
      </div>

      {/* Nested children always visible so 1.1.1, 1.1.1.1, … can be edited */}
      <div className="space-y-1.5">
        {children.map((child, cIndex) => (
          <SubUnitNodeEditor
            key={child.clientKey}
            sub={child}
            path={[...path, cIndex]}
            unitNo={unitNo}
            siblingCount={children.length}
            onUpdateTree={onUpdateTree}
            readOnly={readOnly}
            nepaliText={nepaliText}
          />
        ))}
        {!readOnly ? (
          <button
            type="button"
            className="ml-1 flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-violet-700 hover:bg-violet-50"
            onClick={() => {
              onUpdateTree((subs) =>
                addChildAtPath(subs, path, emptySubUnit()),
              );
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add under {displayNo} → {firstChildPreview}
            {children.length > 0
              ? ` / ${displayNo}.${children.length + 1}`
              : ""}
          </button>
        ) : null}
      </div>
    </div>
  );
};

export const SyllabusHierarchyEditor = ({
  chapters,
  onChange,
  readOnly = false,
  defaultExpandAll = false,
  nepaliText = false,
}: SyllabusHierarchyEditorProps) => {
  // Always expand sections + units by default so Unit title is visible without hunting
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(
    () => new Set(chapters.map((c) => c.clientKey)),
  );
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(
    () => new Set(chapters.flatMap((c) => c.units.map((u) => u.clientKey))),
  );
  const [dragChapterKey, setDragChapterKey] = useState<string | null>(null);

  // Re-expand when structure keys change (after save IDs swap, or new unit/chapter added)
  // so newly saved units/sub-units stay visible instead of looking "missing".
  const structureKey = useMemo(
    () =>
      chapters
        .map(
          (c) =>
            `${c.clientKey}:${c.units.map((u) => u.clientKey).join(",")}`,
        )
        .join("|"),
    [chapters],
  );

  useEffect(() => {
    if (!defaultExpandAll && structureKey.length === 0) return;
    setExpandedChapters(new Set(chapters.map((c) => c.clientKey)));
    setExpandedUnits(
      new Set(chapters.flatMap((c) => c.units.map((u) => u.clientKey))),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultExpandAll, structureKey]);

  /**
   * Always update via functional form so rapid title edits / adds never
   * overwrite each other with a stale chapters snapshot.
   */
  const setChapters = (
    next: ChapterDraft[] | ((prev: ChapterDraft[]) => ChapterDraft[]),
  ) => {
    onChange((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      return renumberChapters(resolved);
    });
  };

  const allExpanded = useMemo(() => {
    if (chapters.length === 0) return false;
    return chapters.every((c) => expandedChapters.has(c.clientKey));
  }, [chapters, expandedChapters]);

  const expandAll = () => {
    setExpandedChapters(new Set(chapters.map((c) => c.clientKey)));
    setExpandedUnits(
      new Set(chapters.flatMap((c) => c.units.map((u) => u.clientKey))),
    );
  };

  const collapseAll = () => {
    setExpandedChapters(new Set());
    setExpandedUnits(new Set());
  };

  const toggle = (
    set: Set<string>,
    key: string,
    setter: (s: Set<string>) => void,
  ) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  };

  const updateChapter = (cIndex: number, patch: Partial<ChapterDraft>) => {
    setChapters((prev) =>
      prev.map((ch, i) => (i === cIndex ? { ...ch, ...patch } : ch)),
    );
  };

  const updateUnit = (
    cIndex: number,
    uIndex: number,
    patch: Partial<UnitDraft>,
  ) => {
    setChapters((prev) =>
      prev.map((ch, i) => {
        if (i !== cIndex) return ch;
        const units = ch.units.map((u, j) =>
          j === uIndex ? { ...u, ...patch } : u,
        );
        return { ...ch, units };
      }),
    );
  };

  /** Mutate nested sub-unit tree for a unit without stale closures. */
  const mutateUnitSubs = (
    cIndex: number,
    uIndex: number,
    mutator: (subs: SubUnitDraft[]) => SubUnitDraft[],
  ) => {
    setChapters((prev) =>
      prev.map((ch, i) => {
        if (i !== cIndex) return ch;
        return {
          ...ch,
          units: ch.units.map((u, j) => {
            if (j !== uIndex) return u;
            const currentSubs = (u.subUnits ?? []) as SubUnitDraft[];
            return { ...u, subUnits: mutator(currentSubs) };
          }),
        };
      }),
    );
  };

  if (readOnly) {
    return (
      <div className="space-y-3 text-sm text-slate-600">
        Hierarchy is read-only in this mode.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {nepaliText
              ? nepaliStructuralLabels.hierarchy
              : "Syllabus hierarchy"}
          </p>
          <p className="text-xs text-slate-500">
            {nepaliText
              ? "विषय → वैकल्पिक अध्याय वा भाग → एकाइ → उप–एकाइ। एकाइ नम्बर अध्यायभर निरन्तर: अध्याय-१ (एकाइ १–५), अध्याय-२ (एकाइ ६–१०)… उप–एकाइ: क. ख. ग.…"
              : "Subject → optional Chapter or Part (pick one) → Unit → Sub Unit. Unit numbers continue across chapters (Ch-1: units 1–5, Ch-2: units 6–10…). Sub-units: 1.1, 6.1, …"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={allExpanded ? collapseAll : expandAll}
          >
            {allExpanded ? (
              <>
                <ChevronsDownUp className="mr-1.5 h-4 w-4" />
                Collapse All
              </>
            ) : (
              <>
                <ChevronsUpDown className="mr-1.5 h-4 w-4" />
                Expand All
              </>
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              // Always append a unit to the last section (or create a units-only section)
              let newUnitKey = "";
              let expandChapterKey = "";
              setChapters((prev) => {
                if (prev.length === 0) {
                  const ch = emptyChapter(1, "NONE");
                  const unit = emptyUnit(1);
                  newUnitKey = unit.clientKey;
                  expandChapterKey = ch.clientKey;
                  return [{ ...ch, units: [unit] }];
                }
                const lastIdx = prev.length - 1;
                const last = prev[lastIdx]!;
                const unit = emptyUnit(
                  prev.reduce((n, c) => n + c.units.length, 0) + 1,
                );
                newUnitKey = unit.clientKey;
                expandChapterKey = last.clientKey;
                return prev.map((ch, i) =>
                  i === lastIdx
                    ? { ...ch, units: [...ch.units, unit] }
                    : ch,
                );
              });
              if (expandChapterKey) {
                setExpandedChapters((s) => new Set(s).add(expandChapterKey));
              }
              if (newUnitKey) {
                setExpandedUnits((s) => new Set(s).add(newUnitKey));
              }
            }}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {nepaliText ? "एकाइ थप्नुहोस्" : "Add Unit"}
          </Button>
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-1">
            <span className="px-1.5 text-xs text-slate-500">
              {nepaliText ? "खण्ड" : "Section"}
            </span>
            <Select
              className="h-8 w-[130px] border-0 bg-white text-sm shadow-sm"
              defaultValue=""
              value=""
              onChange={(e) => {
                const kind = e.target.value as SectionKind | "";
                if (!kind) return;
                setChapters((prev) => [
                  ...prev,
                  emptyChapter(prev.length + 1, kind),
                ]);
                // reset select to placeholder
                e.target.value = "";
              }}
            >
              <option value="" disabled>
                {nepaliText ? "खण्ड प्रकार…" : "Optional…"}
              </option>
              <option value="NONE">
                {nepaliText ? "एकाइ मात्र" : "Units only"}
              </option>
              <option value="CHAPTER">
                {nepaliText ? "अध्याय" : "Chapter"}
              </option>
              <option value="PART">{nepaliText ? "भाग" : "Part"}</option>
            </Select>
          </div>
        </div>
      </div>

      {chapters.map((chapter, cIndex) => {
        const chOpen = expandedChapters.has(chapter.clientKey);
        const units = chapter.units;
        const kind = ((chapter.sectionKind as SectionKind) || "NONE") as SectionKind;
        const sectionNo = chapter.chapterNo || cIndex + 1;

        return (
          <div
            key={chapter.clientKey}
            className={cn(
              "rounded-2xl border border-slate-200 bg-white shadow-sm transition",
              dragChapterKey === chapter.clientKey &&
                "opacity-60 ring-2 ring-brand-300",
            )}
            draggable
            onDragStart={() => setDragChapterKey(chapter.clientKey)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (!dragChapterKey) return;
              const from = chapters.findIndex(
                (c) => c.clientKey === dragChapterKey,
              );
              if (from < 0) return;
              setChapters(moveItem(chapters, from, cIndex));
              setDragChapterKey(null);
            }}
            onDragEnd={() => setDragChapterKey(null)}
          >
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
              <button
                type="button"
                className="cursor-grab text-slate-400 hover:text-slate-600"
                title="Drag to reorder section"
                aria-label="Drag section"
              >
                <GripVertical className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"
                onClick={() =>
                  toggle(
                    expandedChapters,
                    chapter.clientKey,
                    setExpandedChapters,
                  )
                }
              >
                {chOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm font-semibold text-slate-900",
                    nepaliText && nepaliTextClass,
                  )}
                >
                  {formatSectionLabel(
                    kind,
                    sectionNo,
                    chapter.title,
                    nepaliText,
                  )}
                </p>
                <p className="text-xs text-slate-500">
                  {kind === "NONE"
                    ? nepaliText
                      ? "अध्याय / भाग छैन (वैकल्पिक समूह छोडियो)"
                      : "No Chapter or Part (optional grouping skipped)"
                    : kind === "CHAPTER"
                      ? nepaliText
                        ? "अध्याय समूह"
                        : "Chapter grouping"
                      : nepaliText
                        ? "भाग समूह"
                        : "Part grouping"}
                  {" · "}
                  {units.length}{" "}
                  {nepaliText
                    ? nepaliStructuralLabels.unit
                    : `unit${units.length === 1 ? "" : "s"}`}{" "}
                  ·{" "}
                  {units.reduce((n, u) => n + countSubUnits(u.subUnits), 0)}{" "}
                  {nepaliText
                    ? nepaliStructuralLabels.subUnit
                    : "sub-unit(s)"}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const newUnit = emptyUnit(units.length + 1);
                    updateChapter(cIndex, {
                      units: [...units, newUnit],
                    });
                    setExpandedChapters(
                      (s) => new Set(s).add(chapter.clientKey),
                    );
                    // Expand so the Unit title field is immediately visible
                    setExpandedUnits((s) => new Set(s).add(newUnit.clientKey));
                  }}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  {nepaliText ? nepaliStructuralLabels.unit : "Unit"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  title="Duplicate chapter"
                  onClick={() => {
                    const clone: ChapterDraft = {
                      ...structuredClone(chapter),
                      clientKey: emptyChapter().clientKey,
                      title: chapter.title
                        ? `${chapter.title} (copy)`
                        : "",
                      units: chapter.units.map((u) => ({
                        ...structuredClone(u),
                        clientKey: emptyUnit().clientKey,
                        subUnits: structuredClone(u.subUnits).map((s) => {
                          const rekey = (node: SubUnitDraft): SubUnitDraft => ({
                            ...node,
                            clientKey: emptySubUnit().clientKey,
                            children: (node.children ?? []).map(rekey),
                          });
                          return rekey(s);
                        }),
                      })),
                    };
                    const next = [...chapters];
                    next.splice(cIndex + 1, 0, clone);
                    setChapters(next);
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="text-rose-600 border-rose-200 hover:bg-rose-50"
                  disabled={chapters.length <= 1}
                  onClick={() => {
                    if (chapters.length <= 1) return;
                    setChapters((prev) => prev.filter((_, i) => i !== cIndex));
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {chOpen ? (
              <div className="space-y-4 p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <FormField label="Section type (optional — Chapter or Part, not both)">
                    <Select
                      value={kind}
                      onChange={(e) => {
                        const nextKind = e.target.value as SectionKind;
                        updateChapter(cIndex, {
                          sectionKind: nextKind,
                          title: nextKind === "NONE" ? "" : chapter.title,
                        });
                      }}
                    >
                      <option value="NONE">
                        {nepaliText
                          ? "कुनै होइन — एकाइ मात्र"
                          : "None — units only"}
                      </option>
                      <option value="CHAPTER">
                        {nepaliText ? "अध्याय" : "Chapter"}
                      </option>
                      <option value="PART">
                        {nepaliText ? "भाग" : "Part"}
                      </option>
                    </Select>
                  </FormField>
                  {kind !== "NONE" ? (
                    <FormField
                      label={
                        kind === "CHAPTER"
                          ? nepaliText
                            ? "अध्याय शीर्षक"
                            : "Chapter title"
                          : nepaliText
                            ? "भाग शीर्षक"
                            : "Part title"
                      }
                    >
                      <Input
                        value={chapter.title}
                        nepali={nepaliText}
                        onChange={(e) =>
                          updateChapter(cIndex, { title: e.target.value })
                        }
                        placeholder={
                          nepaliText
                            ? kind === "CHAPTER"
                              ? "अध्यायको शीर्षक"
                              : "भागको शीर्षक"
                            : kind === "CHAPTER"
                              ? "e.g. Human Body"
                              : "e.g. Fundamentals"
                        }
                      />
                    </FormField>
                  ) : (
                    <div className="flex items-end">
                      <p className="pb-2 text-xs text-slate-500">
                        No Chapter or Part selected. Add units directly under
                        this section.
                      </p>
                    </div>
                  )}
                  {kind !== "NONE" ? (
                    <>
                      <FormField label="Estimated hours">
                        <NumberInput
                          min={0}
                          value={
                            Number.isFinite(chapter.estimatedHours)
                              ? chapter.estimatedHours
                              : ""
                          }
                          onChange={(e) =>
                            updateChapter(cIndex, {
                              estimatedHours: Number.isFinite(
                                e.target.valueAsNumber,
                              )
                                ? e.target.valueAsNumber
                                : Number.NaN,
                            })
                          }
                        />
                      </FormField>
                      <FormField label="Weightage %">
                        <NumberInput
                          min={0}
                          max={100}
                          value={
                            Number.isFinite(chapter.weightagePercent)
                              ? chapter.weightagePercent
                              : ""
                          }
                          onChange={(e) =>
                            updateChapter(cIndex, {
                              weightagePercent: Number.isFinite(
                                e.target.valueAsNumber,
                              )
                                ? e.target.valueAsNumber
                                : Number.NaN,
                            })
                          }
                        />
                      </FormField>
                      <FormField label="Expected completion month">
                        <Select
                          value={chapter.tentativeCompletionMonth || ""}
                          onChange={(e) =>
                            updateChapter(cIndex, {
                              tentativeCompletionMonth: e.target.value,
                            })
                          }
                        >
                          <option value="">Optional</option>
                          {NEPALI_MONTHS.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                      <div className="md:col-span-2">
                        <FormField
                          label={
                            kind === "CHAPTER"
                              ? "Chapter description (optional)"
                              : "Part description (optional)"
                          }
                        >
                          <Textarea
                            value={chapter.description || ""}
                            nepali={nepaliText}
                            onChange={(e) =>
                              updateChapter(cIndex, {
                                description: e.target.value,
                              })
                            }
                            placeholder={
                              nepaliText ? "संक्षिप्त विवरण" : "Brief overview"
                            }
                          />
                        </FormField>
                      </div>
                    </>
                  ) : null}
                </div>

                <div className="space-y-3">
                  {units.map((unit, uIndex) => {
                    const uOpen = expandedUnits.has(unit.clientKey);
                    const subUnits = unit.subUnits;

                    return (
                      <div
                        key={unit.clientKey}
                        className="rounded-xl border border-slate-200 bg-slate-50/60"
                      >
                        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                          <button
                            type="button"
                            className="rounded p-1 text-slate-500 hover:bg-white"
                            onClick={() =>
                              toggle(
                                expandedUnits,
                                unit.clientKey,
                                setExpandedUnits,
                              )
                            }
                          >
                            {uOpen ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                          <p
                            className={cn(
                              "shrink-0 text-sm font-medium text-slate-800",
                              nepaliText && nepaliTextClass,
                            )}
                          >
                            {formatUnitLabel(unit.unitNo || uIndex + 1, {
                              nepali: nepaliText,
                            })}
                          </p>
                          {/* Title always editable (even when row is collapsed) — optional to save */}
                          <Input
                            className="min-w-[10rem] flex-1"
                            value={unit.title}
                            nepali={nepaliText}
                            onChange={(e) =>
                              updateUnit(cIndex, uIndex, {
                                title: e.target.value,
                              })
                            }
                            placeholder={
                              nepaliText
                                ? "एकाइको शीर्षक (वैकल्पिक)"
                                : "Unit title (optional)"
                            }
                            aria-label={
                              nepaliText
                                ? "एकाइको शीर्षक"
                                : "Unit title (optional)"
                            }
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8"
                            title="Optional — not required to save the syllabus"
                            onClick={() => {
                              updateUnit(cIndex, uIndex, {
                                subUnits: [
                                  ...subUnits,
                                  emptySubUnit(subUnits.length + 1),
                                ],
                              });
                              setExpandedUnits(
                                (s) => new Set(s).add(unit.clientKey),
                              );
                            }}
                          >
                            <Plus className="mr-1 h-3.5 w-3.5" />
                            {nepaliText
                              ? `${nepaliStructuralLabels.subUnit} (वैकल्पिक)`
                              : "Sub Unit (optional)"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8"
                            title="Duplicate unit"
                            onClick={() => {
                              const rekey = (
                                node: SubUnitDraft,
                              ): SubUnitDraft => ({
                                ...structuredClone(node),
                                clientKey: emptySubUnit().clientKey,
                                children: (node.children ?? []).map(rekey),
                              });
                              const clone: UnitDraft = {
                                ...structuredClone(unit),
                                clientKey: emptyUnit().clientKey,
                                title: `${unit.title || (nepaliText ? nepaliStructuralLabels.unit : "Unit")} (copy)`,
                                subUnits: subUnits.map(rekey),
                              };
                              const next = [...units];
                              next.splice(uIndex + 1, 0, clone);
                              updateChapter(cIndex, { units: next });
                            }}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 text-rose-600 border-rose-200"
                            disabled={units.length <= 1}
                            onClick={() => {
                              if (units.length <= 1) return;
                              setChapters((prev) =>
                                prev.map((ch, i) =>
                                  i !== cIndex
                                    ? ch
                                    : {
                                        ...ch,
                                        units: ch.units.filter(
                                          (_, j) => j !== uIndex,
                                        ),
                                      },
                                ),
                              );
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2"
                            disabled={uIndex === 0}
                            onClick={() =>
                              updateChapter(cIndex, {
                                units: moveItem(units, uIndex, uIndex - 1),
                              })
                            }
                            title="Move up"
                          >
                            ↑
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2"
                            disabled={uIndex >= units.length - 1}
                            onClick={() =>
                              updateChapter(cIndex, {
                                units: moveItem(units, uIndex, uIndex + 1),
                              })
                            }
                            title="Move down"
                          >
                            ↓
                          </Button>
                        </div>

                        {uOpen ? (
                          <div className="space-y-3 border-t border-slate-200 p-3">
                            <div className="grid gap-3 md:grid-cols-2">
                              <FormField
                                label={
                                  nepaliText
                                    ? nepaliStructuralLabels.unitNumber
                                    : "Unit number"
                                }
                              >
                                <Input
                                  value={String(unit.unitNo || uIndex + 1)}
                                  disabled
                                  className="bg-slate-100"
                                />
                              </FormField>
                              <FormField
                                label={
                                  nepaliText
                                    ? `${nepaliStructuralLabels.unitTitle} (वैकल्पिक)`
                                    : "Unit title (optional)"
                                }
                              >
                                <Input
                                  value={unit.title}
                                  nepali={nepaliText}
                                  onChange={(e) =>
                                    updateUnit(cIndex, uIndex, {
                                      title: e.target.value,
                                    })
                                  }
                                  placeholder={
                                    nepaliText
                                      ? "एकाइको शीर्षक — युनिकोड नेपाली लेख्नुहोस् वा पेस्ट गर्नुहोस्"
                                      : "e.g. Introduction to Human Anatomy"
                                  }
                                />
                              </FormField>
                              <FormField
                                label={
                                  nepaliText
                                    ? `${nepaliStructuralLabels.teachingHours} (${nepaliStructuralLabels.hoursPerWeekHint})`
                                    : "Teaching hours"
                                }
                              >
                                <NumberInput
                                  min={0}
                                  value={
                                    Number.isFinite(unit.teachingHours)
                                      ? unit.teachingHours
                                      : ""
                                  }
                                  onChange={(e) =>
                                    updateUnit(cIndex, uIndex, {
                                      teachingHours: Number.isFinite(
                                        e.target.valueAsNumber,
                                      )
                                        ? e.target.valueAsNumber
                                        : Number.NaN,
                                    })
                                  }
                                />
                              </FormField>
                              <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-slate-300"
                                  checked={Boolean(unit.practicalRequired)}
                                  onChange={(e) =>
                                    updateUnit(cIndex, uIndex, {
                                      practicalRequired: e.target.checked,
                                    })
                                  }
                                />
                                {nepaliText
                                  ? nepaliStructuralLabels.practicalRequired
                                  : "Practical required"}
                              </label>
                              <div className="md:col-span-2">
                                <FormField
                                  label={
                                    nepaliText
                                      ? `${nepaliStructuralLabels.description} (वैकल्पिक)`
                                      : "Description (optional)"
                                  }
                                >
                                  <Textarea
                                    value={unit.description || ""}
                                    nepali={nepaliText}
                                    onChange={(e) =>
                                      updateUnit(cIndex, uIndex, {
                                        description: e.target.value,
                                      })
                                    }
                                    placeholder={
                                      nepaliText
                                        ? "विवरण — युनिकोड वा Preeti बाट पेस्ट गर्न सकिन्छ"
                                        : undefined
                                    }
                                  />
                                </FormField>
                              </div>
                              <FormField
                                label={
                                  nepaliText
                                    ? nepaliStructuralLabels.learningOutcomes
                                    : "Learning outcomes"
                                }
                              >
                                <Textarea
                                  value={unit.learningObjective || ""}
                                  nepali={nepaliText}
                                  onChange={(e) =>
                                    updateUnit(cIndex, uIndex, {
                                      learningObjective: e.target.value,
                                    })
                                  }
                                  placeholder={
                                    nepaliText
                                      ? "सिकाइ उपलब्धिहरू…"
                                      : "Students will be able to…"
                                  }
                                />
                              </FormField>
                              <FormField
                                label={
                                  nepaliText
                                    ? nepaliStructuralLabels.references
                                    : "References"
                                }
                              >
                                <Textarea
                                  value={unit.references || ""}
                                  nepali={nepaliText}
                                  onChange={(e) =>
                                    updateUnit(cIndex, uIndex, {
                                      references: e.target.value,
                                    })
                                  }
                                  placeholder={
                                    nepaliText ? "सन्दर्भ सामग्री" : undefined
                                  }
                                />
                              </FormField>
                            </div>

                            <div className="space-y-2 rounded-xl border border-dashed border-slate-200 bg-white/70 p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                                    {nepaliText
                                      ? "उप–एकाइ (वैकल्पिक) — शीर्षक मात्र · क. ख. ग."
                                      : "Sub units (optional) — headings only"}
                                  </p>
                                  <p className="text-[11px] text-slate-500">
                                    {nepaliText
                                      ? "सेभ गर्न अनिवार्य होइन। एकाइ शीर्षक मात्र भए पुग्छ। नम्बर स्वतः: क. ख. ग."
                                      : "Not required to save. Leave empty if you only need unit titles. Use "}
                                    {!nepaliText ? (
                                      <>
                                        <span className="font-medium text-sky-800">
                                          Same
                                        </span>{" "}
                                        for 1.1 → 1.2 or{" "}
                                        <span className="font-medium text-violet-800">
                                          Nest
                                        </span>{" "}
                                        for 1.1 → 1.1.1. Numbers auto-fill.
                                      </>
                                    ) : null}
                                  </p>
                                  {subUnits.length === 0 ? (
                                    <p className="mt-1 text-[11px] text-emerald-700">
                                      {nepaliText
                                        ? "उप–एकाइ छैन — एकाइ शीर्षक मात्र पर्याप्त छ।"
                                        : "No sub-units — unit title alone is enough to save."}
                                    </p>
                                  ) : null}
                                </div>
                                <span className="text-xs text-slate-500">
                                  {countSubUnits(subUnits)} heading
                                  {countSubUnits(subUnits) === 1 ? "" : "s"}
                                </span>
                              </div>
                              {subUnits.map((sub, sIndex) => (
                                <SubUnitNodeEditor
                                  key={sub.clientKey}
                                  sub={sub}
                                  path={[sIndex]}
                                  unitNo={unit.unitNo || uIndex + 1}
                                  siblingCount={subUnits.length}
                                  nepaliText={nepaliText}
                                  onUpdateTree={(mutator) =>
                                    mutateUnitSubs(cIndex, uIndex, mutator)
                                  }
                                />
                              ))}
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="mt-1"
                                onClick={() =>
                                  mutateUnitSubs(cIndex, uIndex, (subs) =>
                                    appendTopLevelSub(subs),
                                  )
                                }
                              >
                                <Plus className="mr-1.5 h-3.5 w-3.5" />
                                Add sub unit{" "}
                                {unit.unitNo || uIndex + 1}.
                                {subUnits.length + 1}
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
