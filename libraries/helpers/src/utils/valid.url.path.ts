import { getMediaExtension, UPLOAD_EXTENSIONS } from './media.upload';
import {
  ValidationArguments,
  ValidatorConstraintInterface,
  ValidatorConstraint,
} from 'class-validator';

const allowedExtensions = new Set([
  ...UPLOAD_EXTENSIONS.values(),
  'jpeg',
  'tiff',
]);

@ValidatorConstraint({ name: 'checkValidExtension', async: false })
export class ValidUrlExtension implements ValidatorConstraintInterface {
  validate(text: string, args: ValidationArguments) {
    if (typeof text !== 'string') return false;
    return allowedExtensions.has(getMediaExtension(text));
  }

  defaultMessage(args: ValidationArguments) {
    const extensions = [...allowedExtensions].map((ext) => '.' + ext);
    return 'File must have a valid extension: ' + extensions.join(', ');
  }
}

// also used for media urls that don't come through a DTO, like pictures in a post body
export const isAllowedUploadPath = (text: string) => {
  if (!process.env.RESTRICT_UPLOAD_DOMAINS) {
    return true;
  }

  return (
    (text || 'invalid url').indexOf(process.env.RESTRICT_UPLOAD_DOMAINS) > -1
  );
};

@ValidatorConstraint({ name: 'checkValidPath', async: false })
export class ValidUrlPath implements ValidatorConstraintInterface {
  validate(text: string, args: ValidationArguments) {
    return isAllowedUploadPath(text);
  }

  defaultMessage(args: ValidationArguments) {
    // here you can provide default error message if validation failed
    return (
      'URL must contain the domain: ' + process.env.RESTRICT_UPLOAD_DOMAINS + ' Make sure you first use the upload API route.'
    );
  }
}
