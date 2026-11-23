import { Transform } from 'class-transformer';
import { IsBoolean, ValidateIf } from 'class-validator';

export const IsOptionalJsonBoolean = () => (target: object, key: string) => {
  // Nest's implicit conversion would turn a nonempty string such as "false" into true.
  Transform(({ obj }) => obj[key], { toClassOnly: true })(target, key);
  ValidateIf((_object, value) => value !== undefined)(target, key);
  IsBoolean()(target, key);
};
