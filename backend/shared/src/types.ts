export type UserRole =
  | "SUPER_ADMIN"
  | "COLLEGE_ADMIN"
  | "TEACHER"
  | "STUDENT"
  | "PARENT"
  | "LIBRARY_STAFF"
  | "LABORATORY_STAFF"
  | "ACCOUNTANT";

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
  motherName: string;
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

export interface SubjectRecord {
  _id: string;
  schoolId: string;
  name: string;
  code: string;
  classIds: string[];
  yearIds: string[];
  teacherIds: string[];
  fullMarks: number;
  passMarks: number;
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
