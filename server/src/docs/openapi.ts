import type { Router } from "express";
import { env } from "../config/env.js";

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
  name: string;
  regexp: RegExp;
  handle: { stack?: Layer[] };
}

function mountPath(l: Layer): string {
  const src = l.regexp.source;
  if (src === "^\\/?(?=\\/|$)" || src === "^\\/?$") return "";
  const m = /^\^((?:\\\/[^\\()?]+)+)\\\/\?\(\?=\\\/\|\$\)$/.exec(src);
  return m ? m[1].replace(/\\\//g, "/") : "";
}

function collect(
  stack: Layer[],
  prefix: string,
  out: { method: string; path: string }[],
) {
  for (const l of stack) {
    if (l.route) {
      for (const m of Object.keys(l.route.methods))
        out.push({
          method: m,
          path: prefix + (l.route.path === "/" ? "" : l.route.path),
        });
    } else if (l.name === "router" && l.handle.stack) {
      collect(l.handle.stack, prefix + mountPath(l), out);
    }
  }
}

const PUBLIC = new Set([
  "POST /auth/login",
  "POST /auth/refresh",
  "POST /auth/logout",
]);

/** The OpenAPI document is generated from the mounted Express routers, so it can never drift from the real routes. */
export function buildOpenApi(routes: { path: string; router: Router }[]) {
  const found: { method: string; path: string }[] = [];
  for (const r of routes) collect((r.router as any).stack, r.path, found);
  const paths: Record<string, any> = {};
  for (const { method, path } of found) {
    const oas = path.replace(/:(\w+)/g, "{$1}") || "/";
    const params = [...path.matchAll(/:(\w+)/g)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    const tag = path.split("/")[1] ?? "root";
    (paths[oas] ??= {})[method] = {
      tags: [tag],
      summary: `${method.toUpperCase()} ${oas}`,
      parameters: params,
      ...(PUBLIC.has(`${method.toUpperCase()} ${path}`)
        ? { security: [] }
        : {}),
      responses: {
        "200": { description: "Success: { success, data, message, meta }" },
        "4XX": {
          description:
            "Error: { success:false, error:{ code, message, details } }",
        },
      },
    };
  }
  return {
    openapi: "3.0.3",
    info: {
      title: "Flexostar CRM API",
      version: "1.0.0",
      description:
        "REST API for Flexostar Group Algérie. Detailed request examples: docs/api.md.",
    },
    servers: [{ url: `${env.PUBLIC_API_URL}${env.API_PREFIX}` }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [...new Set(found.map((f) => f.path.split("/")[1] ?? "root"))].map(
      (name) => ({ name }),
    ),
    paths,
  };
}
