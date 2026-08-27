import { describe, expect, test } from "vitest";
import { createPaseoWorkspaceQuery, parsePaseoWorkspaceQuery } from "./uri-query";

describe("Paseo workspace URI query", () => {
  test("round-trips a case-sensitive daemon id without using URI authority", () => {
    const query = createPaseoWorkspaceQuery({
      serverId: "srv_PRLMLdH1RqFa",
      workspaceId: "wks_f8946842b147ae3c",
      rootSegments: 4,
    });
    expect(parsePaseoWorkspaceQuery(query)).toEqual({
      serverId: "srv_PRLMLdH1RqFa",
      workspaceId: "wks_f8946842b147ae3c",
      rootSegments: "4",
    });
  });
});
