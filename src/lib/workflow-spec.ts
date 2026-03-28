/**
 * Workflow Spec Parser
 *
 * Parses workflow spec XML (workflow-spec.xsd format) and returns a typed object.
 * Validates required fields, name/id formats, step schema validity, and references.
 */
import { XMLParser, XMLValidator } from "fast-xml-parser";

// ─── Types ─────────────────────────────────────────────────

export interface WorkflowSpec {
  name: string;
  description: string;
  max_retries: number;
  steps: WorkflowSpecStep[];
}

export interface WorkflowSpecStep {
  id: string;
  description: string;
  predecessor?: string;
  pre_script?: string;
  post_script?: string;
  prompt: string;
  schema: string;
}

// ─── Validation helpers ────────────────────────────────────

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const ID_RE = /^[a-z0-9][a-z0-9_]*$/;

// ─── Parser config ─────────────────────────────────────────

// Default fast-xml-parser v5 config: CDATA sections are returned as plain string
// text content, so no special option is needed.
const specParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: true,
  trimValues: true,
  isArray: (name) => name === "step",
});

const schemaParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  isArray: (name) => ["xs:element", "xs:attribute"].includes(name),
});

// ─── Public API ────────────────────────────────────────────

export function parseWorkflowSpec(xml: string): WorkflowSpec {
  const root = parseRoot(xml);

  validateRequiredField(root, "name");
  validateRequiredField(root, "description");
  validateRequiredField(root, "steps");

  const name = String(root.name);
  if (!NAME_RE.test(name)) {
    throw new Error(
      `Invalid name "${name}": must match /^[a-z0-9][a-z0-9-]*$/ (lowercase letters, digits, hyphens; must start with letter or digit)`,
    );
  }

  const description = String(root.description);
  const max_retries: number = typeof root.max_retries === "number" ? root.max_retries : 3;

  // steps element may parse as an object with a "step" array, or as empty
  const stepsContainer = root.steps as Record<string, unknown> | null | undefined;
  const rawSteps =
    stepsContainer && typeof stepsContainer === "object" && "step" in stepsContainer
      ? (stepsContainer.step as unknown[])
      : null;

  if (!rawSteps || !Array.isArray(rawSteps) || rawSteps.length === 0) {
    throw new Error("Invalid workflow spec: <steps> must contain at least one <step>");
  }

  const ids = new Set<string>();
  const steps: WorkflowSpecStep[] = [];

  for (const raw of rawSteps) {
    const step = raw as Record<string, unknown>;
    steps.push(parseStep(step, ids));
  }

  return { name, description, max_retries, steps };
}

// ─── Internal helpers ──────────────────────────────────────

function parseRoot(xml: string): Record<string, unknown> {
  const doc = specParser.parse(xml) as Record<string, unknown>;
  const root = doc["workflow-spec"] as Record<string, unknown> | undefined;
  if (!root) {
    throw new Error("Invalid workflow spec: missing <workflow-spec> root element");
  }
  return root;
}

function validateRequiredField(root: Record<string, unknown>, field: string): void {
  const val = root[field];
  if (val === undefined || val === null || val === "") {
    throw new Error(`Invalid workflow spec: missing required element <${field}>`);
  }
}

function parseStep(step: Record<string, unknown>, ids: Set<string>): WorkflowSpecStep {
  // Validate required fields
  for (const field of ["id", "description", "prompt", "schema"] as const) {
    const val = step[field];
    if (val === undefined || val === null || val === "") {
      throw new Error(`Invalid step: missing required element <${field}>`);
    }
  }

  const id = String(step.id);
  if (!ID_RE.test(id)) {
    throw new Error(
      `Invalid step id "${id}": must match /^[a-z0-9][a-z0-9_]*$/ (lowercase letters, digits, underscores; hyphens not allowed)`,
    );
  }

  if (ids.has(id)) {
    throw new Error(`Duplicate step id "${id}"`);
  }
  ids.add(id);

  const predecessor = step.predecessor != null ? String(step.predecessor) : undefined;
  if (predecessor !== undefined && !ids.has(predecessor)) {
    throw new Error(
      `Step "${id}" has predecessor "${predecessor}" which is not defined before it`,
    );
  }

  const schema = String(step.schema);
  validateStepSchema(schema, id);

  return {
    id,
    description: String(step.description),
    prompt: String(step.prompt),
    schema,
    ...(predecessor !== undefined ? { predecessor } : {}),
    ...(step.pre_script != null ? { pre_script: String(step.pre_script) } : {}),
    ...(step.post_script != null ? { post_script: String(step.post_script) } : {}),
  };
}

function validateStepSchema(schema: string, stepId: string): void {
  // 1. Well-formedness check
  const result = XMLValidator.validate(schema);
  if (result !== true) {
    throw new Error(
      `Step "${stepId}" schema is not valid XML: Line ${result.err.line}, Column ${result.err.col}: ${result.err.msg}`,
    );
  }

  // 2. Parse and check for xs:schema root
  const doc = schemaParser.parse(schema) as Record<string, unknown>;
  const xsSchema = doc["xs:schema"] as Record<string, unknown> | undefined;
  if (!xsSchema) {
    throw new Error(
      `Step "${stepId}" schema must have <xs:schema> as root element`,
    );
  }

  // 3. Check for at least one xs:element child
  const elements = xsSchema["xs:element"];
  if (
    !elements ||
    (Array.isArray(elements) && elements.length === 0)
  ) {
    throw new Error(
      `Step "${stepId}" schema must have at least one <xs:element> child in <xs:schema>`,
    );
  }
}
