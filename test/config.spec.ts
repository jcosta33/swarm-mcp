import { describe, it, expect } from "vitest";

import { parse_config } from "../src/index.ts";

describe("parse_config", () => {
  it("defaults to cwd + `suspec` on PATH", () => {
    const c = parse_config([], {}, "/ws");
    expect(c.bin).toBe("suspec");
    expect(c.root).toContain("ws");
  });

  it("reads workspace + bin from the environment", () => {
    const c = parse_config(
      [],
      { SUSPEC_WORKSPACE: "/env-ws", SUSPEC_BIN: "/bin/suspec" },
      "/cwd",
    );
    expect(c.bin).toBe("/bin/suspec");
    expect(c.root).toContain("env-ws");
  });

  it("lets flags override the environment", () => {
    const c = parse_config(
      ["--workspace", "/flag-ws", "--suspec-bin", "/flag-bin"],
      { SUSPEC_WORKSPACE: "/env-ws" },
      "/cwd",
    );
    expect(c.bin).toBe("/flag-bin");
    expect(c.root).toContain("flag-ws");
  });

  it("treats a flag-shaped value as missing (does not consume --suspec-bin as the workspace)", () => {
    const c = parse_config(["--workspace", "--suspec-bin", "/b"], {}, "/cwd");
    expect(c.bin).toBe("/b"); // --suspec-bin was NOT swallowed as the --workspace value
    expect(c.root).toContain("cwd"); // --workspace got no value → stays the cwd default
  });
});
