export type UserRole =
  | "SUPER_ADMIN"
  | "COLLEGE_ADMIN"
  | "TEACHER"
  | "STUDENT"
  | "PARENT"
  | "LIBRARY_STAFF"
  | "LABORATORY_STAFF"
  | "ACCOUNTANT"
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

export type BannerDisplayStatus = "ACTIVE" | "SCHEDULED" | "EXPIRED" | "INACTIVE";

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
  | "TUITION"
  | "MONTHLY"
  | "EXAM"
  | "LIBRARY"
  | "LAB"
  | "TRANSPORT"
  | "HOSTEL"
  | "OTHER"
  | "ANNUAL";

export type AttendanceStatus = "PRESENT" | "ABSENT" | "LEAVE" | "LATE";

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
  | "Other";

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
  isActive: boolean;
  mustChangePassword?: boolean;
  createdAt?: string;
  updatedAt?: string;
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
  type: DocumentType;
  url: string;
  originalName: string;
  uploadedAt: string;
  uploadedBy?: string;
  notes?: string;
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
  feeType: FeeType;
  frequency: FeeFrequency;
  academicYearBs: string;
  amountNpr: number;
  isOptional: boolean;
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
  title: string;
  description: string;
  imageUrl?: string;
  buttonText?: string;
  buttonUrl?: string;
  backgroundColor?: string;
  textColor?: string;
  priority: BannerPriority;
  startAt: string;
  endAt: string;
  isActive: boolean;
  showOnce: boolean;
  dismissible: boolean;
  targetRoles: BannerTargetRole[];
  createdBy: string;
  createdByName?: string;
  displayStatus?: BannerDisplayStatus;
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
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthResponse {
  user: UserProfile;
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

export interface DashboardResponse {
  stats: DashboardMetric[];
  attendanceChart: Array<{ label: string; present: number; absent: number }>;
  feeChart: Array<{ label: string; amount: number }>;
  counts: Array<{ name: string; value: number }>;
  notices: NoticeRecord[];
  banners: BannerRecord[];
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
