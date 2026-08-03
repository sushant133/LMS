/**
 * Recover student (and other) documents when MongoDB has /uploads/... URLs
 * but the binary is missing from the active UPLOAD_DIR (common after deploy / cwd drift).
 *
 * Usage (on the VPS, from the backend folder):
 *
 *   # 1) Find where files live + what Mongo expects (safe, read-only)
 *   npx tsx src/scripts/restoreMissingUploads.ts
 *
 *   # 2) Copy any found files into the active UPLOAD_DIR (keeps relative paths)
 *   npx tsx src/scripts/restoreMissingUploads.ts --apply
 *
 *   # 3) Only scan extra folders (absolute paths, colon-separated)
 *   UPLOAD_LEGACY_DIRS=/home/user/old-app/uploads:/var/www/html/uploads \
 *     npx tsx src/scripts/restoreMissingUploads.ts --apply
 *
 * Then restart the backend. Re-upload only docs still listed as MISSING.
 */
import type { Dirent } from "node:fs";
import fs from "fs-extra";
import path from "path";
import mongoose from "mongoose";
import { connectDatabase } from "../config/db.js";
import { getBackendRoot, getUploadDir } from "../config/env.js";
import { Student } from "../models/Student.js";
import { Teacher } from "../models/Teacher.js";
import { CollegeStaff } from "../models/CollegeStaff.js";

const apply = process.argv.includes("--apply");
const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/;

type PublicRef = {
  source: string;
  schoolId: string;
  relative: string; // under schoolId, e.g. students/documents/file.pdf
  basename: string;
  publicUrl: string;
};

const collectCandidateRoots = (): string[] => {
  const primary = path.resolve(getUploadDir());
  const fromEnv = (process.env.UPLOAD_LEGACY_DIRS ?? "")
    .split(/[;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const candidates = [
    primary,
    path.join(getBackendRoot(), "uploads"),
    path.join(process.cwd(), "uploads"),
    path.join(process.cwd(), "backend", "uploads"),
    path.join(getBackendRoot(), "..", "uploads"),
    path.join(getBackendRoot(), "..", "frontend", "uploads"),
    path.join(getBackendRoot(), "dist", "uploads"),
    ...fromEnv,
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    const n = path.resolve(c);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
};

/** Parse Mongo URL into schoolId + relative path under school. */
const parsePublicUrl = (raw: string): Omit<PublicRef, "source"> | null => {
  if (!raw || typeof raw !== "string") return null;
  let u = raw.trim();
  if (!u) return null;

  // Absolute URL → path only
  if (/^https?:\/\//i.test(u)) {
    try {
      u = new URL(u).pathname;
    } catch {
      return null;
    }
  }

  if (u.startsWith("/api/uploads/")) u = u.slice(4);
  if (u.startsWith("api/uploads/")) u = `/${u.slice(3)}`;
  if (!u.startsWith("/")) u = `/${u}`;
  if (!u.startsWith("/uploads/")) return null;

  const parts = u
    .slice("/uploads/".length)
    .split(/[/\\]+/)
    .filter(Boolean);
  if (parts.length < 2) return null;

  const schoolId = parts[0]!;
  if (!SAFE_SEGMENT.test(schoolId)) return null;
  const relativeParts = parts.slice(1);
  for (const p of relativeParts) {
    if (!SAFE_SEGMENT.test(p)) return null;
  }
  return {
    schoolId,
    relative: relativeParts.join("/"),
    basename: relativeParts[relativeParts.length - 1]!,
    publicUrl: `/uploads/${schoolId}/${relativeParts.join("/")}`,
  };
};

const walkFiles = async (
  root: string,
  maxFiles = 50_000,
): Promise<Map<string, string[]>> => {
  /** basename → absolute paths */
  const index = new Map<string, string[]>();
  if (!(await fs.pathExists(root))) return index;

  const queue: string[] = [root];
  let seen = 0;
  while (queue.length && seen < maxFiles) {
    const dir = queue.shift()!;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        queue.push(full);
      } else if (e.isFile()) {
        seen += 1;
        const list = index.get(e.name) ?? [];
        list.push(full);
        index.set(e.name, list);
      }
    }
  }
  return index;
};

const isInside = (root: string, file: string): boolean => {
  const rel = path.relative(path.resolve(root), path.resolve(file));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

const run = async (): Promise<void> => {
  const primaryRoot = path.resolve(getUploadDir());
  await fs.ensureDir(primaryRoot);

  console.log("=== PHIT LMS upload recovery ===");
  console.log(`Active UPLOAD_DIR : ${primaryRoot}`);
  console.log(`Backend root      : ${getBackendRoot()}`);
  console.log(`process.cwd()     : ${process.cwd()}`);
  console.log(`Mode              : ${apply ? "APPLY (copy into UPLOAD_DIR)" : "REPORT only"}`);
  console.log("");

  await connectDatabase();

  const refs: PublicRef[] = [];
  const pushUrl = (source: string, url?: string | null) => {
    if (!url) return;
    const parsed = parsePublicUrl(url);
    if (!parsed) return;
    refs.push({ source, ...parsed });
  };

  const students = await Student.find({})
    .select("schoolId documents photoUrl admissionNumber")
    .lean();
  for (const s of students) {
    const sid = String(s.schoolId ?? "");
    const label = `Student ${s.admissionNumber || s._id}`;
    pushUrl(label, s.photoUrl);
    for (const d of s.documents ?? []) {
      pushUrl(`${label} / ${d.type || "doc"}`, d.url);
    }
  }

  try {
    const teachers = await Teacher.find({}).select("schoolId photoUrl").lean();
    for (const t of teachers) {
      pushUrl(`Teacher ${t._id}`, (t as { photoUrl?: string }).photoUrl);
    }
  } catch {
    /* optional */
  }

  try {
    const staff = await CollegeStaff.find({}).select("schoolId photoUrl").lean();
    for (const st of staff) {
      pushUrl(`Staff ${st._id}`, (st as { photoUrl?: string }).photoUrl);
    }
  } catch {
    /* model optional */
  }

  // Unique by publicUrl
  const unique = new Map<string, PublicRef>();
  for (const r of refs) {
    if (!r.publicUrl || !r.basename) continue;
    if (!unique.has(r.publicUrl)) unique.set(r.publicUrl, r);
  }

  console.log(`Mongo document/photo URLs found: ${unique.size}`);
  console.log("");

  const roots = collectCandidateRoots();
  console.log("Scanning candidate folders:");
  const indexes: Array<{ root: string; exists: boolean; index: Map<string, string[]> }> =
    [];
  for (const root of roots) {
    const exists = await fs.pathExists(root);
    console.log(`  ${exists ? "OK " : "—  "} ${root}`);
    indexes.push({
      root,
      exists,
      index: exists ? await walkFiles(root) : new Map(),
    });
  }
  console.log("");

  let ok = 0;
  let restored = 0;
  let missing = 0;
  const missingList: string[] = [];

  for (const ref of unique.values()) {
    const targetAbs = path.join(primaryRoot, ref.schoolId, ...ref.relative.split("/"));
    const targetExists =
      (await fs.pathExists(targetAbs)) && (await fs.stat(targetAbs)).isFile();

    if (targetExists) {
      ok += 1;
      continue;
    }

    // Find a source file: exact relative path under any root, else basename under same school
    let sourceFile: string | null = null;
    for (const { root, exists, index } of indexes) {
      if (!exists) continue;
      const exact = path.join(root, ref.schoolId, ...ref.relative.split("/"));
      if (
        isInside(root, exact) &&
        (await fs.pathExists(exact)) &&
        (await fs.stat(exact)).isFile()
      ) {
        sourceFile = exact;
        break;
      }
      const candidates = index.get(ref.basename) ?? [];
      for (const c of candidates) {
        // Prefer same school folder
        if (c.includes(`${path.sep}${ref.schoolId}${path.sep}`) && isInside(root, c)) {
          sourceFile = c;
          break;
        }
      }
      if (sourceFile) break;
      // Last resort: any basename match under this root (still copied under correct school path)
      if (!sourceFile && candidates.length === 1 && isInside(root, candidates[0]!)) {
        sourceFile = candidates[0]!;
        break;
      }
    }

    if (!sourceFile) {
      missing += 1;
      missingList.push(`${ref.publicUrl}  (${ref.source})`);
      continue;
    }

    if (apply) {
      await fs.ensureDir(path.dirname(targetAbs));
      await fs.copy(sourceFile, targetAbs, { overwrite: false });
      restored += 1;
      console.log(`RESTORED  ${ref.publicUrl}`);
      console.log(`         ← ${sourceFile}`);
    } else {
      restored += 1;
      console.log(`CAN RESTORE  ${ref.publicUrl}`);
      console.log(`           ← ${sourceFile}`);
      console.log(`           → ${targetAbs}`);
    }
  }

  console.log("");
  console.log("=== Summary ===");
  console.log(`Already in UPLOAD_DIR : ${ok}`);
  console.log(`${apply ? "Copied" : "Can restore"}          : ${restored}`);
  console.log(`Still missing         : ${missing}`);
  if (missingList.length) {
    console.log("");
    console.log("Missing (must re-upload):");
    for (const line of missingList.slice(0, 40)) {
      console.log(`  - ${line}`);
    }
    if (missingList.length > 40) {
      console.log(`  ... and ${missingList.length - 40} more`);
    }
  }

  if (!apply && restored > 0) {
    console.log("");
    console.log("Next step: run with --apply to copy files into UPLOAD_DIR, then restart backend:");
    console.log("  npx tsx src/scripts/restoreMissingUploads.ts --apply");
  }
  if (apply && restored > 0) {
    console.log("");
    console.log("Restart the backend so it keeps using this UPLOAD_DIR:");
    console.log(`  UPLOAD_DIR=${primaryRoot}`);
  }

  await mongoose.connection.close();
};

run().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.connection.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
