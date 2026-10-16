/**
 * KSU Digital Procurement Requisition System — Database Seed Script
 * -------------------------------------------------------------------------
 * Populates active users across every KASU college/faculty/department
 * (Provost, Dean, HOD, Requester per unit + a full Procurement bench + VC),
 * plus sample requisitions covering the full workflow: draft, pending
 * (at different chain positions, including the postgraduate/basic-studies
 * routing that skips Dean), returned, rejected, and approved requisitions
 * at every Procurement processing stage (ready / processing / completed),
 * including one that trips the ₦10,000,000 Governor-escalation flag.
 *
 * It does NOT create any Admin account — you said you already have those.
 *
 * WHERE TO PUT THIS FILE
 *   Copy this file to  <your-project-root>/scripts/seed.mjs
 *   (it imports your real constants files via a relative path, so the
 *   folder structure must match: scripts/ sitting next to src/).
 *
 * SETUP (one-time)
 *   npm install --save-dev dotenv
 *
 * RUN
 *   node scripts/seed.mjs             # add seed data (safe to re-run; see note below)
 *   node scripts/seed.mjs --reset     # delete only previously-seeded data, then re-seed
 *
 * IMPORTANT — RE-RUNNING WITHOUT --reset
 *   Every doc this script creates is tagged { seedTag: "ksu-seed-v1" }.
 *   Running WITHOUT --reset a second time will fail on duplicate emails
 *   (User.email has a unique index) instead of silently duplicating data.
 *   Use --reset to wipe and recreate cleanly. --reset only ever deletes
 *   documents carrying the seed tag, so your real Admin accounts and any
 *   data created through the app itself are never touched.
 *
 * LOGIN
 *   Every seeded user (Requester/HOD/Dean/Provost/VC/Procurement) shares
 *   the password printed at the bottom of this file's SEED_PASSWORD const.
 *   Every seeded account has accountStatus "active", so you can log in
 *   immediately without going through admin approval.
 */

import "dotenv/config";
import bcrypt from "bcryptjs";

import { collection, newObjectId, ensureSchema, closePool } from "../src/lib/orm.js";
import "../src/models/User.js";
import "../src/models/Requisition.js";
import "../src/models/Approval.js";
import "../src/models/AuditLog.js";
import "../src/models/Notification.js";

import { COLLEGES } from "../src/constants/colleges.js";
import { ROLES } from "../src/constants/roles.js";
import { PROCUREMENT_POSITIONS } from "../src/constants/procurement.js";
import { REQUISITION_STATUS, APPROVAL_ACTIONS } from "../src/constants/requisitionOptions.js";

const SEED_TAG = "ksu-seed-v1";
const SEED_PASSWORD = "KasuSeed#2026";
const NA = "N/A";
const RESET = process.argv.includes("--reset");

const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

async function main() {
  if (!process.env.DATABASE_URL && !process.env.MYSQL_HOST) {
    throw new Error(
      "Missing database settings. Put DATABASE_URL (or MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE) in .env in the project root — this script loads it with dotenv."
    );
  }

  await ensureSchema();
  const db = { collection };
  const usersCol = db.collection("users");
  const requisitionsCol = db.collection("requisitions");
  const approvalsCol = db.collection("approvals");
  const auditLogsCol = db.collection("auditlogs");

  console.log(`Connected. Reset mode: ${RESET ? "ON (wiping previous seed data)" : "OFF"}`);

  if (RESET) {
    const results = await Promise.all([
      usersCol.deleteMany({ seedTag: SEED_TAG }),
      requisitionsCol.deleteMany({ seedTag: SEED_TAG }),
      approvalsCol.deleteMany({ seedTag: SEED_TAG }),
      auditLogsCol.deleteMany({ seedTag: SEED_TAG }),
    ]);
    console.log(
      `Cleared previous seed data: ${results[0].deletedCount} users, ${results[1].deletedCount} requisitions, ${results[2].deletedCount} approvals, ${results[3].deletedCount} audit logs.`
    );
  }

  const now = new Date();
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
  const userDocs = [];
  // Lookup table so requisition-building code can find "the HOD of
  // Computer Science" etc. without re-querying the DB.
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

  // -------------------------------------------------------------------
  // VC (university-wide, final approval authority)
  // -------------------------------------------------------------------
  const vc = makeUser({
    fullName: "Prof. Amina Bello (Vice Chancellor)",
    email: "vc@ksu-test.edu.ng",
    role: ROLES.VC,
  });

  // -------------------------------------------------------------------
  // Procurement Directorate bench (university-wide)
  // Director is picked first for the pre-VC "procurement_review" stage;
  // Principal/Senior + Officer I/II are eligible for the post-VC
  // "processing" stage once the Director assigns it to them.
  // -------------------------------------------------------------------
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
  const procOfficerI_B = makeUser({
    fullName: "Zainab Aliyu (Procurement Officer I)",
    email: "procurement.officer1b@ksu-test.edu.ng",
    role: ROLES.PROCUREMENT,
    procurementPosition: PROCUREMENT_POSITIONS.PROCUREMENT_OFFICER_I,
  });
  const procOfficerII_A = makeUser({
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

  // -------------------------------------------------------------------
  // Full KASU org tree: 1 Provost per college, 1 Dean per faculty,
  // 1 HOD + 1 Requester per department — covers all 8 colleges so the
  // approval-chain resolver never fails to find an approver, anywhere.
  // -------------------------------------------------------------------
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

  console.log(`Prepared ${userDocs.length} users covering all ${COLLEGES.length} colleges.`);

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

  // Builds the approval/processing chain the same way lib/routing.js does:
  // standard colleges route HOD -> Dean -> Provost -> Procurement(review)
  // -> VC; postgraduate/basicStudies colleges skip Dean. Procurement
  // always gets a second, post-VC "processing" step appended.
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
      else if (role === ROLES.PROCUREMENT) approver = procDirector; // Director receives intake first
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

  // Hero org units used across the sample requisitions
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

  // ---------------------------------------------------------------
  // 1) DRAFT — not yet submitted
  // ---------------------------------------------------------------
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

  // ---------------------------------------------------------------
  // 2) PENDING — awaiting HOD (step 0)
  // ---------------------------------------------------------------
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

  // ---------------------------------------------------------------
  // 3) PENDING — HOD approved, now awaiting Dean (step 1)
  // ---------------------------------------------------------------
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

  // ---------------------------------------------------------------
  // 4) PENDING — postgraduate routing (no Dean step): HOD approved,
  //    now awaiting Provost (step 1, since Dean is skipped entirely)
  // ---------------------------------------------------------------
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
    r.currentStepIndex = 1; // HOD -> [Provost] -> Procurement(review) -> VC -> Procurement(processing)
    r.submittedAt = now;
    requisitionDocs.push(r);
    addAudit({ actor: pgRequester, action: "requisition.submit", entityId: r._id, details: { toStepIndex: 0 } });
    addApproval({ requisition: r, stepIndex: 0, role: ROLES.HOD, approver: pgHod, action: APPROVAL_ACTIONS.APPROVE });
    addAudit({ actor: pgHod, action: "requisition.approve", entityId: r._id, details: { stepIndex: 1, role: ROLES.HOD } });
  }

  // ---------------------------------------------------------------
  // 5) RETURNED — Dean returned it for clarification, back to HOD (step 0)
  // ---------------------------------------------------------------
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
    r.currentStepIndex = 0; // step 1 (Dean) returned -> steps back to step 0 (HOD)
    r.awaitingRequesterAction = false;
    r.submittedAt = now;
    r.comments.push({
      author: csDean._id,
      message: "Please clarify whether this is for the main seminar room or the annex — quantity seems high for the annex alone.",
      createdAt: now,
    });
    requisitionDocs.push(r);
    addAudit({ actor: csRequester, action: "requisition.submit", entityId: r._id, details: { toStepIndex: 0 } });
    addApproval({ requisition: r, stepIndex: 0, role: ROLES.HOD, approver: csHod, action: APPROVAL_ACTIONS.APPROVE });
    addApproval({
      requisition: r,
      stepIndex: 1,
      role: ROLES.DEAN,
      approver: csDean,
      action: APPROVAL_ACTIONS.RETURN,
      comment: "Please clarify whether this is for the main seminar room or the annex — quantity seems high for the annex alone.",
    });
    addAudit({ actor: csDean, action: "requisition.return", entityId: r._id, details: { comment: "Clarification requested on room/quantity." } });
  }

 
  // ---------------------------------------------------------------
  // 6) REJECTED — Dean issued a final rejection
  // ---------------------------------------------------------------
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
    r.comments.push({
      author: chain[1].approver,
      message: "Vehicle acquisitions of this scale must go through the central Transport Unit, not a departmental requisition.",
      createdAt: now,
    });
    requisitionDocs.push(r);
    addAudit({ actor: humRequester, action: "requisition.submit", entityId: r._id, details: { toStepIndex: 0 } });
    addApproval({ requisition: r, stepIndex: 0, role: ROLES.HOD, approver: humHod, action: APPROVAL_ACTIONS.APPROVE });
    const dean = orgIndex[`dean:${humCollege.id}:${humFacultyId}`];
    addApproval({
      requisition: r,
      stepIndex: 1,
      role: ROLES.DEAN,
      approver: dean,
      action: APPROVAL_ACTIONS.REJECT,
      comment: "Vehicle acquisitions of this scale must go through the central Transport Unit, not a departmental requisition.",
    });
    addAudit({ actor: dean, action: "requisition.reject", entityId: r._id, details: { isFinal: true } });
  }

  // ---------------------------------------------------------------
  // 7) APPROVED — VC just approved; Procurement status "ready"
  //    (Director received it, not yet assigned to an officer)
  // ---------------------------------------------------------------
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
    // Procurement market-survey stage: Director reviewed and forwarded to VC
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

  // ---------------------------------------------------------------
  // 8) APPROVED — Procurement status "processing"
  //    (Director assigned it to Procurement Officer I; work started)
  // ---------------------------------------------------------------
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
    // Director's own procurement_review step keeps him as approver there;
    // only the processing step (post-VC) is reassigned, mirroring
    // assignProcurementOfficer's actual behavior of retargeting both.
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

  // ---------------------------------------------------------------
  // 9) APPROVED — Procurement status "completed"
  //    (postgraduate routing, fully processed end-to-end)
  // ---------------------------------------------------------------
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
 
  // ---------------------------------------------------------------
  // 10) APPROVED, escalated — exceeds the ₦10,000,000 Governor threshold
  //     Procurement status "ready"
  // ---------------------------------------------------------------
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
    // requiresGovernorApproval is already computed by newRequisition() since
    // estimatedCost (150 * 480,000 + 3,000,000 = 75,000,000) exceeds 10,000,000.
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
  // INSERT
  // =====================================================================
  if (userDocs.length) await usersCol.insertMany(userDocs);
  if (requisitionDocs.length) await requisitionsCol.insertMany(requisitionDocs);
  if (approvalDocs.length) await approvalsCol.insertMany(approvalDocs);
  if (auditLogDocs.length) await auditLogsCol.insertMany(auditLogDocs);

  console.log("\nSeed complete.");
  console.log(`  Users:        ${userDocs.length} (across ${COLLEGES.length} colleges)`);
  console.log(`  Requisitions: ${requisitionDocs.length}`);
  console.log(`  Approvals:    ${approvalDocs.length}`);
  console.log(`  Audit logs:   ${auditLogDocs.length}`);
  console.log(`\nAll seeded users share the password: ${SEED_PASSWORD}`);
  console.log("Handy logins to try:");
  console.log(`  Requester (Computer Science): ${csRequester.email}`);
  console.log(`  HOD (Computer Science):       ${csHod.email}`);
  console.log(`  Dean (Faculty of Computing):  ${csDean.email}`);
  console.log(`  VC:                           ${vc.email}`);
  console.log(`  Procurement Director:         ${procDirector.email}`);

  await closePool();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});