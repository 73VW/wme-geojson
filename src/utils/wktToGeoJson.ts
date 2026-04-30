import type { LineString, MultiLineString, Position } from "geojson";

/**
 * Convert WKT LineString-like geometries returned by the WME SDK into GeoJSON.
 *
 * Supported WKT types:
 * - LINESTRING[( Z)] (...)
 * - MULTILINESTRING[( Z)] ((...),(...))
 */
export function wktToGeoJson(wkt: string): LineString | MultiLineString {
  const raw = wkt.trim();

  if (raw.length === 0) {
    throw new Error("Empty WKT geometry");
  }

  if (startsWithType(raw, "LINESTRING")) {
    const body = extractFirstParenBody(raw);
    return {
      type: "LineString",
      coordinates: parseLineBody(body),
    };
  }

  if (startsWithType(raw, "MULTILINESTRING")) {
    const body = extractFirstParenBody(raw);
    return {
      type: "MultiLineString",
      coordinates: parseMultiLineBody(body),
    };
  }

  throw new Error(`Unsupported WKT geometry type: ${raw.split("(")[0]?.trim() ?? "unknown"}`);
}

function startsWithType(value: string, typeName: string): boolean {
  const upper = value.toUpperCase();
  return upper.startsWith(typeName) || upper.startsWith(`${typeName} Z`);
}

function extractFirstParenBody(value: string): string {
  const firstParen = value.indexOf("(");
  if (firstParen < 0) {
    throw new Error(`Invalid WKT: missing opening parenthesis in '${value}'`);
  }

  const lastParen = value.lastIndexOf(")");
  if (lastParen <= firstParen) {
    throw new Error(`Invalid WKT: missing closing parenthesis in '${value}'`);
  }

  return value.slice(firstParen + 1, lastParen).trim();
}

function parseMultiLineBody(body: string): Position[][] {
  const lines: Position[][] = [];
  let depth = 0;
  let chunkStart = -1;

  for (let i = 0; i < body.length; i++) {
    const c = body[i];

    if (c === "(") {
      if (depth === 0) {
        chunkStart = i + 1;
      }
      depth++;
      continue;
    }

    if (c === ")") {
      depth--;
      if (depth < 0) {
        throw new Error("Invalid WKT MULTILINESTRING: unmatched closing parenthesis");
      }
      if (depth === 0 && chunkStart >= 0) {
        const chunk = body.slice(chunkStart, i).trim();
        lines.push(parseLineBody(chunk));
        chunkStart = -1;
      }
    }
  }

  if (depth !== 0) {
    throw new Error("Invalid WKT MULTILINESTRING: unbalanced parentheses");
  }

  if (lines.length === 0) {
    throw new Error("Invalid WKT MULTILINESTRING: no line components");
  }

  return lines;
}

function parseLineBody(body: string): Position[] {
  const tokens = body
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const coordinates = tokens.map(parsePoint);
  if (coordinates.length < 2) {
    throw new Error("Invalid WKT LINESTRING: at least 2 points are required");
  }

  return coordinates;
}

function parsePoint(token: string): Position {
  const values = token
    .trim()
    .split(/\s+/)
    .map((value) => Number(value));

  if (values.length < 2 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`Invalid WKT coordinate: '${token}'`);
  }

  if (values.length >= 3) {
    return [values[0], values[1], values[2]];
  }

  return [values[0], values[1]];
}
