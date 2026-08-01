function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function literalValue(schema: unknown): unknown {
  const record = asRecord(schema);
  if (!record) return undefined;
  if (Array.isArray(record.enum) && record.enum.length === 1) {
    return record.enum[0];
  }
  return undefined;
}

function primitiveSchemaType(value: unknown): string | undefined {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "boolean") return "boolean";
  return undefined;
}

/**
 * Preserve common TypeBox schemas while translating constructs that many
 * OpenAI-compatible gateways validate as the smaller OpenAPI 3.0 subset.
 */
function downlevelSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(downlevelSchema);
  const source = asRecord(value);
  if (!source) return value;

  const next = Object.fromEntries(
    Object.entries(source).map(([key, child]) => [key, downlevelSchema(child)]),
  ) as Record<string, unknown>;

  if (Object.prototype.hasOwnProperty.call(next, "const")) {
    next.enum = [next.const];
    delete next.const;
  }

  const patterns = asRecord(next.patternProperties);
  if (patterns) {
    const schemas = Object.values(patterns);
    if (next.additionalProperties === undefined && schemas.length === 1) {
      next.additionalProperties = schemas[0];
    }
    delete next.patternProperties;
  }

  if (next.unevaluatedProperties !== undefined) {
    if (next.additionalProperties === undefined) {
      next.additionalProperties = next.unevaluatedProperties;
    }
    delete next.unevaluatedProperties;
  }

  const variants = Array.isArray(next.anyOf) ? next.anyOf : undefined;
  if (variants && variants.length > 0) {
    const nullableIndex = variants.findIndex(
      (variant) => asRecord(variant)?.type === "null",
    );
    if (nullableIndex >= 0 && variants.length === 2) {
      const concrete = asRecord(variants[nullableIndex === 0 ? 1 : 0]);
      if (concrete) {
        delete next.anyOf;
        Object.assign(next, concrete, { nullable: true });
      }
    } else {
      const literals = variants.map(literalValue);
      const types = literals.map(primitiveSchemaType);
      if (
        literals.every((literal) => literal !== undefined) &&
        types.every((type) => type && type === types[0])
      ) {
        delete next.anyOf;
        next.type = types[0];
        next.enum = literals;
      }
    }
  }

  if (Array.isArray(next.type) && next.type.includes("null")) {
    const concreteTypes = next.type.filter((type) => type !== "null");
    if (concreteTypes.length === 1) {
      next.type = concreteTypes[0];
      next.nullable = true;
    }
  }

  return next;
}

function downlevelTool(tool: unknown): unknown {
  const source = asRecord(tool);
  if (!source) return tool;
  const next = { ...source };

  const fn = asRecord(source.function);
  if (fn?.parameters !== undefined) {
    next.function = {
      ...fn,
      parameters: downlevelSchema(fn.parameters),
    };
  }
  if (source.parameters !== undefined) {
    next.parameters = downlevelSchema(source.parameters);
  }
  return next;
}

export function downlevelCustomToolSchemas(tools: unknown): unknown {
  return Array.isArray(tools) ? tools.map(downlevelTool) : tools;
}
