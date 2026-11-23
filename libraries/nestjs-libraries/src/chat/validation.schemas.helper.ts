import {
  validationMetadatasToSchemas,
  targetConstructorToSchema,
} from 'class-validator-jsonschema';
import { IS_DATE_STRING, ValidationTypes } from 'class-validator';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
// @ts-ignore
import { defaultMetadataStorage } from 'class-transformer/cjs/storage';

const schemaOptions: Parameters<typeof validationMetadatasToSchemas>[0] = {
  classTransformerMetadataStorage: defaultMetadataStorage,
  additionalConverters: {
    [ValidationTypes.NESTED_VALIDATION]: (meta, options) => {
      if (typeof meta.target === 'function') {
        const typeMeta = options.classTransformerMetadataStorage
          ? options.classTransformerMetadataStorage.findTypeMetadata(
              meta.target,
              meta.propertyName
            )
          : null;
        if (typeMeta) {
          const childType = typeMeta.typeFunction();
          return targetConstructorToSchema(childType, options);
        }
      }
      return {};
    },
  },
};

export function getValidationSchemas() {
  return validationMetadatasToSchemas(schemaOptions);
}

export function getOpenApiSchema(model: Function): SchemaObject {
  return targetConstructorToSchema(model, {
    ...schemaOptions,
    additionalConverters: {
      ...schemaOptions.additionalConverters,
      // OpenAPI 3.0 expresses required properties on their parent object.
      [ValidationTypes.IS_DEFINED]: {},
      // IsDateString also accepts ISO 8601 timestamps without a timezone.
      [IS_DATE_STRING]: {
        type: 'string',
        description: 'ISO 8601 date or date-time.',
      },
    },
  }) as SchemaObject;
}
