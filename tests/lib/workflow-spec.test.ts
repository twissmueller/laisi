import { describe, it, expect } from "vitest";
import { parseWorkflowSpec } from "../../src/lib/workflow-spec.js";

describe("parseWorkflowSpec", () => {
  const validSchema = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="root"><xs:complexType><xs:sequence><xs:element name="field" type="xs:string"/></xs:sequence></xs:complexType></xs:element></xs:schema>`;

  function minimalSpec(overrides?: { name?: string; id?: string; schema?: string }) {
    const name = overrides?.name ?? "test-workflow";
    const id = overrides?.id ?? "step1";
    const schema = overrides?.schema ?? validSchema;
    return `<?xml version="1.0" encoding="UTF-8"?>
<workflow-spec>
  <name>${name}</name>
  <description>Test</description>
  <max_retries>3</max_retries>
  <steps>
    <step>
      <id>${id}</id>
      <description>Test step</description>
      <prompt>Do something</prompt>
      <schema><![CDATA[${schema}]]></schema>
    </step>
  </steps>
</workflow-spec>`;
  }

  it("parses a valid spec", () => {
    const spec = parseWorkflowSpec(minimalSpec());
    expect(spec.name).toBe("test-workflow");
    expect(spec.description).toBe("Test");
    expect(spec.max_retries).toBe(3);
    expect(spec.steps).toHaveLength(1);
    expect(spec.steps[0].id).toBe("step1");
    expect(spec.steps[0].description).toBe("Test step");
    expect(spec.steps[0].prompt).toBe("Do something");
    expect(spec.steps[0].schema).toContain("xs:schema");
  });

  it("throws when name is missing", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<workflow-spec>
  <description>Test</description>
  <max_retries>3</max_retries>
  <steps>
    <step>
      <id>step1</id>
      <description>Test step</description>
      <prompt>Do something</prompt>
      <schema><![CDATA[${validSchema}]]></schema>
    </step>
  </steps>
</workflow-spec>`;
    expect(() => parseWorkflowSpec(xml)).toThrow(/name/i);
  });

  it("throws when required step element prompt is missing", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<workflow-spec>
  <name>test-workflow</name>
  <description>Test</description>
  <max_retries>3</max_retries>
  <steps>
    <step>
      <id>step1</id>
      <description>Test step</description>
      <schema><![CDATA[${validSchema}]]></schema>
    </step>
  </steps>
</workflow-spec>`;
    expect(() => parseWorkflowSpec(xml)).toThrow(/prompt/i);
  });

  it("throws when step IDs are duplicate", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<workflow-spec>
  <name>test-workflow</name>
  <description>Test</description>
  <max_retries>3</max_retries>
  <steps>
    <step>
      <id>step1</id>
      <description>First step</description>
      <prompt>Do something</prompt>
      <schema><![CDATA[${validSchema}]]></schema>
    </step>
    <step>
      <id>step1</id>
      <description>Duplicate step</description>
      <prompt>Do something else</prompt>
      <schema><![CDATA[${validSchema}]]></schema>
    </step>
  </steps>
</workflow-spec>`;
    expect(() => parseWorkflowSpec(xml)).toThrow(/duplicate/i);
  });

  it("throws when predecessor references an unknown step", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<workflow-spec>
  <name>test-workflow</name>
  <description>Test</description>
  <max_retries>3</max_retries>
  <steps>
    <step>
      <id>step1</id>
      <description>First step</description>
      <prompt>Do something</prompt>
      <schema><![CDATA[${validSchema}]]></schema>
    </step>
    <step>
      <id>step2</id>
      <description>Second step</description>
      <predecessor>nonexistent</predecessor>
      <prompt>Do something else</prompt>
      <schema><![CDATA[${validSchema}]]></schema>
    </step>
  </steps>
</workflow-spec>`;
    expect(() => parseWorkflowSpec(xml)).toThrow(/predecessor.*nonexistent/i);
  });

  it("throws when name has invalid format", () => {
    expect(() => parseWorkflowSpec(minimalSpec({ name: "My Workflow!" }))).toThrow(/name/i);
  });

  it("throws when step id has invalid format (hyphens not allowed)", () => {
    expect(() => parseWorkflowSpec(minimalSpec({ id: "my-step" }))).toThrow(/id/i);
  });

  it("throws when step schema is not valid XML", () => {
    expect(() => parseWorkflowSpec(minimalSpec({ schema: "this is not xml <<< broken" }))).toThrow(
      /schema/i,
    );
  });

  it("throws when step schema is missing xs:schema root", () => {
    const notXsSchema = `<root><element name="foo"/></root>`;
    expect(() => parseWorkflowSpec(minimalSpec({ schema: notXsSchema }))).toThrow(/xs:schema/i);
  });

  it("throws when step schema has xs:schema root but no xs:element children", () => {
    const emptyXsSchema = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"></xs:schema>`;
    expect(() => parseWorkflowSpec(minimalSpec({ schema: emptyXsSchema }))).toThrow(/xs:element/i);
  });

  it("throws when steps is empty (zero steps)", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<workflow-spec>
  <name>test-workflow</name>
  <description>Test</description>
  <max_retries>3</max_retries>
  <steps></steps>
</workflow-spec>`;
    expect(() => parseWorkflowSpec(xml)).toThrow(/step/i);
  });

  it("parses a script-only step", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<workflow-spec>
  <name>test-workflow</name>
  <description>Test</description>
  <max_retries>3</max_retries>
  <steps>
    <step>
      <id>deploy</id>
      <description>Deploy the artifact</description>
      <script>./deploy.sh</script>
    </step>
  </steps>
</workflow-spec>`;
    const spec = parseWorkflowSpec(xml);
    expect(spec.steps).toHaveLength(1);
    expect(spec.steps[0].script).toBe("./deploy.sh");
    expect(spec.steps[0].prompt).toBeUndefined();
    expect(spec.steps[0].schema).toBeUndefined();
  });

  it("parses a mixed workflow with LLM and script steps", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<workflow-spec>
  <name>test-workflow</name>
  <description>Test</description>
  <max_retries>3</max_retries>
  <steps>
    <step>
      <id>generate</id>
      <description>Generate content</description>
      <prompt>Do something</prompt>
      <schema><![CDATA[${validSchema}]]></schema>
    </step>
    <step>
      <id>deploy</id>
      <description>Deploy the artifact</description>
      <predecessor>generate</predecessor>
      <script>./deploy.sh</script>
    </step>
  </steps>
</workflow-spec>`;
    const spec = parseWorkflowSpec(xml);
    expect(spec.steps).toHaveLength(2);
    expect(spec.steps[0].id).toBe("generate");
    expect(spec.steps[0].prompt).toBe("Do something");
    expect(spec.steps[0].schema).toContain("xs:schema");
    expect(spec.steps[0].script).toBeUndefined();
    expect(spec.steps[1].id).toBe("deploy");
    expect(spec.steps[1].predecessor).toBe("generate");
    expect(spec.steps[1].script).toBe("./deploy.sh");
    expect(spec.steps[1].prompt).toBeUndefined();
    expect(spec.steps[1].schema).toBeUndefined();
  });

  it("throws when step has both script and prompt", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<workflow-spec>
  <name>test-workflow</name>
  <description>Test</description>
  <max_retries>3</max_retries>
  <steps>
    <step>
      <id>step1</id>
      <description>Ambiguous step</description>
      <script>./run.sh</script>
      <prompt>Do something</prompt>
      <schema><![CDATA[${validSchema}]]></schema>
    </step>
  </steps>
</workflow-spec>`;
    expect(() => parseWorkflowSpec(xml)).toThrow(/both.*script.*prompt|script.*prompt.*schema/i);
  });

  it("throws when step has prompt but no schema and no script", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<workflow-spec>
  <name>test-workflow</name>
  <description>Test</description>
  <max_retries>3</max_retries>
  <steps>
    <step>
      <id>step1</id>
      <description>Incomplete LLM step</description>
      <prompt>Do something</prompt>
    </step>
  </steps>
</workflow-spec>`;
    expect(() => parseWorkflowSpec(xml)).toThrow(/prompt.*schema|script.*prompt/i);
  });

  it("throws when step has neither script nor prompt+schema", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<workflow-spec>
  <name>test-workflow</name>
  <description>Test</description>
  <max_retries>3</max_retries>
  <steps>
    <step>
      <id>step1</id>
      <description>Empty step</description>
    </step>
  </steps>
</workflow-spec>`;
    expect(() => parseWorkflowSpec(xml)).toThrow(/script.*prompt.*schema|prompt.*schema/i);
  });

  it("parses a multi-step spec with predecessors", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<workflow-spec>
  <name>test</name>
  <description>Test</description>
  <max_retries>3</max_retries>
  <steps>
    <step>
      <id>step1</id>
      <description>First step</description>
      <prompt>Do first thing</prompt>
      <schema><![CDATA[<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="root"><xs:complexType><xs:sequence><xs:element name="field" type="xs:string"/></xs:sequence></xs:complexType></xs:element></xs:schema>]]></schema>
    </step>
    <step>
      <id>step2</id>
      <description>Second step</description>
      <predecessor>step1</predecessor>
      <prompt>Do second thing</prompt>
      <schema><![CDATA[<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="out"><xs:complexType><xs:sequence><xs:element name="result" type="xs:string"/></xs:sequence></xs:complexType></xs:element></xs:schema>]]></schema>
    </step>
  </steps>
</workflow-spec>`;
    const spec = parseWorkflowSpec(xml);
    expect(spec.steps).toHaveLength(2);
    expect(spec.steps[0].id).toBe("step1");
    expect(spec.steps[0].predecessor).toBeUndefined();
    expect(spec.steps[1].id).toBe("step2");
    expect(spec.steps[1].predecessor).toBe("step1");
  });
});
