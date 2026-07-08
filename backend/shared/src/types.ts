export type UserRole =
  | "SUPER_ADMIN"
  | "COLLEGE_ADMIN"
  | "COLLEGE_VIEWER"
  | "TEACHER"
  | "STUDENT"
  | "PARENT"
  | "LIBRARY_STAFF"
  | "LABORATORY_STAFF"
  | "ACCOUNTANT"
  | "CASHIER"
  | "AUDITOR"
  | "PRINCIPAL"
  | "COLLEGE_STAFF";

export type CollegeStaffCategory =
  | "SECURITY_GUARD"
  | "HOUSEKEEPING"
  | "RECEPTIONIST"
  | "OFFICE_ASSISTANT"
  | "TRANSPORT"
  | "IT_STAFF"
  | "OTHER";

export type EmploymentType = "FULL_TIME" | "PART_TIME" | "CONTRACT" | "INTERN";

export type BannerTargetRole =
  | "STUDENT"
  | "TEACHER"
  | "PARENT"
  | "ACCOUNTANT"
  | "LIBRARY_STAFF"
  | "LABORATORY_STAFF"
  | "TRANSPORT_STAFF"
  | "HR_PAYROLL"
  | "COLLEGE_ADMIN";

export type BannerPriority = "HIGH" | "MEDIUM" | "LOW";

export type BannerDisplayStatus = "ACTIVE" | "INACTIVE";

export type BloodGroup =
  | "A+"
  | "A-"
  | "B+"
  | "B-"
  | "AB+"
  | "AB-"
  | "O+"
  | "O-";

export type FeeFrequency = "MONTHLY" | "ANNUAL" | "ONE_TIME";

export type FeeType =
  | "ADMISSION"
  | "REGISTRATION"
  | "TUITION"
  | "MONTHLY"
  | "EXAM"
  | "PRACTICAL"
  | "LIBRARY"
  | "LAB"
  | "TRANSPORT"
  | "HOSTEL"
  | "FINE"
  | "SCHOLARSHIP"
  | "MISC"
  | "REFUND"
  | "OTHER"
  | "ANNUAL";

export type AttendanceStatus = "PRESENT" | "ABSENT" | "LEAVE" | "LATE" | "MEDICAL_LEAVE";

export type DailyAttendanceStatus = "PRESENT" | "ABSENT" | "LEAVE" | "LATE" | "MEDICAL_LEAVE";

export type DailyAttendanceRecordStatus = "DRAFT" | "SUBMITTED" | "LOCKED";

export interface DailyAttendanceConfig {
  startTime: string;
  endTime: string;
  closeBeforeFirstPeriodEnds: boolean;
  allowMedicalLeave: boolean;
}

export interface LibraryInventoryAccessConfig {
  enabled: boolean;
}

// Nepal IEMIS / Inclusive Education types
export type DisabilityCategory =
  | "None"
  | "Physical"
  | "Intellectual / Mental"
  | "Hearing"
  | "Visual / Low Vision"
  | "Deaf-Blind (Combined Hearing-Visual)"
  | "Speech and Language"
  | "Multiple Disabilities"
  | "Autism Spectrum / Other Developmental";

export type EthnicityCategory =
  | "Brahmin / Chhetri"
  | "Dalit"
  | "Janajati / Indigenous"
  | "Madhesi"
  | "Muslim"
  | "Other"
  | "Prefer not to say";

export type DocumentType =
  | "Photo"
  | "BirthCertificate"
  | "PreviousMarksheet"
  | "TransferCertificate"
  | "DisabilityCertificate"
  | "ScholarshipProof"
  | "GuardianID"
  | "Other"
  | "STUDENT_PHOTOGRAPH"
  | "SEE_SLC_MARKSHEET"
  | "SEE_SLC_CHARACTER"
  | "CITIZENSHIP_NATIONAL_ID"
  | "PLUS2_MARKSHEET"
  | "PLUS2_CHARACTER"
  | "MIGRATION_CERTIFICATE"
  | "PROVISIONAL_CERTIFICATE"
  | "BIRTH_CERTIFICATE"
  | "MEDICAL_FITNESS"
  | "ADMISSION_FORM"
  | "CTEVT_REGISTRATION"
  | "SCHOLARSHIP"
  | "FEE_AGREEMENT";

export type StudentDocumentStatus = "UPLOADED" | "VERIFIED" | "REJECTED" | "PENDING";

export type StudentDocumentCategory = (typeof import("./constants.js").STUDENT_DOCUMENT_CATEGORIES)[number]["key"];

export type GradeSymbol = "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "E";

export type InstitutionType = "SCHOOL" | "COLLEGE";

export type LocalLevelType = "Metropolitan City" | "Sub Metropolitan City" | "Municipality" | "Rural Municipality";

export interface NepalAddressMunicipality {
  en: string;
  np: string;
  wards: string[];
}

export interface NepalAddressDistrict {
  en: string;
  np: string;
  children: NepalAddressMunicipality[];
}

export interface NepalAddressProvince {
  en: string;
  np: string;
  children: NepalAddressDistrict[];
}

export interface AddressSelection {
  province: string;
  district: string;
  municipality: string;
  ward: string;
  streetAddress: string;
}

export interface SchoolRecord {
  _id: string;
  name: string;
  nameNp: string;
  code: string;
  email: string;
  phone: string;
  principalName: string;
  academicYearBs: string;
  institutionType: InstitutionType;
  address: AddressSelection;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface UserProfile {
  _id: string;
  schoolId?: string;
  school?: SchoolRecord | null;
  fullName: string;
  email: string;
  role: UserRole;
  phone?: string;
  employeeId?: string;
  designation?: string;
  department?: string;
  profilePhotoUrl?: string;
  isActive: boolean;
  mustChangePassword?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface InstitutionPermissions {
  canRead: boolean;
  canWrite: boolean;
  canManageUsers: boolean;
  canExport: boolean;
}

export interface AdminAccountRecord extends UserProfile {
  isDeleted?: boolean;
  loginEmail?: string;
}

export interface CollegeAdministratorRecord extends UserProfile {
  isDeleted?: boolean;
  loginEmail?: string;
}

export interface AdminActivityLogEntry {
  _id: string;
  action: string;
  entity: string;
  entityId: string;
  actorRole: string;
  actorName?: string;
  before?: unknown;
  after?: unknown;
  createdAt: string;
}

export interface StudentRecord {
  _id: string;
  schoolId: string;
  user: UserProfile;
  admissionNumber: string;
  rollNumber: number;
  classId?: string;
  sectionId?: string;
  batchId?: string;
  yearId?: string;
  academicStatus?: "ACTIVE" | "PASSED_OUT" | "ALUMNI" | "WITHDRAWN" | "CANCELLED" | "SUSPENDED";
  admissionDateBs: string;
  dateOfBirthBs: string;
  gender: string;
  bloodGroup?: BloodGroup;
  disabilityCategory?: DisabilityCategory;
  ethnicityCategory?: EthnicityCategory;
  address: AddressSelection;
  fatherName: string;
  fatherPhone?: string;
  motherName: string;
  motherPhone?: string;
  guardianName: string;
  guardianPhone: string;
  feesDueNpr: number;
  remarks?: string;
  // New for Phase 0 foundations
  photoUrl?: string;
  documents?: StudentDocument[];
  createdAt?: string;
  updatedAt?: string;
}

export interface StudentDocument {
  _id?: string;
  type: DocumentType | string;
  name: string;
  url: string;
  originalName: string;
  mimeType?: string;
  size: number;
  status: StudentDocumentStatus;
  uploadedAt: string;
  uploadedBy: string;
  uploadedByName?: string;
  notes?: string;
}

export interface StudentActivityLogEntry {
  _id: string;
  action: string;
  entity: string;
  entityId: string;
  actorRole: string;
  actorName?: string;
  before?: unknown;
  after?: unknown;
  createdAt: string;
}

export interface StudentProfileData {
  student: StudentRecord;
  primaryLabel: string;
  secondaryLabel: string;
  primaryName: string;
  secondaryName: string;
  subjects: Array<{ _id: string; name: string; code?: string }>;
  attendance: {
    records: Array<{ dateBs: string; status: string; subjectName?: string }>;
    monthlySummary: Array<{ month: string; present: number; absent: number; percentage: number }>;
    yearlyPercentage: number;
    totalPresent: number;
    totalAbsent: number;
    totalDays: number;
  };
  results: Array<Record<string, unknown>>;
  exams: Array<Record<string, unknown>>;
  financial: Record<string, unknown> | null;
  library: {
    issues: Array<Record<string, unknown>>;
    pendingCount: number;
    fineTotal: number;
  };
  transport: Record<string, unknown> | null;
  activityLog: StudentActivityLogEntry[];
  permissions: {
    canManageDocuments: boolean;
    canViewFinancial: boolean;
    canViewActivity: boolean;
  };
}

export interface TeacherRecord {
  _id: string;
  schoolId: string;
  user: UserProfile;
  teacherCode: string;
  qualification: string;
  joinedDateBs: string;
  address: AddressSelection;
  subjects: string[];
  assignedClassIds: string[];
  assignedSectionIds: string[];
  assignedBatchIds: string[];
  assignedYearIds: string[];
  basicSalaryNpr: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CollegeStaffRecord {
  _id: string;
  schoolId: string;
  user?: UserProfile;
  staffId: string;
  fullName: string;
  photoUrl?: string;
  gender: string;
  dateOfBirthBs?: string;
  phone: string;
  email?: string;
  address: AddressSelection;
  joinedDateBs: string;
  designation: string;
  category: CollegeStaffCategory;
  employmentType: EmploymentType;
  basicSalaryNpr: number;
  status: "ACTIVE" | "INACTIVE";
  enableLogin: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface SalaryEmployeesResponse {
  teachers: TeacherRecord[];
  collegeStaff: CollegeStaffRecord[];
}

export interface ClassRecord {
  _id: string;
  schoolId: string;
  name: string;
  level: string;
  academicYearBs: string;
  coordinatorId?: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface SectionRecord {
  _id: string;
  schoolId: string;
  name: string;
  classId: string;
  room?: string;
  capacity: number;
  classTeacherId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface BatchRecord {
  _id: string;
  schoolId: string;
  name: string;
  academicYearBs: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface YearRecord {
  _id: string;
  schoolId: string;
  batchId: string;
  name: string;
  level: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface MasterSubjectRecord {
  _id: string;
  schoolId: string;
  name: string;
  code: string;
  yearLevel: number;
  creditHours?: number;
  theoryMarks: number;
  practicalMarks?: number;
  internalMarks?: number;
  passMarks: number;
  fullMarks: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface SubjectRecord {
  _id: string;
  schoolId: string;
  masterSubjectId?: string;
  name: string;
  code: string;
  classIds: string[];
  yearIds: string[];
  teacherIds: string[];
  creditHours?: number;
  theoryMarks?: number;
  practicalMarks?: number;
  internalMarks?: number;
  fullMarks: number;
  passMarks: number;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AttendanceEntry {
  studentId: string;
  status: AttendanceStatus;
}

export interface AttendanceRecord {
  _id: string;
  schoolId: string;
  classId?: string;
  sectionId?: string;
  batchId?: string;
  yearId?: string;
  subjectId: string;
  teacherId: string;
  dateBs: string;
  entries: AttendanceEntry[];
  createdBy: string;
  createdAt?: string;
  updatedAt?: string;
  autoGeneratedFromDaily?: boolean;
  dailyAttendanceId?: string;
}

export interface DailyAttendanceEntry {
  studentId: string;
  status: DailyAttendanceStatus;
  remarks?: string;
}

export interface DailyAttendanceRecord {
  _id: string;
  schoolId: string;
  classId?: string;
  sectionId?: string;
  batchId?: string;
  yearId?: string;
  academicYearBs: string;
  dateBs: string;
  dayOfWeek: number;
  teacherId: string;
  subjectId: string;
  timetableSlotId?: string;
  periodNumber: number;
  startTime?: string;
  endTime?: string;
  entries: DailyAttendanceEntry[];
  notes?: string;
  status: DailyAttendanceRecordStatus;
  syncedAttendanceId?: string;
  synchronizedAt?: string;
  createdBy: string;
  submittedBy?: string;
  submittedAt?: string;
  lastEditedBy?: string;
  unlockedBy?: string;
  unlockedAt?: string;
  unlockReason?: string;
  reassignedFromTeacherId?: string;
  teacherReassignReason?: string;
  isSubstituteMarking?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface DailyAttendanceAssignment {
  classId?: string;
  sectionId?: string;
  batchId?: string;
  yearId?: string;
  className?: string;
  sectionName?: string;
  batchName?: string;
  yearName?: string;
  academicYearBs: string;
  dateBs: string;
  dayOfWeek: number;
  dayName: string;
  teacherId: string;
  teacherName: string;
  subjectId: string;
  subjectName: string;
  subjectCode?: string;
  /** Empty when admin marks a group that has no first-period slot for the day. */
  timetableSlotId?: string;
  periodNumber: number;
  startTime: string;
  endTime: string;
  existingRecordId?: string;
  isLocked: boolean;
  isHoliday: boolean;
  holidayTitle?: string;
  canMark: boolean;
  availabilityMessage?: string;
  isSubstituteSlot?: boolean;
  firstPeriodTeacherName?: string;
  canAdminEdit?: boolean;
  /** True when there is no first-period (or any) timetable slot for this day. */
  isManualAssignment?: boolean;
  studentCount?: number;
}

export interface DailyAttendanceDashboard {
  totalStudents: number;
  presentToday: number;
  absentToday: number;
  lateToday: number;
  leaveToday: number;
  medicalLeaveToday: number;
  attendancePercentage: number;
  dailyTrend: Array<{ dateBs: string; present: number; absent: number; late: number; leave: number }>;
  weeklyTrend: Array<{ week: string; present: number; absent: number }>;
  monthlyTrend: Array<{ month: string; present: number; absent: number }>;
  classWise: Array<{ label: string; present: number; absent: number; percentage: number }>;
  teacherWise: Array<{ teacherName: string; classesMarked: number; percentage: number }>;
}

export type DailyAttendanceReportType =
  | "summary"
  | "student"
  | "defaulter"
  | "leave"
  | "late"
  | "class";

export interface DailyAttendanceStudentReportRow {
  studentId: string;
  fullName: string;
  rollNumber: number;
  admissionNumber: string;
  totalDays: number;
  present: number;
  absent: number;
  late: number;
  leave: number;
  medicalLeave: number;
  percentage: number;
  isDefaulter: boolean;
}

export interface DailyAttendanceLogRecord {
  _id: string;
  schoolId: string;
  dailyAttendanceId: string;
  action: string;
  actorUserId: string;
  actorRole: string;
  before?: unknown;
  after?: unknown;
  synchronizationStatus?: string;
  metadata?: unknown;
  createdAt?: string;
}

export type ExamStatus = "DRAFT" | "SCHEDULED" | "ONGOING" | "COMPLETED" | "PUBLISHED";

export type ExamAttendanceStatus = "PRESENT" | "ABSENT" | "EXEMPT";

export type ExamPassFailStatus = "PASS" | "FAIL";

export type ResultSubmissionStatus =
  | "DRAFT"
  | "SUBMITTED_FOR_REVIEW"
  | "PENDING_ADMIN_REVIEW"
  | "RETURNED_FOR_CORRECTION"
  | "APPROVED"
  | "PUBLISHED";

export interface ResultSubmissionRecord {
  _id: string;
  schoolId: string;
  examId: string;
  subjectId: string;
  classId?: string;
  sectionId?: string;
  batchId?: string;
  yearId?: string;
  status: ResultSubmissionStatus;
  enteredByUserId?: string;
  submittedByUserId?: string;
  submittedAt?: string;
  reviewedByUserId?: string;
  reviewedAt?: string;
  reviewComments?: string;
  approvedByUserId?: string;
  approvedAt?: string;
  publishedByUserId?: string;
  publishedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ResultSubmissionReviewSummary {
  submission: ResultSubmissionRecord;
  examName: string;
  subjectName: string;
  scopeLabel: string;
  studentsTotal: number;
  marksEntered: number;
  missingStudents: Array<{ studentId: string; studentName: string }>;
}

export interface ExamRecord {
  _id: string;
  schoolId: string;
  name: string;
  academicYearBs: string;
  startDateBs: string;
  endDateBs: string;
  resultPublishDateBs?: string;
  status: ExamStatus;
  routinePublished: boolean;
  resultsPublished: boolean;
  resultsLocked: boolean;
  classIds: string[];
  batchIds: string[];
  yearIds: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ExamRoutineRecord {
  _id: string;
  schoolId: string;
  examId: string;
  subjectId: string;
  examDateBs: string;
  day: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  examHall?: string;
  invigilator?: string;
  remarks?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ResultSubjectMarkInput {
  subjectId: string;
  fullMarks: number;
  passMarks: number;
  theoryMarks?: number;
  practicalMarks?: number;
  internalMarks?: number;
  obtainedMarks: number;
  attendanceStatus?: ExamAttendanceStatus;
  teacherRemarks?: string;
  percentage?: number;
  grade?: GradeSymbol;
  passFail?: ExamPassFailStatus;
}

export interface ResultSubjectMark extends ResultSubjectMarkInput {}

export interface ResultRecord {
  _id: string;
  schoolId: string;
  examId: string;
  studentId: string;
  classId?: string;
  sectionId?: string;
  batchId?: string;
  yearId?: string;
  marks: ResultSubjectMark[];
  percentage: number;
  gpa: number;
  grade: GradeSymbol;
  passFailStatus: ExamPassFailStatus;
  publishedAtBs?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ExamAnalyticsSummary {
  examId: string;
  totalStudents: number;
  resultsEntered: number;
  passCount: number;
  failCount: number;
  averagePercentage: number;
  topPerformers: Array<{ studentId: string; studentName: string; percentage: number; grade: GradeSymbol }>;
  lowestPerformers: Array<{ studentId: string; studentName: string; percentage: number; grade: GradeSymbol }>;
  subjectPerformance: Array<{
    subjectId: string;
    subjectName: string;
    averagePercentage: number;
    passCount: number;
    failCount: number;
  }>;
}

export interface PrintResultsSubjectColumn {
  subjectId: string;
  subjectName: string;
  subjectCode?: string;
}

export interface PrintResultsGridRow {
  sn: number;
  resultId: string;
  examId: string;
  studentId: string;
  studentName: string;
  rollNumber: number;
  registrationNumber: string;
  batchName?: string;
  yearName?: string;
  className?: string;
  sectionName?: string;
  subjectMarks: Record<string, number | null>;
  totalMarks: number;
  totalFullMarks: number;
  percentage: number;
  grade: GradeSymbol;
  gpa: number;
  passFailStatus: ExamPassFailStatus;
  remarks?: string;
}

export interface PrintResultsGridResponse {
  exam?: Pick<ExamRecord, "_id" | "name" | "academicYearBs" | "resultsPublished" | "resultPublishDateBs">;
  subjects: PrintResultsSubjectColumn[];
  rows: PrintResultsGridRow[];
  academicYearBs?: string;
  batchName?: string;
  yearName?: string;
  className?: string;
  sectionName?: string;
  collegeName?: string;
  collegeNameNp?: string;
  collegeAddress?: string;
  collegeLogoUrl?: string;
}

export interface MarksheetViewResponse {
  result: ResultRecord;
  exam: ExamRecord;
  student: StudentRecord;
  section?: SectionRecord;
  batch?: { _id: string; name: string };
  year?: { _id: string; name: string };
  schoolClass?: ClassRecord;
  subjects: SubjectRecord[];
  collegeName: string;
  collegeNameNp?: string;
  collegeAddress?: string;
  collegeLogoUrl?: string;
  principalName?: string;
  controllerOfExamination?: string;
  verificationNumber?: string;
  printedDateBs?: string;
  totalObtained: number;
  totalFullMarks: number;
}

export interface FeeStructureRecord {
  _id: string;
  schoolId: string;
  title: string;
  classIds: string[];
  batchIds?: string[];
  yearIds?: string[];
  faculty?: string;
  program?: string;
  feeType: FeeType;
  frequency: FeeFrequency | "SEMESTER";
  academicYearBs: string;
  semesterBs?: string;
  amountNpr: number;
  installmentCount?: number;
  isOptional: boolean;
  status?: "ACTIVE" | "ARCHIVED";
  version?: number;
  versionGroupId?: string;
  effectiveFromBs?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface FeeCollectionRecord {
  _id: string;
  schoolId: string;
  studentId: string;
  feeStructureId: string;
  receiptNumber: string;
  paidDateBs: string;
  amountPaidNpr: number;
  discountNpr: number;
  scholarshipNpr: number;
  lateFeeNpr: number;
  notes?: string;
  createdBy: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface NoticeRecord {
  _id: string;
  schoolId: string;
  title: string;
  content: string;
  visibleTo: UserRole[];
  publishDateBs: string;
  expiresAtBs?: string;
  subjectId?: string;
  classId?: string;
  sectionId?: string;
  teacherId?: string;
  createdBy: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface BannerRecord {
  _id: string;
  schoolId: string;
  imageUrl: string;
  thumbnailUrl?: string;
  isActive: boolean;
  fileSizeBytes?: number;
  width?: number;
  height?: number;
  originalFileName?: string;
  createdBy: string;
  createdByName?: string;
  displayStatus?: BannerDisplayStatus;
  visibilityStatus?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface HolidayRecord {
  title: string;
  dateBs: string;
}

export interface SchoolSettingsRecord {
  _id: string;
  schoolId: string;
  schoolName: string;
  schoolNameNp: string;
  academicYearBs: string;
  principalName: string;
  contactEmail: string;
  contactPhone: string;
  address: AddressSelection;
  holidays: HolidayRecord[];
  dailyAttendance?: DailyAttendanceConfig;
  libraryInventoryAccess?: LibraryInventoryAccessConfig;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthResponse {
  user: UserProfile;
  permissions?: InstitutionPermissions;
  redirectTo: string;
  activeSchoolId?: string | null;
  availableSchools?: SchoolRecord[];
}

export interface ActiveSchoolResponse {
  activeSchoolId: string | null;
  school: SchoolRecord | null;
}

export interface DashboardMetric {
  label: string;
  value: number;
  change?: string;
}

export interface DashboardNotificationItem {
  _id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  createdAt?: string;
}

export interface DashboardHighlight {
  label: string;
  value: string;
  href?: string;
  action?: "fee-dues";
  tone?: "default" | "info" | "success" | "warning";
}

export interface DashboardFeeDueStudent {
  studentId: string;
  recipientUserId: string;
  photoUrl?: string;
  fullName: string;
  admissionNumber: string;
  rollNumber: number;
  courseName: string;
  yearName?: string;
  sectionName?: string;
  parentName: string;
  contactNumber: string;
  email: string;
  totalFeeNpr: number;
  amountPaidNpr: number;
  outstandingAmountNpr: number;
  dueDateBs?: string;
  pendingInstallments: number;
  paymentStatus: "PENDING" | "PARTIAL" | "OVERDUE";
  lastReceiptId?: string;
}

export interface DashboardChildSummary {
  studentId: string;
  fullName: string;
  feesDueNpr: number;
}

export interface DashboardResponse {
  stats: DashboardMetric[];
  attendanceChart: Array<{ label: string; present: number; absent: number }>;
  feeChart: Array<{ label: string; amount: number }>;
  counts: Array<{ name: string; value: number }>;
  notices: NoticeRecord[];
  banners: BannerRecord[];
  notifications: DashboardNotificationItem[];
  unreadNotificationCount: number;
  highlights: DashboardHighlight[];
  pendingFeesTotalNpr?: number;
  studentsWithDueFees?: number;
  children?: DashboardChildSummary[];
}

// Foundation type for future IEMIS infrastructure tracking (Phase 2)
export interface SchoolInfrastructure {
  classrooms: number;
  usableClassrooms: number;
  toiletsMale: number;
  toiletsFemale: number;
  toiletsDisabled: number;
  drinkingWater: boolean;
  electricity: boolean;
  internet: boolean;
  libraryBooks: number;
  hasScienceLab: boolean;
  hasComputerLab: boolean;
  hasPlayground: boolean;
  hasRamp: boolean;
  midDayMeal: boolean;
}
