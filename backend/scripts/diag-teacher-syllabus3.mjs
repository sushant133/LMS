import "dotenv/config";
import mongoose from "mongoose";
import { AcademicSyllabus } from "../dist/models/AcademicSyllabus.js";

// Prefer src via tsx if dist missing
let Syllabus;
try {
  ({ AcademicSyllabus: Syllabus } = await import("../src/models/AcademicSyllabus.ts"));
} catch {
  try {
    ({ AcademicSyllabus: Syllabus } = await import("../dist/models/AcademicSyllabus.js"));
  } catch {
    // define minimal schema
  }
}

await mongoose.connect(process.env.MONGODB_URI);

const schoolId = "6a55345f48ea9b4989f7d353";
const allowed = [
  "6a55346148ea9b4989f7d38f",
  "6a55346148ea9b4989f7d37f",
  "6a59341b7e9617e288b6778c",
  "6a5934357e9617e288b677b2",
];

// Use mongoose model if registered
const Model =
  mongoose.models.AcademicSyllabus ||
  mongoose.model(
    "AcademicSyllabus",
    new mongoose.Schema(
      {
        schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School" },
        academicYearBs: String,
        session: String,
        subjectId: { type: mongoose.Schema.Types.ObjectId, ref: "Subject" },
        isDeleted: Boolean,
      },
      { collection: "academicsyllabuses" },
    ),
  );

const filter = {
  schoolId,
  isDeleted: false,
  academicYearBs: "2083/2084",
  session: "2083/2084",
  subjectId: { $in: allowed },
};

const rows = await Model.find(filter).lean();
console.log("mongoose string schoolId + string $in", rows.length, rows.map((r) => String(r._id)));

const filter2 = {
  schoolId: new mongoose.Types.ObjectId(schoolId),
  isDeleted: false,
  academicYearBs: "2083/2084",
  session: "2083/2084",
  subjectId: { $in: allowed },
};
const rows2 = await Model.find(filter2).lean();
console.log("mongoose ObjectId schoolId + string $in", rows2.length);

const filter3 = {
  schoolId: new mongoose.Types.ObjectId(schoolId),
  isDeleted: false,
  academicYearBs: "2083/2084",
  session: "2083/2084",
  subjectId: { $in: allowed.map((id) => new mongoose.Types.ObjectId(id)) },
};
const rows3 = await Model.find(filter3).lean();
console.log("mongoose ObjectId schoolId + ObjectId $in", rows3.length);

// Check tenantObjectId style
const filter4 = {
  schoolId: new mongoose.Types.ObjectId(schoolId),
  isDeleted: false,
  academicYearBs: "2083/2084",
  subjectId: { $in: allowed },
};
const rows4 = await Model.find(filter4).lean();
console.log("without session string $in", rows4.length);

await mongoose.disconnect();
