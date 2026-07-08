import fs from "fs";
import path from "path";

const COLLEGE_LOGO_PATH = path.join(process.cwd(), "assets", "college-logo.png");

export const collegeLogoExists = (): boolean => fs.existsSync(COLLEGE_LOGO_PATH);

export const getCollegeLogoPath = (): string => COLLEGE_LOGO_PATH;