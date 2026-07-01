// v0 resources — the application-driven context surface. Fixed URIs for the workspace board + the
// checks contract; templated URIs for individual artifacts (parsed via the `suspec show` loaders, the
// same data the get_* tools expose). All read-only; every templated id is validated before any
// subprocess. Findings have no parser, so they are served as raw markdown, labelled.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";

import { invoke_suspec, type SuspecResult } from "./suspec/invoke.ts";
import { confine_path, is_safe_segment, task_stem } from "./roots.ts";
import type { Ctx } from "./tools.ts";

const JSON_MIME = "application/json";

// Render a SuspecResult's payload as the resource body (the CLI data, or the structured error).
function body_of(result: SuspecResult): string {
  if (result.kind === "ok") {
    return JSON.stringify(result.data, null, 2);
  }
  if (result.kind === "structured-error") {
    return JSON.stringify(result.error, null, 2);
  }
  return JSON.stringify({ error: "adapter", message: result.message }, null, 2);
}

export function register_resources(server: McpServer, ctx: Ctx): void {
  server.registerResource(
    "workspace",
    "suspec://workspace",
    {
      title: "Suspec workspace",
      description: "Workspace root, mode, and the current board summary.",
      mimeType: JSON_MIME,
    },
    (uri) => {
      const status = invoke_suspec(ctx.env, "status");
      const board = status.kind === "ok" ? status.data : null;
      const text = JSON.stringify(
        {
          workspaceRoot: ctx.root,
          // The real surface: read + reconcile tools, plus the safe-write scaffold tier
          // (suspec_scaffold_spec / suspec_split_task / suspec_scaffold_finding). Never a verdict.
          mode: "read+reconcile+scaffold, no verdict",
          noVerdictIssued: true,
          board,
        },
        null,
        2,
      );
      return { contents: [{ uri: uri.href, mimeType: JSON_MIME, text }] };
    },
  );

  server.registerResource(
    "status",
    "suspec://status",
    {
      title: "Suspec board",
      description: "The derived workspace board — specs, tasks, reviews, gaps.",
      mimeType: JSON_MIME,
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: JSON_MIME,
          text: body_of(invoke_suspec(ctx.env, "status")),
        },
      ],
    }),
  );

  server.registerResource(
    "checks",
    "suspec://checks",
    {
      title: "Checks contract",
      description: "The checks contract — version + the core checks.",
      mimeType: JSON_MIME,
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: JSON_MIME,
          text: body_of(invoke_suspec(ctx.env, "show", ["checks"])),
        },
      ],
    }),
  );

  // Templated artifact resources — the {id} is validated before the subprocess; an invalid id yields a
  // labelled error body rather than a thrown read. The task id passes VERBATIM (the CLI's own resolver
  // tries the id, TASK-<slug>, and <slug> — pre-normalizing here would lowercase a mixed-case id the
  // tool path resolves fine, exactly the mismatch suspec_get_task's comment warns about); the review id
  // keeps the stem normalization because the lowercase review_slug IS the CLI's file key.
  const artifact_resource = (
    name: string,
    template: string,
    kind: "task" | "review",
    to_key: (id: string) => string,
  ): void => {
    server.registerResource(
      name,
      new ResourceTemplate(template, { list: undefined }),
      { title: name, mimeType: JSON_MIME },
      (uri, variables) => {
        const key = to_key(String(variables.id));
        const text = is_safe_segment(key)
          ? body_of(invoke_suspec(ctx.env, "show", [kind, key]))
          : JSON.stringify({
              error: "InvalidId",
              message: `invalid id: ${String(variables.id)}`,
            });
        return { contents: [{ uri: uri.href, mimeType: JSON_MIME, text }] };
      },
    );
  };
  artifact_resource("task", "suspec://tasks/{id}", "task", (id) => id);
  artifact_resource("review", "suspec://reviews/{id}", "review", task_stem);

  server.registerResource(
    "spec",
    new ResourceTemplate("suspec://specs/{id}", { list: undefined }),
    { title: "spec", mimeType: JSON_MIME },
    (uri, variables) => {
      const id = String(variables.id);
      const text = is_safe_segment(id)
        ? body_of(invoke_suspec(ctx.env, "show", ["spec", id]))
        : JSON.stringify({
            error: "InvalidId",
            message: `invalid spec id: ${id}`,
          });
      return { contents: [{ uri: uri.href, mimeType: JSON_MIME, text }] };
    },
  );

  // Findings have no parser — serve the raw markdown, root-confined, clearly labelled unparsed. The id
  // is gated through `is_safe_segment` FIRST (like the task/spec/review templates), so confinement does
  // not depend on the SDK's URI-template capture semantics; `confine_path` then re-confirms as depth.
  server.registerResource(
    "finding",
    new ResourceTemplate("suspec://findings/{id}", { list: undefined }),
    { title: "finding", mimeType: "text/markdown" },
    (uri, variables) => {
      const id = String(variables.id);
      if (!is_safe_segment(id)) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: JSON_MIME,
              text: JSON.stringify({
                error: "InvalidId",
                message: `invalid finding id: ${id}`,
              }),
            },
          ],
        };
      }
      const safe = confine_path(ctx.root, join("findings", `${id}.md`));
      /* v8 ignore start -- defence in depth: is_safe_segment already rejects every `..`/separator/
         flag-shaped id, so a safe segment always confines; this arm guards a non-template future caller. */
      if (safe === null) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: JSON_MIME,
              text: JSON.stringify({
                error: "InvalidId",
                message: `invalid finding id: ${id}`,
              }),
            },
          ],
        };
      }
      /* v8 ignore stop */
      const path = join(ctx.root, safe);
      const text = existsSync(path)
        ? readFileSync(path, "utf8")
        : `(no finding ${id})`;
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
    },
  );
}
