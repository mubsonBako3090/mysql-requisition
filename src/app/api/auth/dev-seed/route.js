/**
 * ONE-TIME SEED ROUTE — DELETE THIS FILE AFTER USE
 * -------------------------------------------------------------------------
 * Lets you seed the database by visiting a URL from your phone, no
 * terminal needed. Protected by a secret key so randoms can't trigger it.
 *
 * WHERE TO PUT THIS FILE
 *   <project-root>/src/app/api/dev/seed/route.js
 *   (create the "dev" and "seed" folders — they don't exist yet)
 *
 * ONE-TIME SETUP
 *   In Vercel: Project → Settings → Environment Variables, add:
 *     SEED_SECRET = <any long random string you make up>
 *   Redeploy (Vercel does this automatically when you push the new file).
 *
 * HOW TO RUN IT
 *   Visit, from your phone browser, once:
 *     https://<your-app>.vercel.app/api/auth/dev-seed?secret=<SEED_SECRET>&mode=add
 *   Modes:
 *     add                        — seed users + requisitions (fails on
 *                                  duplicate emails if already seeded)
 *     reset                      — wipe previous seed data (only docs
 *                                  tagged seedTag: "ksu-seed-v1"), then
 *                                  reseed fresh. Never touches real
 *                                  admin accounts.
 *     clear-seeded-requisitions  — delete ONLY the seeded test
 *                                  requisitions (+ their approvals/audit
 *                                  logs). Does not reseed, does not
 *                                  touch users or real requisitions.
 *     clear-all-requisitions     — delete EVERY requisition in the
 *                                  database, seeded or real (+ all
 *                                  approvals and requisition audit
 *                                  logs). Does not reseed, does not
 *                                  touch users. Destructive — use with
 *                                  care.
 *
 * AFTER YOU'RE DONE
 *   Delete this file (and the now-empty dev/seed folders) and redeploy,
 *   or at minimum remove SEED_SECRET from Vercel — leaving a seed
 *   endpoint live in production is not something to keep around.
 */

import { NextResponse } from "next/server";

import { connectDB } from "@/lib/db";
import bcrypt from "bcryptjs";
import { collection, newObjectId } from "@/lib/orm";

import User from "@/models/User";
import Requisition from "@/models/Requisition";
import Approval from "@/models/Approval";
import AuditLog from "@/models/AuditLog";

import { COLLEGES } from "@/constants/colleges";
import { ROLES } from "@/constants/roles";
import { PROCUREMENT_POSITIONS } from "@/constants/procurement";
import { REQUISITION_STATUS, APPROVAL_ACTIONS } from "@/constants/requisitionOptions";

const SEED_TAG = "ksu-seed-v1";
const SEED_PASSWORD = "KasuSeed#2026";
const NA = "N/A";

const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  const mode = searchParams.get("mode") || "add";

  if (!process.env.SEED_SECRET) {
    return NextResponse.json(
      { message: "SEED_SECRET is not set in your environment variables. Add it in Vercel and redeploy." },
      { status: 500 }
    );
  }

  if (!secret || secret !== process.env.SEED_SECRET) {
    return NextResponse.json({ message: "Invalid or missing secret." }, { status: 401 });
  }

  try {
    await connectDB();
    const db = { collection };

    // ---------------------------------------------------------------
    // Pure delete modes — these do NOT reseed anything afterward.
    // ---------------------------------------------------------------
    if (mode === "clear-seeded-requisitions") {
      const [reqRes, apprRes, auditRes] = await Promise.all([
        db.collection("requisitions").deleteMany({ seedTag: SEED_TAG }),
        db.collection("approvals").deleteMany({ seedTag: SEED_TAG }),
        db.collection("auditlogs").deleteMany({ seedTag: SEED_TAG, entityType: "Requisition" }),
      ]);
      return NextResponse.json({
        message: "Deleted all seeded (test) requisitions, their approvals, and their audit logs. Seeded users were left untouched.",
        mode,
        deleted: {
          requisitions: reqRes.deletedCount,
          approvals: apprRes.deletedCount,
          auditLogs: auditRes.deletedCount,
        },
      });
    }

    if (mode === "clear-all-requisitions") {
      const [reqRes, apprRes, auditRes] = await Promise.all([
        db.collection("requisitions").deleteMany({}),
        db.collection("approvals").deleteMany({}),
        db.collection("auditlogs").deleteMany({ entityType: "Requisition" }),
      ]);
      return NextResponse.json({
        message:
          "Deleted EVERY requisition in the database (seeded and real), every approval, and every requisition-related audit log. Users and non-requisition audit logs were left untouched.",
        mode,
        deleted: {
          requisitions: reqRes.deletedCount,
          approvals: apprRes.deletedCount,
          auditLogs: auditRes.deletedCount,
        },
      });
    }

    if (mode === "reset") {
      await Promise.all([
        db.collection("users").deleteMany({ seedTag: SEED_TAG }),
        db.collection("requisitions").deleteMany({ seedTag: SEED_TAG }),
        db.collection("approvals").deleteMany({ seedTag: SEED_TAG }),
        db.collection("auditlogs").deleteMany({ seedTag: SEED_TAG }),
      ]);
    }

    const now = new Date();
    const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
    const userDocs = [];
    const orgIndex = {};

    function makeUser({ fullName, email, role, procurementPosition, collegeId, facultyId, department }) {
      const doc = {
        _id: newObjectId(),
        fullName,
        email,
        passwordHash,
        role,
        procurementPosition: procurementPosition || PROCUREMENT_POSITIONS.PROCUREMENT_OFFICER_II,
        collegeId: collegeId || NA,
        facultyId: facultyId || NA,
        department: department || NA,
        accountStatus: "active",
        isSystemAdmin: false,
        createdAt: now,
        updatedAt: now,
        seedTag: SEED_TAG,
      };
      userDocs.push(doc);
      return doc;
    }

    const vc = makeUser({
      fullName: "Prof. Amina Bello (Vice Chancellor)",
      email: "vc@ksu-test.edu.ng",
      role: ROLES.VC,
    });

    const procDirector = makeUser({
      fullName: "Ibrahim Yusuf (Director of Procurement)",
      email: "procurement.director@ksu-test.edu.ng",
      role: ROLES.PROCUREMENT,
      procurementPosition: PROCUREMENT_POSITIONS.DIRECTOR,
    });
    const procSenior = makeUser({
      fullName: "Hauwa Musa (Principal Procurement Officer)",
      email: "procurement.senior@ksu-test.edu.ng",
      role: ROLES.PROCUREMENT,
      procurementPosition: PROCUREMENT_POSITIONS.PRINCIPAL_SENIOR,
    });
    const procOfficerI_A = makeUser({
      fullName: "Sani Garba (Procurement Officer I)",
      email: "procurement.officer1a@ksu-test.edu.ng",
      role: ROLES.PROCUREMENT,
      procurementPosition: PROCUREMENT_POSITIONS.PROCUREMENT_OFFICER_I,
    });
    makeUser({
      fullName: "Zainab Aliyu (Procurement Officer I)",
      email: "procurement.officer1b@ksu-test.edu.ng",
      role: ROLES.PROCUREMENT,
      procurementPosition: PROCUREMENT_POSITIONS.PROCUREMENT_OFFICER_I,
    });
    makeUser({
      fullName: "Bello Umar (Procurement Officer II)",
      email: "procurement.officer2a@ksu-test.edu.ng",
      role: ROLES.PROCUREMENT,
      procurementPosition: PROCUREMENT_POSITIONS.PROCUREMENT_OFFICER_II,
    });
    const procOfficerII_B = makeUser({
      fullName: "Fatima Suleiman (Procurement Officer II)",
      email: "procurement.officer2b@ksu-test.edu.ng",
      role: ROLES.PROCUREMENT,
      procurementPosition: PROCUREMENT_POSITIONS.PROCUREMENT_OFFICER_II,
    });
    makeUser({
      fullName: "Chidi Okafor (Procurement Admin Support)",
      email: "procurement.support@ksu-test.edu.ng",
      role: ROLES.PROCUREMENT,
      procurementPosition: PROCUREMENT_POSITIONS.ADMIN_SUPPORT,
    });

    for (const college of COLLEGES) {
      const provost = makeUser({
        fullName: `Provost, ${college.name}`,
        email: `provost.${slug(college.id)}@ksu-test.edu.ng`,
        role: ROLES.PROVOST,
        collegeId: college.id,
      });
      orgIndex[`provost:${college.id}`] = provost;

      for (const faculty of college.faculties) {
        const dean = makeUser({
          fullName: `Dean, ${faculty.name}`,
          email: `dean.${slug(college.id)}.${slug(faculty.id)}@ksu-test.edu.ng`,
          role: ROLES.DEAN,
          collegeId: college.id,
          facultyId: faculty.id,
        });
        orgIndex[`dean:${college.id}:${faculty.id}`] = dean;

        for (const department of faculty.departments) {
          const deptSlug = slug(department);

          const hod = makeUser({
            fullName: `HOD, ${department}`,
            email: `hod.${slug(college.id)}.${deptSlug}@ksu-test.edu.ng`,
            role: ROLES.HOD,
            collegeId: college.id,
            facultyId: faculty.id,
            department,
          });
          orgIndex[`hod:${college.id}:${faculty.id}:${department}`] = hod;

          const requester = makeUser({
            fullName: `${department} Requester`,
            email: `requester.${slug(college.id)}.${deptSlug}@ksu-test.edu.ng`,
            role: ROLES.REQUESTER,
            collegeId: college.id,
            facultyId: faculty.id,
            department,
          });
          orgIndex[`requester:${college.id}:${faculty.id}:${department}`] = requester;
        }
      }
    }

    // =====================================================================
    // SAMPLE REQUISITIONS
    // =====================================================================
    const requisitionDocs = [];
    const approvalDocs = [];
    const auditLogDocs = [];
    let reqCounter = 1;
    const nextReqNumber = () => `KASU-REQ-2026-${String(reqCounter++).padStart(4, "0")}`;

    function withTotals(items) {
      let estimatedCost = 0;
      const priced = items.map((it) => {
        const totalCost = it.quantity * it.unitCost;
        estimatedCost += totalCost;
        return { ...it, totalCost };
      });
      return { items: priced, estimatedCost };
    }

    function newRequisition({ requester, college, facultyId, department, category, purpose, urgency, items }) {
      const { items: pricedItems, estimatedCost } = withTotals(items);
      return {
        _id: newObjectId(),
        requisitionNumber: nextReqNumber(),
        requester: requester._id,
        requesterRole: requester.role,
        isConsolidated: false,
        sourceRequisitions: [],
        requestingUnits: [],
        collegeId: college.id,
        facultyId,
        department,
        category,
        purpose,
        urgency,
        items: pricedItems,
        estimatedCost,
        attachments: [],
        comments: [],
        status: REQUISITION_STATUS.DRAFT,
        approvalChain: [],
        currentStepIndex: 0,
        awaitingRequesterAction: false,
        requiresGovernorApproval: estimatedCost > 10000000,
        procurementRevision: 0,
        procurementPriceHistory: [],
        procurementAssignmentHistory: [],
        createdAt: now,
        updatedAt: now,
        seedTag: SEED_TAG,
      };
    }

    function buildChain(college, facultyId, department, { processingApprover } = {}) {
      const routingType = college.routingType || "standard";
      const roleSeq =
        routingType === "standard"
          ? [ROLES.HOD, ROLES.DEAN, ROLES.PROVOST, ROLES.PROCUREMENT, ROLES.VC]
          : [ROLES.HOD, ROLES.PROVOST, ROLES.PROCUREMENT, ROLES.VC];

      const chain = roleSeq.map((role) => {
        let approver;
        if (role === ROLES.HOD) approver = orgIndex[`hod:${college.id}:${facultyId}:${department}`];
        else if (role === ROLES.DEAN) approver = orgIndex[`dean:${college.id}:${facultyId}`];
        else if (role === ROLES.PROVOST) approver = orgIndex[`provost:${college.id}`];
        else if (role === ROLES.PROCUREMENT) approver = procDirector;
        else if (role === ROLES.VC) approver = vc;
        return { role, approver: approver._id, type: role === ROLES.PROCUREMENT ? "procurement_review" : "approval" };
      });

      chain.push({
        role: ROLES.PROCUREMENT,
        approver: (processingApprover || procDirector)._id,
        type: "processing",
      });

      return chain;
    }

    function addApproval({ requisition, stepIndex, role, approver, action, comment }) {
      approvalDocs.push({
        _id: newObjectId(),
        requisition: requisition._id,
        stepIndex,
        role,
        approver: approver._id,
        action,
        comment,
        createdAt: now,
        updatedAt: now,
        seedTag: SEED_TAG,
      });
    }

    function addAudit({ actor, action, entityId, details }) {
      auditLogDocs.push({
        _id: newObjectId(),
        actor: actor ? actor._id : null,
        action,
        entityType: "Requisition",
        entityId,
        details: details || {},
        createdAt: now,
        seedTag: SEED_TAG,
      });
    }

    const csCollege = COLLEGES.find((c) => c.id === "science-computing-engineering");
    const csFacultyId = "computing";
    const csDept = "Computer Science";
    const csRequester = orgIndex[`requester:${csCollege.id}:${csFacultyId}:${csDept}`];
    const csHod = orgIndex[`hod:${csCollege.id}:${csFacultyId}:${csDept}`];
    const csDean = orgIndex[`dean:${csCollege.id}:${csFacultyId}`];

    const humCollege = COLLEGES.find((c) => c.id === "humanities-education-law");
    const humFacultyId = "arts";
    const humDept = "History";
    const humRequester = orgIndex[`requester:${humCollege.id}:${humFacultyId}:${humDept}`];
    const humHod = orgIndex[`hod:${humCollege.id}:${humFacultyId}:${humDept}`];

    const pgCollege = COLLEGES.find((c) => c.id === "postgraduate-studies");
    const pgFacultyId = "postgraduate-programmes";
    const pgDept = "Postgraduate Studies";
    const pgRequester = orgIndex[`requester:${pgCollege.id}:${pgFacultyId}:${pgDept}`];
    const pgHod = orgIndex[`hod:${pgCollege.id}:${pgFacultyId}:${pgDept}`];

    // 1) DRAFT
    {
      const r = newRequisition({
        requester: csRequester,
        college: csCollege,
        facultyId: csFacultyId,
        department: csDept,
        category: "ICT Equipment & Software",
        purpose: "Replacement laptops for final-year project supervision lab",
        urgency: "normal",
        items: [
          { name: "Laptop (Core i7, 16GB RAM)", quantity: 5, unitCost: 650000 },
          { name: "Laptop bag", quantity: 5, unitCost: 15000 },
        ],
      });
      requisitionDocs.push(r);
    }

    // 2) PENDING — awaiting HOD
    {
      const r = newRequisition({
        requester: csRequester,
        college: csCollege,
        facultyId: csFacultyId,
        department: csDept,
        category: "Laboratory Equipment & Reagents",
        purpose: "Networking lab upgrade for CSC 401 practicals",
        urgency: "high",
        items: [
          { name: "24-port Gigabit switch", quantity: 4, unitCost: 120000 },
          { name: "Cat6 cable (305m box)", quantity: 6, unitCost: 45000 },
        ],
      });
      r.approvalChain = buildChain(csCollege, csFacultyId, csDept);
      r.status = REQUISITION_STATUS.PENDING;
      r.currentStepIndex = 0;
      r.submittedAt = now;
      requisitionDocs.push(r);
      addAudit({ actor: csRequester, action: "requisition.submit", entityId: r._id, details: { toStepIndex: 0 } });
    }

    // 3) PENDING — HOD approved, awaiting Dean
    {
      const r = newRequisition({
        requester: humRequester,
        college: humCollege,
        facultyId: humFacultyId,
        department: humDept,
        category: "Books & Instructional Materials",
        purpose: "Core textbooks for new History undergraduate intake",
        urgency: "normal",
        items: [
          { name: "African History (set of 3 texts)", quantity: 40, unitCost: 12000 },
          { name: "World History reference volume", quantity: 20, unitCost: 18000 },
        ],
      });
      const chain = buildChain(humCollege, humFacultyId, humDept);
      r.approvalChain = chain;
      r.status = REQUISITION_STATUS.PENDING;
      r.currentStepIndex = 1;
      r.submittedAt = now;
      requisitionDocs.push(r);
      addAudit({ actor: humRequester, action: "requisition.submit", entityId: r._id, details: { toStepIndex: 0 } });
      addApproval({ requisition: r, stepIndex: 0, role: ROLES.HOD, approver: humHod, action: APPROVAL_ACTIONS.APPROVE });
      addAudit({ actor: humHod, action: "requisition.approve", entityId: r._id, details: { stepIndex: 1, role: ROLES.HOD } });
    }

    // 4) PENDING — postgraduate routing (no Dean), awaiting Provost
    {
      const r = newRequisition({
        requester: pgRequester,
        college: pgCollege,
        facultyId: pgFacultyId,
        department: pgDept,
        category: "Office Supplies & Stationery",
        purpose: "Stationery and printing supplies for PG thesis defense season",
        urgency: "low",
        items: [
          { name: "A4 paper (ream)", quantity: 100, unitCost: 3500 },
          { name: "Toner cartridge", quantity: 8, unitCost: 28000 },
        ],
      });
      const chain = buildChain(pgCollege, pgFacultyId, pgDept);
      r.approvalChain = chain;
      r.status = REQUISITION_STATUS.PENDING;
      r.currentStepIndex = 1;
      r.submittedAt = now;
      requisitionDocs.push(r);
      addAudit({ actor: pgRequester, action: "requisition.submit", entityId: r._id, details: { toStepIndex: 0 } });
      addApproval({ requisition: r, stepIndex: 0, role: ROLES.HOD, approver: pgHod, action: APPROVAL_ACTIONS.APPROVE });
      addAudit({ actor: pgHod, action: "requisition.approve", entityId: r._id, details: { stepIndex: 1, role: ROLES.HOD } });
    }

    // 5) RETURNED — Dean returned to HOD
    {
      const r = newRequisition({
        requester: csRequester,
        college: csCollege,
        facultyId: csFacultyId,
        department: csDept,
        category: "Furniture & Fittings",
        purpose: "Additional seating for departmental seminar room",
        urgency: "low",
        items: [{ name: "Stackable chair", quantity: 30, unitCost: 18000 }],
      });
      const chain = buildChain(csCollege, csFacultyId, csDept);
      r.approvalChain = chain;
      r.status = REQUISITION_STATUS.RETURNED;
      r.currentStepIndex = 0;
      r.awaitingRequesterAction = false;
      r.submittedAt = now;
      const clarificationMsg =
        "Please clarify whether this is for the main seminar room or the annex — quantity seems high for the annex alone.";
      r.comments.push({ author: csDean._id, message: clarificationMsg, createdAt: now });
      requisitionDocs.push(r);
      addAudit({ actor: csRequester, action: "requisition.submit", entityId: r._id, details: { toStepIndex: 0 } });
      addApproval({ requisition: r, stepIndex: 0, role: ROLES.HOD, approver: csHod, action: APPROVAL_ACTIONS.APPROVE });
      addApproval({
        requisition: r,
        stepIndex: 1,
        role: ROLES.DEAN,
        approver: csDean,
        action: APPROVAL_ACTIONS.RETURN,
        comment: clarificationMsg,
      });
      addAudit({ actor: csDean, action: "requisition.return", entityId: r._id, details: { comment: "Clarification requested on room/quantity." } });
    }

    // 6) REJECTED — final rejection by Dean
    {
      const r = newRequisition({
        requester: humRequester,
        college: humCollege,
        facultyId: humFacultyId,
        department: humDept,
        category: "Vehicles & Transportation",
        purpose: "Departmental field-trip minibus",
        urgency: "normal",
        items: [{ name: "Used 18-seater minibus", quantity: 1, unitCost: 8500000 }],
      });
      const chain = buildChain(humCollege, humFacultyId, humDept);
      r.approvalChain = chain;
      r.status = REQUISITION_STATUS.REJECTED;
      r.currentStepIndex = 1;
      r.decidedAt = now;
      r.submittedAt = now;
      const rejectMsg = "Vehicle acquisitions of this scale must go through the central Transport Unit, not a departmental requisition.";
      r.comments.push({ author: chain[1].approver, message: rejectMsg, createdAt: now });
      requisitionDocs.push(r);
      addAudit({ actor: humRequester, action: "requisition.submit", entityId: r._id, details: { toStepIndex: 0 } });
      addApproval({ requisition: r, stepIndex: 0, role: ROLES.HOD, approver: humHod, action: APPROVAL_ACTIONS.APPROVE });
      const dean = orgIndex[`dean:${humCollege.id}:${humFacultyId}`];
      addApproval({ requisition: r, stepIndex: 1, role: ROLES.DEAN, approver: dean, action: APPROVAL_ACTIONS.REJECT, comment: rejectMsg });
      addAudit({ actor: dean, action: "requisition.reject", entityId: r._id, details: { isFinal: true } });
    }

    // 7) APPROVED — Procurement status "ready"
    {
      const r = newRequisition({
        requester: csRequester,
        college: csCollege,
        facultyId: csFacultyId,
        department: csDept,
        category: "ICT Equipment & Software",
        purpose: "Server room upgrade for the departmental data center",
        urgency: "high",
        items: [
          { name: "Rack server", quantity: 2, unitCost: 2200000 },
          { name: "UPS (10KVA)", quantity: 2, unitCost: 950000 },
        ],
      });
      const chain = buildChain(csCollege, csFacultyId, csDept);
      r.approvalChain = chain;
      const procProcessingIdx = chain.findIndex((s) => s.type === "processing");
      r.status = REQUISITION_STATUS.APPROVED;
      r.currentStepIndex = procProcessingIdx;
      r.finalApprovalAt = now;
      r.decidedAt = now;
      r.submittedAt = now;
      r.procurementStatus = "ready";
      r.procurementOfficer = procDirector._id;
      r.procurementReceivedAt = now;
      requisitionDocs.push(r);

      addAudit({ actor: csRequester, action: "requisition.submit", entityId: r._id, details: { toStepIndex: 0 } });
      addApproval({ requisition: r, stepIndex: 0, role: ROLES.HOD, approver: csHod, action: APPROVAL_ACTIONS.APPROVE });
      addApproval({ requisition: r, stepIndex: 1, role: ROLES.DEAN, approver: csDean, action: APPROVAL_ACTIONS.APPROVE });
      const provost = orgIndex[`provost:${csCollege.id}`];
      addApproval({ requisition: r, stepIndex: 2, role: ROLES.PROVOST, approver: provost, action: APPROVAL_ACTIONS.APPROVE });
      addAudit({ actor: procDirector, action: "requisition.procurement_market_survey_updated", entityId: r._id, details: { revision: 1 } });
      addAudit({ actor: procDirector, action: "requisition.procurement_submitted_to_vc", entityId: r._id, details: {} });
      addApproval({ requisition: r, stepIndex: 4, role: ROLES.VC, approver: vc, action: APPROVAL_ACTIONS.APPROVE });
      addAudit({
        actor: vc,
        action: "requisition.final_approval",
        entityId: r._id,
        details: { finalApproverRole: ROLES.VC, nextStage: ROLES.PROCUREMENT, procurementOfficer: procDirector._id },
      });
    }

    // 8) APPROVED — Procurement status "processing"
    {
      const r = newRequisition({
        requester: humRequester,
        college: humCollege,
        facultyId: humFacultyId,
        department: humDept,
        category: "Construction & Maintenance",
        purpose: "Roof repair for the Department of History block",
        urgency: "urgent",
        items: [
          { name: "Roofing sheets (long-span)", quantity: 150, unitCost: 9500 },
          { name: "Roofing labor (contract)", quantity: 1, unitCost: 850000 },
        ],
      });
      const chain = buildChain(humCollege, humFacultyId, humDept, { processingApprover: procOfficerI_A });
      const reviewIdx = chain.findIndex((s) => s.type === "procurement_review");
      chain[reviewIdx].approver = procOfficerI_A._id;
      r.approvalChain = chain;
      const procProcessingIdx = chain.findIndex((s) => s.type === "processing");
      r.status = REQUISITION_STATUS.APPROVED;
      r.currentStepIndex = procProcessingIdx;
      r.finalApprovalAt = now;
      r.decidedAt = now;
      r.submittedAt = now;
      r.procurementStatus = "processing";
      r.procurementOfficer = procOfficerI_A._id;
      r.procurementAssignedTo = procOfficerI_A._id;
      r.procurementAssignedBy = procDirector._id;
      r.procurementAssignedAt = now;
      r.procurementAssignmentHistory.push({
        assignedTo: procOfficerI_A._id,
        assignedBy: procDirector._id,
        assignedAt: now,
        note: "Please conduct market survey and expedite — roof is actively leaking.",
      });
      r.procurementReceivedAt = now;
      r.procurementStartedAt = now;
      requisitionDocs.push(r);

      const dean = orgIndex[`dean:${humCollege.id}:${humFacultyId}`];
      const provost = orgIndex[`provost:${humCollege.id}`];
      addAudit({ actor: humRequester, action: "requisition.submit", entityId: r._id, details: { toStepIndex: 0 } });
      addApproval({ requisition: r, stepIndex: 0, role: ROLES.HOD, approver: humHod, action: APPROVAL_ACTIONS.APPROVE });
      addApproval({ requisition: r, stepIndex: 1, role: ROLES.DEAN, approver: dean, action: APPROVAL_ACTIONS.APPROVE });
      addApproval({ requisition: r, stepIndex: 2, role: ROLES.PROVOST, approver: provost, action: APPROVAL_ACTIONS.APPROVE });
      addAudit({
        actor: procDirector,
        action: "requisition.procurement_assigned",
        entityId: r._id,
        details: { assignedTo: procOfficerI_A._id, assignedToPosition: procOfficerI_A.procurementPosition },
      });
      addAudit({ actor: procOfficerI_A, action: "requisition.procurement_market_survey_updated", entityId: r._id, details: { revision: 1 } });
      addAudit({ actor: procOfficerI_A, action: "requisition.procurement_submitted_to_vc", entityId: r._id, details: {} });
      addApproval({ requisition: r, stepIndex: 4, role: ROLES.VC, approver: vc, action: APPROVAL_ACTIONS.APPROVE });
      addAudit({
        actor: vc,
        action: "requisition.final_approval",
        entityId: r._id,
        details: { finalApproverRole: ROLES.VC, nextStage: ROLES.PROCUREMENT, procurementOfficer: procOfficerI_A._id },
      });
      addAudit({ actor: procOfficerI_A, action: "requisition.procurement_start", entityId: r._id, details: { procurementStatus: "processing" } });
    }

    // 9) APPROVED — Procurement status "completed"
    {
      const r = newRequisition({
        requester: pgRequester,
        college: pgCollege,
        facultyId: pgFacultyId,
        department: pgDept,
        category: "Office Supplies & Stationery",
        purpose: "Binding and printing for completed PhD thesis submissions",
        urgency: "normal",
        items: [
          { name: "Thesis binding (hardcover)", quantity: 25, unitCost: 8000 },
          { name: "A4 paper (ream)", quantity: 30, unitCost: 3500 },
        ],
      });
      const chain = buildChain(pgCollege, pgFacultyId, pgDept, { processingApprover: procOfficerII_B });
      const reviewIdx = chain.findIndex((s) => s.type === "procurement_review");
      chain[reviewIdx].approver = procOfficerII_B._id;
      r.approvalChain = chain;
      const procProcessingIdx = chain.findIndex((s) => s.type === "processing");
      r.status = REQUISITION_STATUS.APPROVED;
      r.currentStepIndex = procProcessingIdx;
      r.finalApprovalAt = now;
      r.decidedAt = now;
      r.submittedAt = now;
      r.procurementStatus = "completed";
      r.procurementOfficer = procOfficerII_B._id;
      r.procurementAssignedTo = procOfficerII_B._id;
      r.procurementAssignedBy = procDirector._id;
      r.procurementAssignedAt = now;
      r.procurementAssignmentHistory.push({
        assignedTo: procOfficerII_B._id,
        assignedBy: procDirector._id,
        assignedAt: now,
        note: "Routine order, standard vendor.",
      });
      r.procurementReceivedAt = now;
      r.procurementStartedAt = now;
      r.procurementCompletedAt = now;
      requisitionDocs.push(r);

      addAudit({ actor: pgRequester, action: "requisition.submit", entityId: r._id, details: { toStepIndex: 0 } });
      addApproval({ requisition: r, stepIndex: 0, role: ROLES.HOD, approver: pgHod, action: APPROVAL_ACTIONS.APPROVE });
      const provost = orgIndex[`provost:${pgCollege.id}`];
      addApproval({ requisition: r, stepIndex: 1, role: ROLES.PROVOST, approver: provost, action: APPROVAL_ACTIONS.APPROVE });
      addAudit({
        actor: procDirector,
        action: "requisition.procurement_assigned",
        entityId: r._id,
        details: { assignedTo: procOfficerII_B._id, assignedToPosition: procOfficerII_B.procurementPosition },
      });
      addAudit({ actor: procOfficerII_B, action: "requisition.procurement_market_survey_updated", entityId: r._id, details: { revision: 1 } });
      addAudit({ actor: procOfficerII_B, action: "requisition.procurement_submitted_to_vc", entityId: r._id, details: {} });
      addApproval({ requisition: r, stepIndex: 3, role: ROLES.VC, approver: vc, action: APPROVAL_ACTIONS.APPROVE });
      addAudit({
        actor: vc,
        action: "requisition.final_approval",
        entityId: r._id,
        details: { finalApproverRole: ROLES.VC, nextStage: ROLES.PROCUREMENT, procurementOfficer: procOfficerII_B._id },
      });
      addAudit({ actor: procOfficerII_B, action: "requisition.procurement_start", entityId: r._id, details: { procurementStatus: "processing" } });
      addAudit({ actor: procOfficerII_B, action: "requisition.procurement_complete", entityId: r._id, details: { procurementStatus: "completed" } });
    }

    // 10) APPROVED, escalated — exceeds ₦10,000,000
    {
      const r = newRequisition({
        requester: csRequester,
        college: csCollege,
        facultyId: csFacultyId,
        department: csDept,
        category: "ICT Equipment & Software",
        purpose: "Faculty-wide computing lab overhaul (150-seat capacity)",
        urgency: "high",
        items: [
          { name: "Desktop computer (lab spec)", quantity: 150, unitCost: 480000 },
          { name: "Site networking & installation", quantity: 1, unitCost: 3000000 },
        ],
      });
      const chain = buildChain(csCollege, csFacultyId, csDept, { processingApprover: procSenior });
      const reviewIdx = chain.findIndex((s) => s.type === "procurement_review");
      chain[reviewIdx].approver = procSenior._id;
      r.approvalChain = chain;
      const procProcessingIdx = chain.findIndex((s) => s.type === "processing");
      r.status = REQUISITION_STATUS.APPROVED;
      r.currentStepIndex = procProcessingIdx;
      r.finalApprovalAt = now;
      r.decidedAt = now;
      r.submittedAt = now;
      r.procurementStatus = "ready";
      r.procurementOfficer = procSenior._id;
      r.procurementAssignedTo = procSenior._id;
      r.procurementAssignedBy = procDirector._id;
      r.procurementAssignedAt = now;
      r.procurementAssignmentHistory.push({
        assignedTo: procSenior._id,
        assignedBy: procDirector._id,
        assignedAt: now,
        note: "High-value item — please coordinate with the Governor's office liaison before vendor engagement.",
      });
      r.procurementReceivedAt = now;
      requisitionDocs.push(r);

      addAudit({ actor: csRequester, action: "requisition.submit", entityId: r._id, details: { toStepIndex: 0 } });
      addApproval({ requisition: r, stepIndex: 0, role: ROLES.HOD, approver: csHod, action: APPROVAL_ACTIONS.APPROVE });
      addApproval({ requisition: r, stepIndex: 1, role: ROLES.DEAN, approver: csDean, action: APPROVAL_ACTIONS.APPROVE });
      const provost = orgIndex[`provost:${csCollege.id}`];
      addApproval({ requisition: r, stepIndex: 2, role: ROLES.PROVOST, approver: provost, action: APPROVAL_ACTIONS.APPROVE });
      addAudit({
        actor: procDirector,
        action: "requisition.procurement_assigned",
        entityId: r._id,
        details: { assignedTo: procSenior._id, assignedToPosition: procSenior.procurementPosition },
      });
      addAudit({ actor: procSenior, action: "requisition.procurement_market_survey_updated", entityId: r._id, details: { revision: 1 } });
      addAudit({ actor: procSenior, action: "requisition.procurement_submitted_to_vc", entityId: r._id, details: {} });
      addApproval({ requisition: r, stepIndex: 4, role: ROLES.VC, approver: vc, action: APPROVAL_ACTIONS.APPROVE });
      addAudit({
        actor: vc,
        action: "requisition.final_approval",
        entityId: r._id,
        details: { finalApproverRole: ROLES.VC, nextStage: ROLES.PROCUREMENT, procurementOfficer: procSenior._id, requiresGovernorApproval: true },
      });
    }

    // =====================================================================
    // BULK "AWAITING APPROVAL" REQUISITIONS
    // One requisition per HOD (awaiting the next authority up — Dean in
    // standard colleges, Provost where Dean is skipped), one per Dean
    // (awaiting Provost), and one per Provost (awaiting Procurement
    // review) — mirrors the creator-specific role sequences that
    // lib/routing.js's buildApprovalChain() actually produces, including
    // the rule that a creator never approves their own requisition.
    // =====================================================================
    function chainForCreator(creatorRole, college, facultyId, department) {
      const routingType = college.routingType || "standard";
      let roleSeq;
      if (creatorRole === ROLES.HOD) {
        roleSeq =
          routingType === "standard"
            ? [ROLES.DEAN, ROLES.PROVOST, ROLES.PROCUREMENT, ROLES.VC]
            : [ROLES.PROVOST, ROLES.PROCUREMENT, ROLES.VC];
      } else if (creatorRole === ROLES.DEAN) {
        roleSeq = [ROLES.PROVOST, ROLES.PROCUREMENT, ROLES.VC];
      } else {
        // ROLES.PROVOST
        roleSeq = [ROLES.PROCUREMENT, ROLES.VC];
      }

      const chain = roleSeq.map((role) => {
        let approver;
        if (role === ROLES.DEAN) approver = orgIndex[`dean:${college.id}:${facultyId}`];
        else if (role === ROLES.PROVOST) approver = orgIndex[`provost:${college.id}`];
        else if (role === ROLES.PROCUREMENT) approver = procDirector;
        else if (role === ROLES.VC) approver = vc;
        return { role, approver: approver._id, type: role === ROLES.PROCUREMENT ? "procurement_review" : "approval" };
      });

      chain.push({ role: ROLES.PROCUREMENT, approver: procDirector._id, type: "processing" });
      return chain;
    }

    let hodInitiatedCount = 0;
    let deanInitiatedCount = 0;
    let provostInitiatedCount = 0;

    // One per HOD — awaiting Dean (standard colleges) or Provost (postgrad/basicStudies)
    for (const college of COLLEGES) {
      for (const faculty of college.faculties) {
        for (const department of faculty.departments) {
          const hod = orgIndex[`hod:${college.id}:${faculty.id}:${department}`];
          const r = newRequisition({
            requester: hod,
            college,
            facultyId: faculty.id,
            department,
            category: "Office Supplies & Stationery",
            purpose: `Departmental supplies request — ${department}`,
            urgency: "normal",
            items: [{ name: "Assorted office supplies", quantity: 1, unitCost: 150000 }],
          });
          r.approvalChain = chainForCreator(ROLES.HOD, college, faculty.id, department);
          r.status = REQUISITION_STATUS.PENDING;
          r.currentStepIndex = 0;
          r.submittedAt = now;
          requisitionDocs.push(r);
          addAudit({ actor: hod, action: "requisition.submit", entityId: r._id, details: { toStepIndex: 0 } });
          hodInitiatedCount++;
        }
      }
    }

    // One per Dean — awaiting Provost
    for (const college of COLLEGES) {
      for (const faculty of college.faculties) {
        const dean = orgIndex[`dean:${college.id}:${faculty.id}`];
        const r = newRequisition({
          requester: dean,
          college,
          facultyId: faculty.id,
          department: NA,
          category: "Office Supplies & Stationery",
          purpose: `Faculty-wide supplies request — ${faculty.name}`,
          urgency: "normal",
          items: [{ name: "Assorted office supplies", quantity: 1, unitCost: 300000 }],
        });
        r.approvalChain = chainForCreator(ROLES.DEAN, college, faculty.id, NA);
        r.status = REQUISITION_STATUS.PENDING;
        r.currentStepIndex = 0;
        r.submittedAt = now;
        requisitionDocs.push(r);
        addAudit({ actor: dean, action: "requisition.submit", entityId: r._id, details: { toStepIndex: 0 } });
        deanInitiatedCount++;
      }
    }

    // One per Provost — awaiting Procurement review
    for (const college of COLLEGES) {
      const provost = orgIndex[`provost:${college.id}`];
      const r = newRequisition({
        requester: provost,
        college,
        facultyId: NA,
        department: NA,
        category: "Office Supplies & Stationery",
        purpose: `College-wide supplies request — ${college.name}`,
        urgency: "normal",
        items: [{ name: "Assorted office supplies", quantity: 1, unitCost: 500000 }],
      });
      r.approvalChain = chainForCreator(ROLES.PROVOST, college, NA, NA);
      r.status = REQUISITION_STATUS.PENDING;
      r.currentStepIndex = 0;
      r.submittedAt = now;
      requisitionDocs.push(r);
      addAudit({ actor: provost, action: "requisition.submit", entityId: r._id, details: { toStepIndex: 0 } });
      provostInitiatedCount++;
    }

    // =====================================================================
    // INSERT (raw driver — bypasses Mongoose validation so the exact
    // shapes above are stored as-is, matching your schemas field-for-field)
    // =====================================================================
    if (userDocs.length) await db.collection("users").insertMany(userDocs);
    if (requisitionDocs.length) await db.collection("requisitions").insertMany(requisitionDocs);
    if (approvalDocs.length) await db.collection("approvals").insertMany(approvalDocs);
    if (auditLogDocs.length) await db.collection("auditlogs").insertMany(auditLogDocs);

    return NextResponse.json({
      message: "Seed complete. Delete this route now.",
      mode,
      counts: {
        users: userDocs.length,
        requisitions: requisitionDocs.length,
        approvals: approvalDocs.length,
        auditLogs: auditLogDocs.length,
        hodInitiatedAwaitingNextApprover: hodInitiatedCount,
        deanInitiatedAwaitingProvost: deanInitiatedCount,
        provostInitiatedAwaitingProcurement: provostInitiatedCount,
      },
      loginPassword: SEED_PASSWORD,
      sampleLogins: {
        requester_computerScience: csRequester.email,
        hod_computerScience: csHod.email,
        dean_computing: csDean.email,
        vc: vc.email,
        procurementDirector: procDirector.email,
      },
    });
  } catch (err) {
    return NextResponse.json({ message: "Seed failed.", error: err.message }, { status: 500 });
  }
}
