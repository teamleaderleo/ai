import type { JSONSchema7 } from '@ai-sdk/provider';
import { jsonSchema } from '@ai-sdk/provider-utils';
import { describe, expect, it } from 'vitest';
import { getOutputStrategy } from '../generate-object/output-strategy';
import { array } from './output';

function createElementSchema() {
  return jsonSchema({
    type: 'object',
    properties: {
      shared: { type: 'string' },
      copy: { $ref: '#/properties/shared' },
    },
    required: ['shared', 'copy'],
    additionalProperties: false,
  } as JSONSchema7);
}

function expectCurrentRelocation(schema: JSONSchema7) {
  const rootProperties = schema.properties as
    | Record<string, JSONSchema7>
    | undefined;
  const elementsSchema = rootProperties?.elements as JSONSchema7;
  const itemSchema = elementsSchema.items as JSONSchema7;
  const itemProperties = itemSchema.properties as Record<string, JSONSchema7>;

  expect(rootProperties?.shared).toBeUndefined();
  expect(itemProperties.shared).toEqual({ type: 'string' });
  expect(itemProperties.copy).toEqual({ $ref: '#/properties/shared' });
}

describe('Fieldwork #904: array output local JSON Schema references', () => {
  it('currently retargets a local property ref in Output.array()', async () => {
    const result = await array({ element: createElementSchema() })
      .responseFormat;

    expect(result?.type).toBe('json');
    expectCurrentRelocation((result as { schema: JSONSchema7 }).schema);
  });

  it('currently retargets a local property ref in the deprecated array strategy', async () => {
    const strategy = getOutputStrategy({
      output: 'array',
      schema: createElementSchema(),
    });

    expectCurrentRelocation((await strategy.jsonSchema()) as JSONSchema7);
  });
});
