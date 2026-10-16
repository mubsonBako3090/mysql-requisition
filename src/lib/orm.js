/*
 * --------------------------------------------------------------------------
 * MySQL data layer
 * --------------------------------------------------------------------------
 *
 * A small, dependency-light layer on top of `mysql2` that keeps the query
 * style the rest of the project already uses (Model.find / findById / create /
 * countDocuments / populate / lean / save ...), so routes and services do not
 * need to be rewritten.
 *
 * Storage rules
 *   - Every scalar field is a real, typed MySQL column.
 *   - Nested data (items, approvalChain, comments, attachments, ...) is stored
 *     in JSON columns.
 *   - Ids are 24-character hex strings (same shape as the old ObjectIds), so
 *     references stored inside JSON columns stay valid strings.
 *
 * This file deliberately has no import-time dependency on `mysql2`, so the
 * schema can be generated without the driver installed.
 */

import crypto from "crypto";

/* ------------------------------------------------------------------ ids */

const ID_RE = /^[a-f0-9]{24}$/i;

export function newObjectId() {
  return crypto.randomBytes(12).toString("hex");
}

export function isValidObjectId(value) {
  if (value == null) return false;
  if (typeof value === "string") return ID_RE.test(value);
  if (typeof value === "object" && value._id != null) {
    return ID_RE.test(String(value._id));
  }
  return false;
}

/** Turns an id, a populated document, or anything id-like into a plain id string. */
export function toId(value) {
  if (value == null) return null;
  if (typeof value === "object" && value._id != null) return String(value._id);
  return String(value);
}

/* ----------------------------------------------------------------- pool */

let injectedPool = null;

/** Test hook: lets tests supply a fake pool instead of a real connection. */
export function __setPool(pool) {
  injectedPool = pool;
}

function buildPoolConfig() {
  const url = process.env.DATABASE_URL;
  const base = {
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_POOL_SIZE || 10),
    charset: "utf8mb4",
    timezone: "Z",
    decimalNumbers: true,
    // Report matched rows (not only changed rows) from UPDATE statements.
    flags: ["+FOUND_ROWS"],
  };

  if (process.env.MYSQL_SSL === "true") {
    base.ssl = { rejectUnauthorized: true };
  }

  if (url) return { ...base, uri: url };

  if (!process.env.MYSQL_HOST || !process.env.MYSQL_DATABASE) {
    throw new Error(
      "Missing database configuration. Set DATABASE_URL, or MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD and MYSQL_DATABASE."
    );
  }

  return {
    ...base,
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  };
}

async function getPool() {
  if (injectedPool) return injectedPool;

  if (!global._mysqlPool) {
    global._mysqlPool = (async () => {
      const mod = await import("mysql2/promise");
      const createPool = mod.createPool || mod.default.createPool;
      return createPool(buildPoolConfig());
    })();
  }

  return global._mysqlPool;
}

export async function closePool() {
  if (injectedPool) return;
  if (global._mysqlPool) {
    const pool = await global._mysqlPool;
    global._mysqlPool = null;
    await pool.end();
  }
}

async function run(sql, params = []) {
  const pool = await getPool();
  try {
    const [result] = await pool.query(sql, params);
    return result;
  } catch (error) {
    // Keep the duplicate-key code the old driver exposed.
    if (error && (error.code === "ER_DUP_ENTRY" || error.errno === 1062)) {
      error.code = 11000;
    }
    throw error;
  }
}

/* ------------------------------------------------------------- registry */

const registry = new Map();
const byCollection = new Map();

/* ------------------------------------------------------- field helpers */

function cloneDefault(value) {
  if (value == null || typeof value !== "object") return value;
  if (value instanceof Date) return new Date(value.getTime());
  return JSON.parse(JSON.stringify(value));
}

function fieldSpec(model, key) {
  if (model.fields[key]) return model.fields[key];
  if (model.timestamps && (key === "createdAt" || key === "updatedAt")) {
    return { type: "date" };
  }
  if (key === "_id" || key === "id") return { type: "id" };
  return null;
}

function colExpr(model, key) {
  if (key === "_id" || key === "id") return "`id`";
  if (model.fields[key]) return `\`${key}\``;
  if (model.timestamps && (key === "createdAt" || key === "updatedAt")) {
    return `\`${key}\``;
  }
  return null; // unknown field: behaves like an always-missing value
}

function assertSafeKey(key) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`Unsafe field name in query: ${key}`);
  }
}

/** Converts a query value to what the column stores. */
function normalizeValue(spec, value) {
  if (value instanceof Date) return value;
  if (value != null && typeof value === "object" && value._id != null) {
    return String(value._id);
  }
  if (!spec) return value;
  if (spec.type === "bool") return value ? 1 : 0;
  if (spec.type === "date") return new Date(value);
  if (spec.type === "id") return toId(value);
  return value;
}

function isOperatorObject(value) {
  return (
    value != null &&
    typeof value === "object" &&
    !(value instanceof Date) &&
    !(value instanceof RegExp) &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0 &&
    Object.keys(value).every((key) => key.startsWith("$"))
  );
}

/* ------------------------------------------------- filter -> SQL WHERE */

function regexCond(col, source, flags, params) {
  params.push(source);
  return `REGEXP_LIKE(${col}, ?, '${flags && flags.includes("i") ? "i" : "c"}')`;
}

function scalarCond(model, key, value, params) {
  const spec = fieldSpec(model, key);
  const col = colExpr(model, key) || "NULL";

  if (value === undefined || value === null) return `${col} IS NULL`;

  if (value instanceof RegExp) {
    return regexCond(col, value.source, value.flags, params);
  }

  if (isOperatorObject(value)) {
    const parts = [];
    let regexFlags = value.$options || "";

    for (const [op, arg] of Object.entries(value)) {
      switch (op) {
        case "$eq":
          parts.push(scalarCond(model, key, arg, params));
          break;
        case "$ne":
          if (arg == null) {
            parts.push(`${col} IS NOT NULL`);
          } else {
            params.push(normalizeValue(spec, arg));
            parts.push(`(${col} <> ? OR ${col} IS NULL)`);
          }
          break;
        case "$in": {
          const list = (arg || []).map((x) => normalizeValue(spec, x));
          const nonNull = list.filter((x) => x != null);
          const hasNull = list.length !== nonNull.length;
          const pieces = [];
          if (nonNull.length) {
            params.push(nonNull);
            pieces.push(`${col} IN (?)`);
          }
          if (hasNull) pieces.push(`${col} IS NULL`);
          parts.push(pieces.length ? `(${pieces.join(" OR ")})` : "0=1");
          break;
        }
        case "$nin": {
          const list = (arg || [])
            .map((x) => normalizeValue(spec, x))
            .filter((x) => x != null);
          if (list.length) {
            params.push(list);
            parts.push(`(${col} NOT IN (?) OR ${col} IS NULL)`);
          } else {
            parts.push("1=1");
          }
          break;
        }
        case "$gt":
        case "$gte":
        case "$lt":
        case "$lte": {
          const sym = { $gt: ">", $gte: ">=", $lt: "<", $lte: "<=" }[op];
          params.push(normalizeValue(spec, arg));
          parts.push(`${col} ${sym} ?`);
          break;
        }
        case "$exists":
          parts.push(arg ? `${col} IS NOT NULL` : `${col} IS NULL`);
          break;
        case "$regex": {
          const source = arg instanceof RegExp ? arg.source : String(arg);
          const flags = arg instanceof RegExp ? arg.flags : regexFlags;
          parts.push(regexCond(col, source, flags, params));
          break;
        }
        case "$options":
          break;
        default:
          throw new Error(`Unsupported query operator ${op} on "${key}"`);
      }
    }

    return parts.length ? parts.join(" AND ") : "1=1";
  }

  params.push(normalizeValue(spec, value));
  return `${col} = ?`;
}

/** SQL fragment for a value placed inside JSON_OBJECT(...). */
function jsonLiteral(value, params) {
  if (value === true) return "TRUE";
  if (value === false) return "FALSE";
  if (value == null) return "NULL";
  params.push(typeof value === "object" && value._id != null ? String(value._id) : value);
  return "?";
}

function jsonObjectExpr(pairs, params) {
  const pieces = pairs.map(([k, v]) => {
    assertSafeKey(k);
    return `'${k}', ${jsonLiteral(v, params)}`;
  });
  return `JSON_OBJECT(${pieces.join(", ")})`;
}

function jsonCond(model, root, rest, value, params) {
  const col = `\`${root}\``;

  // field.sub  ->  some element of the array has sub = value
  if (rest.length) {
    if (rest.length > 1) {
      throw new Error(`Query path too deep for JSON column: ${root}.${rest.join(".")}`);
    }
    const sub = rest[0];

    if (value instanceof RegExp || (isOperatorObject(value) && !("$in" in value) && !("$eq" in value))) {
      throw new Error(`Unsupported query on JSON path ${root}.${sub}`);
    }

    if (isOperatorObject(value) && "$in" in value) {
      const list = value.$in || [];
      if (!list.length) return "0=1";
      return (
        "(" +
        list
          .map((x) => `JSON_CONTAINS(${col}, ${jsonObjectExpr([[sub, x]], params)})`)
          .join(" OR ") +
        ")"
      );
    }

    const target = isOperatorObject(value) ? value.$eq : value;
    return `JSON_CONTAINS(${col}, ${jsonObjectExpr([[sub, target]], params)})`;
  }

  // field itself
  if (value != null && typeof value === "object" && "$elemMatch" in value) {
    const spec = value.$elemMatch || {};
    const pairs = Object.entries(spec);
    for (const [, v] of pairs) {
      if (isOperatorObject(v) || v instanceof RegExp) {
        throw new Error("$elemMatch with operators is not supported on JSON columns");
      }
    }
    return `JSON_CONTAINS(${col}, ${jsonObjectExpr(pairs, params)})`;
  }

  if (isOperatorObject(value) && "$exists" in value) {
    return value.$exists ? `${col} IS NOT NULL` : `${col} IS NULL`;
  }

  if (isOperatorObject(value) && "$in" in value) {
    const list = value.$in || [];
    if (!list.length) return "0=1";
    return (
      "(" +
      list
        .map((x) => {
          params.push(toId(x));
          return `JSON_CONTAINS(${col}, JSON_QUOTE(?))`;
        })
        .join(" OR ") +
      ")"
    );
  }

  if (value == null) return `${col} IS NULL`;

  // array membership: { sourceRequisitions: someId }
  params.push(toId(value));
  return `JSON_CONTAINS(${col}, JSON_QUOTE(?))`;
}

function fieldCond(model, key, value, params) {
  assertSafeKey(key.split(".")[0]);
  const [root, ...rest] = key.split(".");
  const spec = model.fields[root];

  if (spec && spec.type === "json") {
    return jsonCond(model, root, rest, value, params);
  }

  if (rest.length) {
    throw new Error(`Dotted query path on non-JSON field: ${key}`);
  }

  return scalarCond(model, root, value, params);
}

function buildWhere(model, filter, params) {
  const parts = [];

  for (const [key, value] of Object.entries(filter || {})) {
    if (key === "$or") {
      const list = value || [];
      parts.push(
        list.length
          ? "(" + list.map((f) => `(${buildWhere(model, f, params) || "1=1"})`).join(" OR ") + ")"
          : "0=1"
      );
    } else if (key === "$and") {
      const list = value || [];
      parts.push(
        list.length
          ? "(" + list.map((f) => `(${buildWhere(model, f, params) || "1=1"})`).join(" AND ") + ")"
          : "1=1"
      );
    } else if (key === "$nor") {
      const list = value || [];
      parts.push(
        list.length
          ? "NOT (" + list.map((f) => `(${buildWhere(model, f, params) || "1=1"})`).join(" OR ") + ")"
          : "1=1"
      );
    } else if (key.startsWith("$")) {
      throw new Error(`Unsupported top-level query operator ${key}`);
    } else {
      parts.push(fieldCond(model, key, value, params));
    }
  }

  return parts.join(" AND ");
}

/* ---------------------------------------------- row <-> document mapping */

function depopId(value) {
  if (value != null && typeof value === "object" && value._id != null) {
    return String(value._id);
  }
  return value;
}

function depopJson(spec, value) {
  if (value == null) return value;

  const refKeys = spec.refs ? Object.keys(spec.refs) : [];

  const fixElement = (element) => {
    if (element == null || typeof element !== "object" || element instanceof Date) {
      return spec.ref ? depopId(element) : element;
    }
    if (!refKeys.length) return element;
    const copy = { ...element };
    for (const key of refKeys) {
      if (copy[key] != null) copy[key] = depopId(copy[key]);
    }
    return copy;
  };

  return Array.isArray(value) ? value.map(fixElement) : fixElement(value);
}

function reviveJsonDates(spec, value) {
  if (!spec.dates || value == null) return value;

  const fix = (element) => {
    if (element && typeof element === "object") {
      for (const key of spec.dates) {
        if (typeof element[key] === "string") element[key] = new Date(element[key]);
      }
    }
    return element;
  };

  return Array.isArray(value) ? value.map(fix) : fix(value);
}

function applyJsonItemDefaults(spec, value) {
  if (!spec.itemDefaults || !Array.isArray(value)) return;
  for (const element of value) {
    if (element && typeof element === "object") {
      for (const [key, def] of Object.entries(spec.itemDefaults)) {
        if (element[key] === undefined) {
          element[key] = typeof def === "function" ? def() : cloneDefault(def);
        }
      }
    }
  }
}

function docToRow(model, doc) {
  const row = { id: toId(doc._id) };

  for (const [name, spec] of Object.entries(model.fields)) {
    if (!Object.prototype.hasOwnProperty.call(doc, name)) continue;
    const value = doc[name];

    if (value === undefined || value === null) {
      row[name] = null;
      continue;
    }

    switch (spec.type) {
      case "id":
        row[name] = toId(value);
        break;
      case "bool":
        row[name] = value ? 1 : 0;
        break;
      case "date": {
        const date = value instanceof Date ? value : new Date(value);
        row[name] = Number.isNaN(date.getTime()) ? null : date;
        break;
      }
      case "json":
        row[name] = JSON.stringify(depopJson(spec, value));
        break;
      case "number":
      case "int":
      case "decimal":
        row[name] = Number(value);
        break;
      default:
        row[name] = String(value);
    }
  }

  if (model.timestamps) {
    if (doc.createdAt != null) row.createdAt = new Date(doc.createdAt);
    if (doc.updatedAt != null) row.updatedAt = new Date(doc.updatedAt);
  }

  return row;
}

function rowToPlain(model, row) {
  const out = { _id: row.id };

  for (const [name, spec] of Object.entries(model.fields)) {
    let value = row[name];

    if (value === null || value === undefined) {
      if (spec.type === "json" && spec.array) out[name] = [];
      else if (spec.keepNull) out[name] = null;
      continue;
    }

    switch (spec.type) {
      case "bool":
        value = Boolean(value);
        break;
      case "json":
        if (typeof value === "string") value = JSON.parse(value);
        value = reviveJsonDates(spec, value);
        break;
      case "number":
      case "int":
      case "decimal":
        value = Number(value);
        break;
      default:
        break;
    }

    out[name] = value;
  }

  if (model.timestamps) {
    out.createdAt = row.createdAt;
    out.updatedAt = row.updatedAt;
  }

  return out;
}

/* ------------------------------------------------- prepare + validation */

function prepareDoc(model, doc, { applyDefaults = true } = {}) {
  for (const [name, spec] of Object.entries(model.fields)) {
    let value = doc[name];

    if (value === undefined && applyDefaults && "default" in spec) {
      const def = typeof spec.default === "function" ? spec.default() : cloneDefault(spec.default);
      if (def !== undefined) {
        doc[name] = def;
        value = def;
      }
    }

    if (typeof value === "string") {
      let next = value;
      if (spec.trim) next = next.trim();
      if (spec.lowercase) next = next.toLowerCase();
      if (next !== value) doc[name] = next;
    }

    if (spec.type === "json" && value != null) {
      applyJsonItemDefaults(spec, value);
    }
  }
}

function validateDoc(model, doc, { onlyPresent = false } = {}) {
  const errors = {};

  for (const [name, spec] of Object.entries(model.fields)) {
    if (onlyPresent && !Object.prototype.hasOwnProperty.call(doc, name)) continue;
    const value = doc[name];
    const missing =
      value === undefined || value === null || (typeof value === "string" && value === "");

    const required =
      typeof spec.requiredIf === "function" ? spec.requiredIf(doc) : Boolean(spec.required);

    if (required && missing) {
      errors[name] = { message: `Path \`${name}\` is required.` };
      continue;
    }

    if (missing) continue;

    if (spec.enum && !spec.enum.includes(value)) {
      errors[name] = { message: `\`${value}\` is not a valid enum value for path \`${name}\`.` };
    }

    if (spec.maxlength && typeof value === "string" && value.length > spec.maxlength) {
      errors[name] = {
        message: `Path \`${name}\` is longer than the maximum allowed length (${spec.maxlength}).`,
      };
    }

    if (spec.min != null && typeof value === "number" && value < spec.min) {
      errors[name] = { message: `Path \`${name}\` must be at least ${spec.min}.` };
    }
  }

  if (Object.keys(errors).length) {
    const error = new Error(
      `${model.name} validation failed: ` +
        Object.values(errors)
          .map((e) => e.message)
          .join(", ")
    );
    error.name = "ValidationError";
    error.errors = errors;
    throw error;
  }
}

/* -------------------------------------------------------------- select */

function parseSelect(select) {
  if (!select) return null;

  const include = [];
  const exclude = [];

  if (typeof select === "string") {
    for (const token of select.split(/\s+/).filter(Boolean)) {
      if (token.startsWith("-")) exclude.push(token.slice(1));
      else include.push(token.replace(/^\+/, ""));
    }
  } else if (typeof select === "object") {
    for (const [key, flag] of Object.entries(select)) {
      if (flag) include.push(key);
      else exclude.push(key);
    }
  }

  return { include, exclude };
}

function applySelect(doc, parsed) {
  if (!doc || !parsed) return doc;

  if (parsed.include.length) {
    const keep = new Set(parsed.include);
    if (!parsed.exclude.includes("_id")) keep.add("_id");
    for (const key of Object.keys(doc)) {
      if (!keep.has(key)) delete doc[key];
    }
  }

  for (const key of parsed.exclude) delete doc[key];
  return doc;
}

/* ------------------------------------------------------------ populate */

function normalizePopulate(path, select, options) {
  if (Array.isArray(path)) return path.flatMap((p) => normalizePopulate(p));

  if (path && typeof path === "object") {
    const nested = path.populate
      ? [].concat(path.populate).flatMap((p) => normalizePopulate(p))
      : [];
    return [{ path: path.path, select: path.select, populate: nested }];
  }

  const nested =
    options && options.populate
      ? [].concat(options.populate).flatMap((p) => normalizePopulate(p))
      : [];

  return [{ path, select, populate: nested }];
}

function refModelName(model, path) {
  const [root, ...rest] = path.split(".");
  const spec = model.fields[root];
  if (!spec) return null;
  if (!rest.length) return spec.ref || null;
  return (spec.refs && spec.refs[rest.join(".")]) || null;
}

function eachLeaf(obj, segments, fn) {
  if (obj == null) return;
  const [head, ...tail] = segments;
  const value = obj[head];
  if (value == null) return;

  if (!tail.length) {
    fn(obj, head);
    return;
  }

  if (Array.isArray(value)) value.forEach((element) => eachLeaf(element, tail, fn));
  else eachLeaf(value, tail, fn);
}

async function populateDocs(model, docs, specs) {
  for (const spec of specs) {
    if (!spec.path) continue;

    const targetName = refModelName(model, spec.path);
    const target = targetName && registry.get(targetName);
    if (!target) continue;

    const segments = spec.path.split(".");
    const ids = new Set();

    for (const doc of docs) {
      eachLeaf(doc, segments, (parent, key) => {
        const value = parent[key];
        if (Array.isArray(value)) value.forEach((v) => v != null && ids.add(toId(v)));
        else ids.add(toId(value));
      });
    }

    if (!ids.size) continue;

    const parsed = parseSelect(spec.select);
    const fetched = await target.find({ _id: { $in: [...ids] } }).lean();

    if (spec.populate && spec.populate.length) {
      await populateDocs(target, fetched, spec.populate);
    }

    const byId = new Map(
      fetched.map((doc) => [String(doc._id), applySelect({ ...doc }, parsed)])
    );

    for (const doc of docs) {
      eachLeaf(doc, segments, (parent, key) => {
        const value = parent[key];
        if (Array.isArray(value)) {
          parent[key] = value
            .map((v) => (v == null ? null : byId.get(toId(v)) || null))
            .filter(Boolean);
        } else {
          parent[key] = byId.get(toId(value)) || null;
        }
      });
    }
  }
}

/* ---------------------------------------------------------- documents */

function makeDoc(model, plain, { partial = false } = {}) {
  const doc = plain;

  Object.defineProperties(doc, {
    id: {
      get() {
        return String(doc._id);
      },
      enumerable: false,
      configurable: true,
    },
    save: {
      value: async () => saveDoc(model, doc),
      enumerable: false,
      configurable: true,
      writable: true,
    },
    toObject: {
      value: () => structuredClone({ ...doc }),
      enumerable: false,
      configurable: true,
      writable: true,
    },
    populate: {
      value: async (path, select, match, options) => {
        await populateDocs(model, [doc], normalizePopulate(path, select, options));
        return doc;
      },
      enumerable: false,
      configurable: true,
      writable: true,
    },
    __partial: { value: partial, enumerable: false, configurable: true, writable: true },
  });

  return doc;
}

async function saveDoc(model, doc) {
  prepareDoc(model, doc, { applyDefaults: false });
  validateDoc(model, doc, { onlyPresent: true });

  if (model.timestamps) doc.updatedAt = new Date();

  const row = docToRow(model, doc);
  const columns = Object.keys(row).filter((c) => c !== "id");
  if (!columns.length) return doc;

  const sets = columns.map((c) => `\`${c}\` = ?`).join(", ");
  const params = columns.map((c) => row[c]);
  params.push(row.id);

  await run(`UPDATE \`${model.table}\` SET ${sets} WHERE \`id\` = ?`, params);
  return doc;
}

async function insertDocs(model, inputs, { raw = false } = {}) {
  const list = Array.isArray(inputs) ? inputs : [inputs];
  if (!list.length) return [];

  const now = new Date();
  const docs = list.map((input) => {
    const doc = { ...input };
    if (doc._id == null) doc._id = newObjectId();
    else doc._id = toId(doc._id);

    prepareDoc(model, doc);
    if (!raw) validateDoc(model, doc);

    if (model.timestamps) {
      if (doc.createdAt == null) doc.createdAt = now;
      if (doc.updatedAt == null) doc.updatedAt = now;
    }

    return doc;
  });

  const rows = docs.map((doc) => docToRow(model, doc));

  // Every row in one INSERT must list the same columns.
  const columns = ["id", ...Object.keys(model.fields)];
  if (model.timestamps) columns.push("createdAt", "updatedAt");

  const values = rows.map((row) => columns.map((c) => (row[c] === undefined ? null : row[c])));

  await run(
    `INSERT INTO \`${model.table}\` (${columns.map((c) => `\`${c}\``).join(", ")}) VALUES ?`,
    [values]
  );

  return docs.map((doc) => makeDoc(model, doc));
}

/* ------------------------------------------------------------- updates */

function buildUpdateSet(model, update, params) {
  const sets = [];
  const hasOperators = Object.keys(update).some((k) => k.startsWith("$"));
  const $set = hasOperators ? update.$set || {} : update;

  const setValue = (key, value) => {
    const spec = model.fields[key];
    if (!spec) return;
    assertSafeKey(key);

    if (value === undefined || value === null) {
      sets.push(`\`${key}\` = NULL`);
      return;
    }

    switch (spec.type) {
      case "id":
        params.push(toId(value));
        break;
      case "bool":
        params.push(value ? 1 : 0);
        break;
      case "date":
        params.push(value instanceof Date ? value : new Date(value));
        break;
      case "json":
        params.push(JSON.stringify(depopJson(spec, value)));
        break;
      case "number":
      case "int":
      case "decimal":
        params.push(Number(value));
        break;
      default:
        params.push(String(value));
    }
    sets.push(`\`${key}\` = ?`);
  };

  for (const [key, value] of Object.entries($set)) {
    if (key.includes(".")) throw new Error(`Dotted $set path is not supported: ${key}`);
    setValue(key, value);
  }

  if (hasOperators) {
    for (const key of Object.keys(update.$unset || {})) {
      if (model.fields[key]) {
        assertSafeKey(key);
        sets.push(`\`${key}\` = NULL`);
      }
    }

    for (const [key, value] of Object.entries(update.$push || {})) {
      const spec = model.fields[key];
      if (!spec || spec.type !== "json") {
        throw new Error(`$push is only supported on JSON array fields (got "${key}")`);
      }
      assertSafeKey(key);

      const item = { ...value };
      applyJsonItemDefaults({ itemDefaults: spec.itemDefaults }, [item]);
      params.push(JSON.stringify(depopJson({ ...spec, array: false }, item)));
      sets.push(
        `\`${key}\` = JSON_ARRAY_APPEND(COALESCE(\`${key}\`, JSON_ARRAY()), '$', JSON_EXTRACT(?, '$'))`
      );
    }
  }

  if (model.timestamps && !("updatedAt" in $set)) {
    sets.push("`updatedAt` = ?");
    params.push(new Date());
  }

  return sets.join(", ");
}

async function updateWhere(model, filter, update, { limitOne = false } = {}) {
  const params = [];
  const set = buildUpdateSet(model, update, params);
  const where = buildWhere(model, filter, params);

  let sql = `UPDATE \`${model.table}\` SET ${set}`;
  if (where) sql += ` WHERE ${where}`;
  if (limitOne) sql += " LIMIT 1";

  const result = await run(sql, params);
  const affected = Number(result.affectedRows || 0);

  return { acknowledged: true, matchedCount: affected, modifiedCount: affected };
}

/* --------------------------------------------------------------- query */

class Query {
  constructor(model, op, filter, extra = {}) {
    this.model = model;
    this.op = op;
    this.filter = filter || {};
    this.extra = extra;
    this._sort = null;
    this._select = null;
    this._limit = null;
    this._skip = null;
    this._lean = false;
    this._populate = [];
    this._promise = null;
  }

  select(select) {
    this._select = select;
    return this;
  }

  sort(sort) {
    this._sort = sort;
    return this;
  }

  limit(n) {
    this._limit = n;
    return this;
  }

  skip(n) {
    this._skip = n;
    return this;
  }

  lean(flag = true) {
    this._lean = flag !== false;
    return this;
  }

  populate(path, select, match, options) {
    this._populate.push(...normalizePopulate(path, select, options));
    return this;
  }

  session() {
    return this;
  }

  exec() {
    if (!this._promise) this._promise = this._run();
    return this._promise;
  }

  then(resolve, reject) {
    return this.exec().then(resolve, reject);
  }

  catch(reject) {
    return this.exec().catch(reject);
  }

  finally(fn) {
    return this.exec().finally(fn);
  }

  _orderBy() {
    if (!this._sort) return "";

    let entries;
    if (typeof this._sort === "string") {
      entries = this._sort
        .split(/\s+/)
        .filter(Boolean)
        .map((t) => (t.startsWith("-") ? [t.slice(1), -1] : [t, 1]));
    } else {
      entries = Object.entries(this._sort);
    }

    const parts = entries
      .map(([key, dir]) => {
        const col = colExpr(this.model, key);
        if (!col) return null;
        const desc = dir === -1 || dir === "desc" || dir === "descending";
        return `${col} ${desc ? "DESC" : "ASC"}`;
      })
      .filter(Boolean);

    return parts.length ? ` ORDER BY ${parts.join(", ")}` : "";
  }

  _limitClause(forceOne) {
    const limit = forceOne ? 1 : this._limit;
    const skip = this._skip;
    if (limit == null && !skip) return "";
    const l = limit == null ? "18446744073709551615" : String(Math.max(0, parseInt(limit, 10) || 0));
    const s = parseInt(skip, 10) || 0;
    return s ? ` LIMIT ${s}, ${l}` : ` LIMIT ${l}`;
  }

  async _fetchRows(forceOne) {
    const params = [];
    const where = buildWhere(this.model, this.filter, params);
    let sql = `SELECT * FROM \`${this.model.table}\``;
    if (where) sql += ` WHERE ${where}`;
    sql += this._orderBy();
    sql += this._limitClause(forceOne);
    return run(sql, params);
  }

  async _finish(rows) {
    const plains = rows.map((row) => rowToPlain(this.model, row));

    if (this._populate.length) {
      await populateDocs(this.model, plains, this._populate);
    }

    const parsed = parseSelect(this._select);
    const partial = Boolean(parsed && (parsed.include.length || parsed.exclude.length));

    return plains.map((plain) => {
      applySelect(plain, parsed);
      return this._lean ? plain : makeDoc(this.model, plain, { partial });
    });
  }

  async _run() {
    switch (this.op) {
      case "find":
        return this._finish(await this._fetchRows(false));

      case "findOne": {
        const docs = await this._finish(await this._fetchRows(true));
        return docs[0] || null;
      }

      case "exists": {
        const params = [];
        const where = buildWhere(this.model, this.filter, params);
        let sql = `SELECT \`id\` FROM \`${this.model.table}\``;
        if (where) sql += ` WHERE ${where}`;
        sql += " LIMIT 1";
        const rows = await run(sql, params);
        return rows.length ? { _id: rows[0].id } : null;
      }

      case "findOneAndUpdate": {
        const { update, options } = this.extra;
        const wantNew = Boolean(options && options.new);

        const params = [];
        const where = buildWhere(this.model, this.filter, params);
        let sql = `SELECT \`id\` FROM \`${this.model.table}\``;
        if (where) sql += ` WHERE ${where}`;
        sql += this._orderBy() + " LIMIT 1";

        const found = await run(sql, params);
        if (!found.length) return null;

        const id = found[0].id;
        const finder = new Query(this.model, "findOne", { _id: id });
        finder._select = this._select;
        finder._lean = this._lean;
        finder._populate = this._populate;

        let before = null;
        if (!wantNew) before = await finder._run();

        await updateWhere(this.model, { _id: id }, update, { limitOne: true });

        if (!wantNew) return before;

        const after = new Query(this.model, "findOne", { _id: id });
        after._select = this._select;
        after._lean = this._lean;
        after._populate = this._populate;
        return after._run();
      }

      default:
        throw new Error(`Unsupported query operation: ${this.op}`);
    }
  }
}

/* ---------------------------------------------------------- aggregate */

async function aggregate(model, pipeline) {
  const match = pipeline.find((stage) => stage.$match);
  const group = pipeline.find((stage) => stage.$group);

  if (!group || pipeline.some((s) => !s.$match && !s.$group)) {
    throw new Error("Only $match + $group pipelines are supported.");
  }

  const idExpr = group.$group._id;
  let groupCol = null;

  if (typeof idExpr === "string" && idExpr.startsWith("$")) {
    groupCol = colExpr(model, idExpr.slice(1)) || "NULL";
  } else if (idExpr !== null) {
    throw new Error("Unsupported $group _id expression.");
  }

  const selects = [`${groupCol || "NULL"} AS \`_id\``];

  for (const [name, spec] of Object.entries(group.$group)) {
    if (name === "_id") continue;
    assertSafeKey(name);

    if (spec.$sum === 1) {
      selects.push(`COUNT(*) AS \`${name}\``);
    } else if (typeof spec.$sum === "string" && spec.$sum.startsWith("$")) {
      const col = colExpr(model, spec.$sum.slice(1));
      selects.push(`COALESCE(SUM(${col || "NULL"}), 0) AS \`${name}\``);
    } else {
      throw new Error(`Unsupported accumulator for "${name}".`);
    }
  }

  const params = [];
  const where = match ? buildWhere(model, match.$match, params) : "";

  let sql = `SELECT ${selects.join(", ")} FROM \`${model.table}\``;
  if (where) sql += ` WHERE ${where}`;
  if (groupCol) sql += ` GROUP BY ${groupCol}`;

  const rows = await run(sql, params);

  return rows.map((row) => {
    const out = {};
    for (const [key, value] of Object.entries(row)) {
      out[key] = key === "_id" ? value : Number(value);
    }
    return out;
  });
}

/* ------------------------------------------------------ model factory */

export function defineModel(definition) {
  if (registry.has(definition.name)) return registry.get(definition.name);

  const model = {
    name: definition.name,
    table: definition.table,
    collection: definition.collection || definition.table,
    fields: definition.fields,
    timestamps: definition.timestamps !== false,
    indexes: definition.indexes || [],
  };

  model.find = (filter = {}) => new Query(model, "find", filter);
  model.findOne = (filter = {}) => new Query(model, "findOne", filter);
  model.findById = (id) => new Query(model, "findOne", { _id: id });
  model.exists = (filter = {}) => new Query(model, "exists", filter);

  model.findOneAndUpdate = (filter, update, options = {}) =>
    new Query(model, "findOneAndUpdate", filter, { update, options });

  model.findByIdAndUpdate = (id, update, options = {}) =>
    new Query(model, "findOneAndUpdate", { _id: id }, { update, options });

  model.create = async (input) => {
    const docs = await insertDocs(model, input);
    return Array.isArray(input) ? docs : docs[0];
  };

  model.insertMany = (inputs) => insertDocs(model, inputs);

  model.countDocuments = async (filter = {}) => {
    const params = [];
    const where = buildWhere(model, filter, params);
    let sql = `SELECT COUNT(*) AS \`c\` FROM \`${model.table}\``;
    if (where) sql += ` WHERE ${where}`;
    const rows = await run(sql, params);
    return Number(rows[0].c);
  };

  model.updateOne = (filter, update) => updateWhere(model, filter, update, { limitOne: true });
  model.updateMany = (filter, update) => updateWhere(model, filter, update);

  model.deleteMany = async (filter = {}) => {
    const params = [];
    const where = buildWhere(model, filter, params);
    let sql = `DELETE FROM \`${model.table}\``;
    if (where) sql += ` WHERE ${where}`;
    const result = await run(sql, params);
    return { acknowledged: true, deletedCount: Number(result.affectedRows || 0) };
  };

  model.deleteOne = async (filter = {}) => {
    const params = [];
    const where = buildWhere(model, filter, params);
    let sql = `DELETE FROM \`${model.table}\``;
    if (where) sql += ` WHERE ${where}`;
    sql += " LIMIT 1";
    const result = await run(sql, params);
    return { acknowledged: true, deletedCount: Number(result.affectedRows || 0) };
  };

  model.bulkWrite = async (operations) => {
    let modifiedCount = 0;
    for (const op of operations) {
      if (op.updateOne) {
        const r = await model.updateOne(op.updateOne.filter, op.updateOne.update);
        modifiedCount += r.modifiedCount;
      } else if (op.updateMany) {
        const r = await model.updateMany(op.updateMany.filter, op.updateMany.update);
        modifiedCount += r.modifiedCount;
      } else if (op.deleteOne) {
        await model.deleteOne(op.deleteOne.filter);
      } else if (op.insertOne) {
        await model.create(op.insertOne.document);
      } else {
        throw new Error("Unsupported bulkWrite operation.");
      }
    }
    return { acknowledged: true, modifiedCount };
  };

  model.aggregate = (pipeline) => aggregate(model, pipeline);

  registry.set(model.name, model);
  byCollection.set(model.collection, model);
  return model;
}

/**
 * Raw collection-style access used by the seed scripts. Documents are written
 * as given (no validation), so seeded timestamps and ids are preserved.
 */
export function collection(name) {
  const model = byCollection.get(name);
  if (!model) throw new Error(`Unknown collection: ${name}. Import its model first.`);

  return {
    insertMany: (docs) => insertDocs(model, docs, { raw: true }),
    insertOne: (doc) => insertDocs(model, doc, { raw: true }),
    deleteMany: (filter) => model.deleteMany(filter),
    countDocuments: (filter) => model.countDocuments(filter),
  };
}

/* ------------------------------------------------------------- schema */

function columnType(spec) {
  switch (spec.type) {
    case "id":
      return "CHAR(24)";
    case "string":
      return `VARCHAR(${spec.maxlength || 255})`;
    case "text":
      return "TEXT";
    case "number":
      return "DOUBLE";
    case "int":
      return "INT";
    case "decimal":
      return "DECIMAL(18,2)";
    case "bool":
      return "TINYINT(1)";
    case "date":
      return "DATETIME(3)";
    case "json":
      return "JSON";
    default:
      throw new Error(`Unknown field type: ${spec.type}`);
  }
}

function sqlDefault(spec) {
  if (!("default" in spec) || typeof spec.default === "function") return "";
  const d = spec.default;
  if (d === null || d === undefined) return "";
  if (spec.type === "bool") return ` DEFAULT ${d ? 1 : 0}`;
  if (spec.type === "number" || spec.type === "int" || spec.type === "decimal") {
    return ` DEFAULT ${Number(d)}`;
  }
  if (spec.type === "string") return ` DEFAULT '${String(d).replace(/'/g, "''")}'`;
  return "";
}

export function createTableSQL(model) {
  const lines = ["  `id` CHAR(24) NOT NULL"];

  for (const [name, spec] of Object.entries(model.fields)) {
    const notNull =
      spec.type === "bool" ||
      ((spec.type === "int" || spec.type === "decimal") && "default" in spec) ||
      (spec.required && typeof spec.requiredIf !== "function" && spec.type !== "json");

    lines.push(
      `  \`${name}\` ${columnType(spec)} ${notNull ? "NOT NULL" : "NULL"}${sqlDefault(spec)}`
    );
  }

  if (model.timestamps) {
    lines.push("  `createdAt` DATETIME(3) NOT NULL");
    lines.push("  `updatedAt` DATETIME(3) NOT NULL");
  }

  lines.push("  PRIMARY KEY (`id`)");

  for (const index of model.indexes) {
    const cols = index.columns.map((c) => `\`${c}\``).join(", ");
    const name = `${index.unique ? "uq" : "idx"}_${model.table}_${index.columns.join("_")}`.slice(0, 64);
    lines.push(`  ${index.unique ? "UNIQUE " : ""}KEY \`${name}\` (${cols})`);
  }

  return (
    `CREATE TABLE IF NOT EXISTS \`${model.table}\` (\n${lines.join(",\n")}\n` +
    `) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`
  );
}

export function schemaSQL() {
  return [...registry.values()].map(createTableSQL).join("\n\n") + "\n";
}

export async function ensureSchema() {
  if (process.env.MYSQL_AUTO_MIGRATE === "false") return;
  for (const model of registry.values()) {
    await run(createTableSQL(model));
  }
}
