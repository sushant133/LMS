import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { INSTITUTION_NAME } from "@phit-erp/shared";
import { CollegeLogo } from "components/shared/CollegeLogo";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";

const LAST_UPDATED = "20 July 2026";

const sections: { id: string; title: string; body: ReactNode }[] = [
  {
    id: "introduction",
    title: "1. Introduction",
    body: (
      <>
        <p>
          This Privacy Policy describes how <strong>{INSTITUTION_NAME}</strong>{" "}
          (&ldquo;PHIT&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;)
          collects, uses, stores, and protects personal information when you use the{" "}
          <strong>PHIT LMS</strong> learning management and college administration
          platform (the &ldquo;Service&rdquo;).
        </p>
        <p>
          By accessing or using the Service, you acknowledge that you have read and
          understood this Policy. If you do not agree, please do not use the Service
          and contact the college administration for assistance.
        </p>
      </>
    ),
  },
  {
    id: "who-we-are",
    title: "2. Who we are",
    body: (
      <>
        <p>
          The Service is operated by {INSTITUTION_NAME} for academic, administrative,
          and institutional purposes. PHIT LMS is used by students, parents/guardians,
          teachers, college staff, administrators, and other authorized roles within
          the institution.
        </p>
        <p>
          For privacy-related questions, contact the college administration through the
          official channels published by {INSTITUTION_NAME} (for example, the
          college office or institutional email).
        </p>
      </>
    ),
  },
  {
    id: "scope",
    title: "3. Scope",
    body: (
      <>
        <p>This Policy applies to personal information processed through PHIT LMS, including:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Web and progressive web app (PWA) access to the Service</li>
          <li>User accounts and authentication</li>
          <li>Academic, attendance, examination, library, laboratory, transport, fee, HR, and related modules</li>
          <li>Notices, complaints, homework, field duty, and parent portal features</li>
          <li>Files and documents uploaded to the Service (where permitted by your role)</li>
        </ul>
      </>
    ),
  },
  {
    id: "information-we-collect",
    title: "4. Information we collect",
    body: (
      <>
        <p>Depending on your role and how you use the Service, we may process:</p>
        <h3 className="mt-4 text-sm font-semibold text-slate-900">Account and identity data</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>Full name, login ID / email, phone number, and password (stored in hashed form)</li>
          <li>Role and access permissions (e.g. student, teacher, parent, administrator, staff)</li>
          <li>Parent/guardian relationship to a student and registration linkage</li>
        </ul>
        <h3 className="mt-4 text-sm font-semibold text-slate-900">Student and academic records</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>Registration / admission numbers, programme, batch, year, and section</li>
          <li>Attendance, homework, examination results, marksheets, and academic progress</li>
          <li>Timetable, subject assignments, syllabus and session planning data</li>
          <li>Library borrowing, laboratory activity, field duty, and transport assignments where applicable</li>
        </ul>
        <h3 className="mt-4 text-sm font-semibold text-slate-900">Administrative and financial data</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>Fee records, receipts, and related accounting entries (authorized roles only)</li>
          <li>Staff / HR information required for college operations (authorized roles only)</li>
          <li>Complaints, notices, and institutional configuration settings</li>
        </ul>
        <h3 className="mt-4 text-sm font-semibold text-slate-900">Technical and usage data</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>Session cookies and authentication tokens needed to keep you signed in</li>
          <li>Device and browser information reasonably required for security and service operation</li>
          <li>Server logs such as timestamps and error diagnostics for reliability and abuse prevention</li>
        </ul>
        <p className="mt-3">
          We do not intentionally collect payment card numbers through public pages.
          Financial processing within the LMS is limited to institutional fee and
          accounting workflows managed by authorized staff.
        </p>
      </>
    ),
  },
  {
    id: "how-we-use",
    title: "5. How we use information",
    body: (
      <>
        <p>We use personal information to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Provide secure login and role-based access to the Service</li>
          <li>Deliver teaching, learning, attendance, examination, and academic administration features</li>
          <li>Enable parent/guardian visibility into linked student academic information (where authorized)</li>
          <li>Operate library, laboratory, transport, HR, fee, and other institutional modules</li>
          <li>Send operational notices and account-related communications (e.g. credentials or approvals)</li>
          <li>Generate institutional reports and exports required for college administration</li>
          <li>Maintain security, prevent unauthorized access, and troubleshoot technical issues</li>
          <li>Comply with applicable legal and regulatory obligations</li>
        </ul>
      </>
    ),
  },
  {
    id: "legal-basis",
    title: "6. Why we process information",
    body: (
      <>
        <p>We process personal information because it is necessary to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Operate an educational institution and deliver academic services</li>
          <li>Perform our contract or relationship with students, parents/guardians, and staff</li>
          <li>Meet legitimate institutional interests such as security, record-keeping, and administration</li>
          <li>Comply with laws, regulations, or lawful requests applicable to the college</li>
        </ul>
      </>
    ),
  },
  {
    id: "sharing",
    title: "7. How information is shared",
    body: (
      <>
        <p>
          Personal information is shared only as needed for institutional operations and
          is restricted by role-based access controls. For example:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Teachers may see information relevant to their assigned classes and duties</li>
          <li>Parents/guardians may see information about linked students after approval</li>
          <li>Administrators and authorized staff may access records needed for their functions</li>
        </ul>
        <p className="mt-3">We do not sell personal information.</p>
        <p className="mt-3">
          We may disclose information to service providers that host or support the
          Service (such as hosting, email delivery, or infrastructure providers),
          solely to operate the platform and under appropriate confidentiality and
          security expectations. We may also disclose information if required by law,
          court order, or to protect the rights, safety, or property of the college,
          users, or the public.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "8. Cookies and local storage",
    body: (
      <>
        <p>
          The Service uses cookies and similar technologies that are essential for
          authentication and session management. Without these technologies, secure
          login and continuous use of protected pages would not work reliably.
        </p>
        <p>
          Limited browser storage (for example local preferences) may also be used to
          improve usability of certain features. The Service is not intended to use
          third-party advertising cookies.
        </p>
      </>
    ),
  },
  {
    id: "retention",
    title: "9. Data retention",
    body: (
      <>
        <p>
          We retain personal information for as long as needed to provide the Service,
          maintain academic and administrative records, meet institutional policies, and
          comply with legal obligations. Retention periods may vary by record type
          (for example academic transcripts and fee records may be kept longer than
          temporary session logs).
        </p>
        <p>
          When information is no longer required, we take reasonable steps to delete,
          archive, or de-identify it according to institutional practice and technical
          constraints.
        </p>
      </>
    ),
  },
  {
    id: "security",
    title: "10. Security",
    body: (
      <>
        <p>
          We implement reasonable technical and organizational measures to protect
          personal information, including authentication controls, role-based
          authorization, secure transport (HTTPS where configured), password hashing,
          and server-side access restrictions for protected files.
        </p>
        <p>
          No method of transmission or storage is completely secure. You are
          responsible for keeping your login credentials confidential and for signing
          out of shared devices.
        </p>
      </>
    ),
  },
  {
    id: "your-rights",
    title: "11. Your rights and choices",
    body: (
      <>
        <p>Subject to applicable law and institutional policy, you may request to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Access personal information held about you in the Service</li>
          <li>Correct inaccurate or incomplete information</li>
          <li>Ask about retention or restriction of certain processing, where appropriate</li>
          <li>Raise a privacy concern with the college administration</li>
        </ul>
        <p className="mt-3">
          Some records (such as examination results or official academic history) may
          be retained for legitimate educational or legal reasons even if an account is
          deactivated. Parents/guardians generally only receive access to student
          information after administrative verification and approval.
        </p>
      </>
    ),
  },
  {
    id: "children",
    title: "12. Students and minors",
    body: (
      <>
        <p>
          PHIT LMS is an institutional platform. Student accounts and records are
          created and managed under the authority of the college. Parent or guardian
          accounts are linked to students only after verification of the student
          registration number and administrator approval.
        </p>
        <p>
          If you believe a minor&apos;s information has been provided incorrectly or
          without proper authority, contact the college administration promptly so the
          matter can be reviewed.
        </p>
      </>
    ),
  },
  {
    id: "international",
    title: "13. Hosting and transfers",
    body: (
      <>
        <p>
          The Service may be hosted on infrastructure located in or outside Nepal.
          Where personal information is processed by hosting or support providers, we
          take reasonable steps to ensure appropriate safeguards consistent with the
          operational needs of the college and applicable requirements.
        </p>
      </>
    ),
  },
  {
    id: "third-party",
    title: "14. Third-party links and services",
    body: (
      <>
        <p>
          The Service may contain links to external websites or rely on third-party
          infrastructure (for example cloud hosting). Those services are governed by
          their own privacy practices. We encourage you to review the privacy notices of
          any third-party sites you visit.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    title: "15. Changes to this Policy",
    body: (
      <>
        <p>
          We may update this Privacy Policy from time to time to reflect changes in the
          Service, institutional practice, or legal requirements. The &ldquo;Last
          updated&rdquo; date at the top of this page will be revised when changes are
          published. Continued use of the Service after an update constitutes notice of
          the revised Policy, except where applicable law requires additional steps.
        </p>
      </>
    ),
  },
  {
    id: "contact",
    title: "16. Contact",
    body: (
      <>
        <p>
          For questions, access requests, or privacy concerns related to PHIT LMS,
          please contact the administration of {INSTITUTION_NAME} through the
          college&apos;s official contact channels.
        </p>
        <p>
          For account login issues, use the sign-in page or contact the administrator
          who issued your credentials.
        </p>
      </>
    ),
  },
];

export const PrivacyPolicyPage = () => {
  return (
    <div className="min-h-screen bg-[linear-gradient(160deg,_#ecfeff_0%,_#f8fafc_45%,_#d6e2f5_100%)] px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <CollegeLogo className="h-12 w-12" />
            <div>
              <p className="text-sm font-medium text-brand-800">PHIT LMS</p>
              <p className="text-xs text-slate-600">{INSTITUTION_NAME}</p>
            </div>
          </div>
          <Button asChild variant="outline" className="bg-white/80">
            <Link to="/login">Back to login</Link>
          </Button>
        </div>

        <Card className="border-white/70 bg-white/95 shadow-xl">
          <CardHeader className="gap-2">
            <CardTitle className="text-2xl">Privacy Policy</CardTitle>
            <p className="text-sm text-slate-600">
              How {INSTITUTION_NAME} collects, uses, and protects personal information
              in PHIT LMS.
            </p>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Last updated: {LAST_UPDATED}
            </p>
          </CardHeader>
          <CardContent className="space-y-8 text-sm leading-relaxed text-slate-700">
            <nav aria-label="Privacy policy sections" className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                On this page
              </p>
              <ul className="grid gap-1 sm:grid-cols-2">
                {sections.map((section) => (
                  <li key={section.id}>
                    <a
                      className="text-brand-700 hover:text-brand-900 hover:underline"
                      href={`#${section.id}`}
                    >
                      {section.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            {sections.map((section) => (
              <section key={section.id} id={section.id} className="scroll-mt-6 space-y-3">
                <h2 className="text-base font-semibold text-slate-900">{section.title}</h2>
                <div className="space-y-3">{section.body}</div>
              </section>
            ))}

            <div className="border-t border-slate-100 pt-6">
              <p className="text-xs text-slate-500">
                This page is provided for transparency about PHIT LMS data practices. It
                does not create rights beyond those required by applicable law or
                institutional policy.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button asChild>
                  <Link to="/login">Sign in</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/register">Parent registration</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
