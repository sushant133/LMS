import mongoose from "mongoose";
import NepaliDateImport from "nepali-date-converter";
import type {
  BiometricPersonType,
  BiometricPunchAction,
  BiometricPunchItemInput,
  BiometricPunchResult,
  BiometricPunchResultItem,
  BiometricPunchType,
  EmployeeAttendanceStatus,
  StudentCampusAttendanceStatus
} from "@phit-erp/shared";
import { env } from "../config/env.js";
import { BiometricPunchLog } from "../models/BiometricPunchLog.js";
import { CollegeStaff } from "../models/CollegeStaff.js";
import { EmployeeAttendance } from "../models/EmployeeAttendance.js";
import { Setting } from "../models/Setting.js";
import { Student } from "../models/Student.js";
import { StudentCampusAttendance } from "../models/StudentCampusAttendance.js";
import { Teacher } from "../models/Teacher.js";
import { User } from "../models/User.js";
import { ApiError } from "./apiError.js";
import { biometricCodeVariants, normalizeBiometricCode } from "./biometricCode.js";
import { getTodayBs } from "./nepaliDate.js";

/** Nepal (NPT) is UTC+5:45. */
const NEPAL_OFFSET_MS = 345 * 60_000;

type NepaliDateInstance = {
  getYear(): number;
  getMonth(): number;
  getDate(): number;
};
type NepaliDateConstructor = new (value?: string | number | Date) => NepaliDateInstance;

const NepaliDate = ((NepaliDateImport as { default?: NepaliDateConstructor }).default ??
  NepaliDateImport) as NepaliDateConstructor;

const PROTECTED_EMPLOYEE_STATUSES = new Set<EmployeeAttendanceStatus>([
  "LEAVE",
  "HOLIDAY",
  "OFFICIAL_DUTY"
]);

const PROTECTED_STUDENT_STATUSES = new Set<StudentCampusAttendanceStatus>([
  "LEAVE",
  "MEDICAL_LEAVE"
]);

const isObjectId = (value: string): boolean => mongoose.Types.ObjectId.isValid(value);

export const isBiometricAttendanceEnabled = (): boolean => env.BIOMETRIC_ATTENDANCE_ENABLED;

export interface NepalPunchClock {
  punchAt: Date;
  dateBs: string;
  timeHm: string;
}

/** Convert a Date (or now) into Nepal BS date + HH:mm wall clock. */
export const toNepalPunchClock = (input?: Date | string): NepalPunchClock => {
  let punchAt: Date;
  if (input === undefined) {
    punchAt = new Date();
  } else if (typeof input === "string") {
    punchAt = new Date(input);
    if (Number.isNaN(punchAt.getTime())) {
      throw new ApiError(400, `Invalid punchTime: ${input}`);
    }
  } else {
    punchAt = input;
  }

  const nepal = new Date(punchAt.getTime() + NEPAL_OFFSET_MS);
  const y = nepal.getUTCFullYear();
  const m = nepal.getUTCMonth();
  const d = nepal.getUTCDate();
  const hh = String(nepal.getUTCHours()).padStart(2, "0");
  const mm = String(nepal.getUTCMinutes()).padStart(2, "0");
  const timeHm = `${hh}:${mm}`;

  // Civil AD day in Nepal → BS (same approach as getNepalTodayAdDate)
  const adForBs = new Date(y, m, d, 12, 0, 0);
  const bs = new NepaliDate(adForBs);
  const dateBs = `${bs.getYear()}-${String(bs.getMonth() + 1).padStart(2, "0")}-${String(bs.getDate()).padStart(2, "0")}`;

  return { punchAt, dateBs, timeHm };
};

const timeToMinutes = (hm: string): number => {
  const [h, m] = hm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

const isLate = (timeHm: string, thresholdHm: string): boolean =>
  timeToMinutes(timeHm) > timeToMinutes(thresholdHm);

const resolveSchoolId = (itemSchoolId?: string): mongoose.Types.ObjectId => {
  const raw = itemSchoolId?.trim() || env.BIOMETRIC_DEFAULT_SCHOOL_ID;
  if (!raw || !isObjectId(raw)) {
    throw new ApiError(
      400,
      "schoolId is required (or set BIOMETRIC_DEFAULT_SCHOOL_ID on the server)"
    );
  }
  return new mongoose.Types.ObjectId(raw);
};

const resolveSystemActorId = async (
  schoolId: mongoose.Types.ObjectId
): Promise<mongoose.Types.ObjectId> => {
  const admin =
    (await User.findOne({
      schoolId,
      role: { $in: ["COLLEGE_ADMIN", "SUPER_ADMIN"] },
      isActive: true
    })
      .select("_id")
      .lean()) ??
    (await User.findOne({ role: "SUPER_ADMIN", isActive: true }).select("_id").lean()) ??
    (await User.findOne({ schoolId, isActive: true }).select("_id").lean());

  if (!admin?._id) {
    throw new ApiError(500, "No active user available as biometric system actor");
  }
  return admin._id as mongoose.Types.ObjectId;
};

type ResolvedPerson =
  | {
      personType: "STUDENT";
      personId: mongoose.Types.ObjectId;
      admissionNumber: string;
    }
  | {
      personType: "TEACHER";
      personId: mongoose.Types.ObjectId;
      employeeCode: string;
      fullName: string;
      employeeUserId?: mongoose.Types.ObjectId;
      department: string;
      designation: string;
    }
  | {
      personType: "STAFF";
      personId: mongoose.Types.ObjectId;
      employeeCode: string;
      fullName: string;
      employeeUserId?: mongoose.Types.ObjectId;
      department: string;
      designation: string;
    };

const resolvePerson = async (
  schoolId: mongoose.Types.ObjectId,
  biometricCode: string
): Promise<ResolvedPerson | null> => {
  const variants = biometricCodeVariants(biometricCode);
  const normalized = normalizeBiometricCode(biometricCode);

  let student = await Student.findOne({
    schoolId,
    admissionNumber: { $in: variants }
  })
    .select("_id admissionNumber academicStatus")
    .lean();

  if (!student) {
    const candidates = await Student.find({ schoolId })
      .select("_id admissionNumber academicStatus")
      .lean();
    student =
      candidates.find((s) => normalizeBiometricCode(s.admissionNumber) === normalized) ?? null;
  }

  if (student) {
    return {
      personType: "STUDENT",
      personId: student._id as mongoose.Types.ObjectId,
      admissionNumber: student.admissionNumber
    };
  }

  let teacher = await Teacher.findOne({
    schoolId,
    teacherCode: { $in: variants }
  })
    .populate("user", "fullName designation")
    .lean();

  if (!teacher) {
    const teachers = await Teacher.find({ schoolId }).populate("user", "fullName designation").lean();
    teacher =
      teachers.find((t) => normalizeBiometricCode(t.teacherCode) === normalized) ?? null;
  }

  if (teacher) {
    const user = teacher.user as unknown as {
      _id?: mongoose.Types.ObjectId;
      fullName?: string;
      designation?: string;
    } | null;
    return {
      personType: "TEACHER",
      personId: teacher._id as mongoose.Types.ObjectId,
      employeeCode: teacher.teacherCode,
      fullName: user?.fullName ?? teacher.teacherCode,
      employeeUserId: user?._id,
      department: user?.designation || "Teaching",
      designation: user?.designation || "Teacher"
    };
  }

  let staff = await CollegeStaff.findOne({
    schoolId,
    isDeleted: false,
    staffId: { $in: variants }
  }).lean();

  if (!staff) {
    const staffRows = await CollegeStaff.find({ schoolId, isDeleted: false }).lean();
    staff = staffRows.find((s) => normalizeBiometricCode(s.staffId) === normalized) ?? null;
  }

  if (staff) {
    return {
      personType: "STAFF",
      personId: staff._id as mongoose.Types.ObjectId,
      employeeCode: staff.staffId,
      fullName: staff.fullName,
      employeeUserId: staff.user as mongoose.Types.ObjectId | undefined,
      department: staff.department || "",
      designation: staff.designation || staff.category || "Staff"
    };
  }

  return null;
};

const writePunchLog = async (params: {
  schoolId: mongoose.Types.ObjectId;
  deviceId: string;
  biometricCodeRaw: string;
  punchAt: Date;
  punchTimeHm: string;
  dateBs: string;
  personType: BiometricPersonType;
  personId?: mongoose.Types.ObjectId;
  result: BiometricPunchResult;
  action: BiometricPunchAction;
  externalRef?: string;
  message: string;
  rawPayload?: unknown;
}): Promise<string> => {
  try {
    const doc = await BiometricPunchLog.create({
      schoolId: params.schoolId,
      deviceId: params.deviceId,
      biometricCodeRaw: params.biometricCodeRaw,
      biometricCodeNormalized: normalizeBiometricCode(params.biometricCodeRaw),
      punchAt: params.punchAt,
      punchTimeHm: params.punchTimeHm,
      dateBs: params.dateBs,
      personType: params.personType,
      personId: params.personId,
      result: params.result,
      action: params.action,
      externalRef: params.externalRef?.trim() || "",
      message: params.message,
      rawPayload: params.rawPayload
    });
    return doc._id.toString();
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: number }).code === 11000
    ) {
      const existing = await BiometricPunchLog.findOne({
        schoolId: params.schoolId,
        externalRef: params.externalRef?.trim() || ""
      })
        .select("_id")
        .lean();
      return existing?._id?.toString() ?? "";
    }
    throw error;
  }
};

const applyStudentPunch = async (params: {
  schoolId: mongoose.Types.ObjectId;
  person: Extract<ResolvedPerson, { personType: "STUDENT" }>;
  deviceId: string;
  clock: NepalPunchClock;
  externalRef?: string;
}): Promise<{ result: BiometricPunchResult; action: BiometricPunchAction; message: string }> => {
  const existing = await StudentCampusAttendance.findOne({
    schoolId: params.schoolId,
    studentId: params.person.personId,
    dateBs: params.clock.dateBs
  });

  if (existing) {
    if (PROTECTED_STUDENT_STATUSES.has(existing.status as StudentCampusAttendanceStatus)) {
      return {
        result: "SKIPPED_PROTECTED_STATUS",
        action: "NONE",
        message: `Student already marked ${existing.status}; punch logged only`
      };
    }
    return {
      result: "IGNORED_ALREADY_MARKED",
      action: "STUDENT_ALREADY_MARKED",
      message: `Student already marked ${existing.status} at ${existing.punchTime || "—"}`
    };
  }

  const late = isLate(params.clock.timeHm, env.BIOMETRIC_STUDENT_LATE_AFTER);
  const status: StudentCampusAttendanceStatus = late ? "LATE" : "PRESENT";
  const settings = await Setting.findOne({ schoolId: params.schoolId })
    .select("academicYearBs")
    .lean();

  await StudentCampusAttendance.create({
    schoolId: params.schoolId,
    studentId: params.person.personId,
    admissionNumber: params.person.admissionNumber,
    dateBs: params.clock.dateBs,
    academicYearBs: settings?.academicYearBs ?? "",
    status,
    punchTime: params.clock.timeHm,
    punchAt: params.clock.punchAt,
    source: "BIOMETRIC",
    deviceId: params.deviceId,
    externalRef: params.externalRef?.trim() || "",
    remarks: ""
  });

  return {
    result: "APPLIED",
    action: late ? "STUDENT_MARKED_LATE" : "STUDENT_MARKED_PRESENT",
    message: `Student campus attendance ${status} at ${params.clock.timeHm}`
  };
};

const applyEmployeePunch = async (params: {
  schoolId: mongoose.Types.ObjectId;
  person: Extract<ResolvedPerson, { personType: "TEACHER" | "STAFF" }>;
  deviceId: string;
  clock: NepalPunchClock;
  externalRef?: string;
  punchType: BiometricPunchType;
}): Promise<{ result: BiometricPunchResult; action: BiometricPunchAction; message: string }> => {
  const category = params.person.personType === "TEACHER" ? "TEACHER" : "STAFF";
  const settings = await Setting.findOne({ schoolId: params.schoolId })
    .select("academicYearBs")
    .lean();
  const actorId = await resolveSystemActorId(params.schoolId);

  let sheet = await EmployeeAttendance.findOne({
    schoolId: params.schoolId,
    category,
    dateBs: params.clock.dateBs,
    isDeleted: false
  });

  if (!sheet) {
    sheet = new EmployeeAttendance({
      schoolId: params.schoolId,
      category,
      dateBs: params.clock.dateBs,
      academicYearBs: settings?.academicYearBs ?? "",
      entries: [],
      notes: "",
      status: "LOCKED",
      sourceDefault: "BIOMETRIC",
      createdBy: actorId,
      submittedBy: actorId,
      submittedAt: new Date()
    });
  }

  type EntryRow = {
    teacherId?: mongoose.Types.ObjectId;
    staffId?: mongoose.Types.ObjectId;
    employeeUserId?: mongoose.Types.ObjectId;
    employeeCode: string;
    fullName: string;
    department?: string;
    designation?: string;
    status: EmployeeAttendanceStatus;
    checkInTime?: string;
    checkOutTime?: string;
    remarks?: string;
    source?: string;
    deviceId?: string;
    externalRef?: string;
  };

  const entries = (sheet.entries ? [...sheet.entries] : []) as unknown as EntryRow[];
  const idKey = category === "TEACHER" ? "teacherId" : "staffId";
  let entry = entries.find((e) => String(e[idKey] ?? "") === String(params.person.personId));

  if (!entry) {
    entry = {
      teacherId: category === "TEACHER" ? params.person.personId : undefined,
      staffId: category === "STAFF" ? params.person.personId : undefined,
      employeeUserId: params.person.employeeUserId,
      employeeCode: params.person.employeeCode,
      fullName: params.person.fullName,
      department: params.person.department || "",
      designation: params.person.designation || "",
      status: "PRESENT",
      checkInTime: "",
      checkOutTime: "",
      remarks: "",
      source: "BIOMETRIC",
      deviceId: params.deviceId,
      externalRef: params.externalRef?.trim() || ""
    };
    entries.push(entry);
  }

  const currentStatus = (entry.status || "ABSENT") as EmployeeAttendanceStatus;
  if (PROTECTED_EMPLOYEE_STATUSES.has(currentStatus)) {
    return {
      result: "SKIPPED_PROTECTED_STATUS",
      action: "NONE",
      message: `Employee status is ${currentStatus}; punch not applied to attendance status`
    };
  }

  const checkIn = String(entry.checkInTime || "").trim();
  const checkOut = String(entry.checkOutTime || "").trim();
  const punchType = params.punchType || "AUTO";

  let action: BiometricPunchAction = "NONE";
  let message = "";

  const markCheckIn = () => {
    entry!.checkInTime = params.clock.timeHm;
    const late = isLate(params.clock.timeHm, env.BIOMETRIC_STAFF_LATE_AFTER);
    entry!.status = late ? "LATE" : "PRESENT";
    entry!.source = "BIOMETRIC";
    entry!.deviceId = params.deviceId;
    if (params.externalRef?.trim()) entry!.externalRef = params.externalRef.trim();
    action = "STAFF_CHECK_IN";
    message = `Check-in ${params.clock.timeHm} (${entry!.status})`;
  };

  const markCheckOut = () => {
    entry!.checkOutTime = params.clock.timeHm;
    entry!.source = "BIOMETRIC";
    entry!.deviceId = params.deviceId;
    if (params.externalRef?.trim()) entry!.externalRef = params.externalRef.trim();
    action = "STAFF_CHECK_OUT";
    message = `Check-out ${params.clock.timeHm}`;
  };

  if (punchType === "IN") {
    markCheckIn();
  } else if (punchType === "OUT") {
    if (!checkIn) {
      markCheckIn();
      message = `Treated as check-in ${params.clock.timeHm} (no prior check-in)`;
    } else {
      markCheckOut();
    }
  } else if (!checkIn) {
    markCheckIn();
  } else {
    markCheckOut();
    if (checkOut) {
      message = `Check-out updated to ${params.clock.timeHm}`;
    }
  }

  sheet.set("entries", entries);
  if (!sheet.sourceDefault || sheet.sourceDefault === "MANUAL") {
    sheet.sourceDefault = "BIOMETRIC";
  }
  await sheet.save();

  return { result: "APPLIED", action, message };
};

export const processBiometricPunch = async (
  item: BiometricPunchItemInput
): Promise<BiometricPunchResultItem> => {
  const schoolId = resolveSchoolId(item.schoolId);
  const clock = toNepalPunchClock(item.punchTime);
  if (!clock.dateBs) {
    clock.dateBs = getTodayBs();
  }
  const dateBs = clock.dateBs;
  const externalRef = item.externalRef?.trim();

  if (externalRef) {
    const dup = await BiometricPunchLog.findOne({
      schoolId,
      externalRef
    })
      .select("_id result action personType personId dateBs punchTimeHm message")
      .lean();
    if (dup) {
      return {
        biometricCode: item.biometricCode,
        result: "IGNORED_DUPLICATE",
        action: (dup.action as BiometricPunchAction) || "NONE",
        personType: (dup.personType as BiometricPersonType) || "UNKNOWN",
        personId: dup.personId ? String(dup.personId) : undefined,
        dateBs: dup.dateBs || dateBs,
        punchTimeHm: dup.punchTimeHm || clock.timeHm,
        message: "Duplicate externalRef — punch already processed",
        punchLogId: dup._id.toString()
      };
    }
  }

  const person = await resolvePerson(schoolId, item.biometricCode);

  if (!person) {
    const punchLogId = await writePunchLog({
      schoolId,
      deviceId: item.deviceId,
      biometricCodeRaw: item.biometricCode,
      punchAt: clock.punchAt,
      punchTimeHm: clock.timeHm,
      dateBs,
      personType: "UNKNOWN",
      result: "UNKNOWN_PERSON",
      action: "NONE",
      externalRef,
      message: "No student/teacher/staff matched this biometric code",
      rawPayload: item
    });
    return {
      biometricCode: item.biometricCode,
      result: "UNKNOWN_PERSON",
      action: "NONE",
      personType: "UNKNOWN",
      dateBs,
      punchTimeHm: clock.timeHm,
      message: "No student/teacher/staff matched this biometric code",
      punchLogId
    };
  }

  let applied: { result: BiometricPunchResult; action: BiometricPunchAction; message: string };

  try {
    if (person.personType === "STUDENT") {
      applied = await applyStudentPunch({
        schoolId,
        person,
        deviceId: item.deviceId,
        clock,
        externalRef
      });
    } else {
      applied = await applyEmployeePunch({
        schoolId,
        person,
        deviceId: item.deviceId,
        clock,
        externalRef,
        punchType: item.punchType || "AUTO"
      });
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Punch processing failed";
    const punchLogId = await writePunchLog({
      schoolId,
      deviceId: item.deviceId,
      biometricCodeRaw: item.biometricCode,
      punchAt: clock.punchAt,
      punchTimeHm: clock.timeHm,
      dateBs,
      personType: person.personType,
      personId: person.personId,
      result: "ERROR",
      action: "NONE",
      externalRef,
      message: msg,
      rawPayload: item
    });
    return {
      biometricCode: item.biometricCode,
      result: "ERROR",
      action: "NONE",
      personType: person.personType,
      personId: String(person.personId),
      dateBs,
      punchTimeHm: clock.timeHm,
      message: msg,
      punchLogId
    };
  }

  const punchLogId = await writePunchLog({
    schoolId,
    deviceId: item.deviceId,
    biometricCodeRaw: item.biometricCode,
    punchAt: clock.punchAt,
    punchTimeHm: clock.timeHm,
    dateBs,
    personType: person.personType,
    personId: person.personId,
    result: applied.result,
    action: applied.action,
    externalRef,
    message: applied.message,
    rawPayload: item
  });

  return {
    biometricCode: item.biometricCode,
    result: applied.result,
    action: applied.action,
    personType: person.personType,
    personId: String(person.personId),
    dateBs,
    punchTimeHm: clock.timeHm,
    message: applied.message,
    punchLogId
  };
};

export const processBiometricPunchBatch = async (
  items: BiometricPunchItemInput[]
): Promise<BiometricPunchResultItem[]> => {
  const results: BiometricPunchResultItem[] = [];
  for (const item of items) {
    results.push(await processBiometricPunch(item));
  }
  return results;
};
