import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DATA_ORIGINS, dataOriginCheck, sharedColumns } from "../lib/db/columns.ts";

describe("db/columns — shared column convention (architecture.md §3)", () => {
  it("defines exactly the three allowed data_origin literals", () => {
    assert.deepEqual(DATA_ORIGINS, ["seed", "demo", "agent"]);
  });

  it("carries data_origin, created_at and updated_at", () => {
    assert.deepEqual(Object.keys(sharedColumns).sort(), [
      "createdAt",
      "dataOrigin",
      "updatedAt",
    ]);
    assert.equal(sharedColumns.dataOrigin.config.name, "data_origin");
    assert.equal(sharedColumns.createdAt.config.name, "created_at");
    assert.equal(sharedColumns.updatedAt.config.name, "updated_at");
  });

  it("constrains data_origin to the typed enum and NOT NULL", () => {
    assert.deepEqual(sharedColumns.dataOrigin.config.enumValues, DATA_ORIGINS);
    assert.equal(sharedColumns.dataOrigin.config.notNull, true);
    assert.equal(sharedColumns.createdAt.config.notNull, true);
    assert.equal(sharedColumns.updatedAt.config.notNull, true);
  });

  it("exports a CHECK constraint over the three literals", () => {
    assert.equal(dataOriginCheck.name, "data_origin_check");
    const sql = dataOriginCheck.value.queryChunks
      .map((chunk) => chunk.value)
      .flat()
      .join("");
    assert.match(sql, /data_origin in \('seed', 'demo', 'agent'\)/);
  });
});
