import { Type } from 'class-transformer';
import { IsOptionalJsonBoolean } from '@gitroom/helpers/utils/optional.json.boolean';
import {
  IsArray,
  IsDefined,
  IsIn,
  IsNumber,
  IsString,
  Max,
  Min,
  ValidateNested,
  IsOptional,
} from 'class-validator';
import { JSONSchema } from 'class-validator-jsonschema';

export class Collaborators {
  @IsDefined()
  @IsString()
  label: string;
}

export class InstagramAudio {
  @IsDefined()
  @IsString()
  id: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  artist?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  audio_volume?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  video_volume?: number;
}
export class InstagramLocation {
  // Keep the JSON type so Nest's implicit conversion cannot stringify a numeric Page ID.
  @Type(() => Object)
  @IsDefined()
  @IsString()
  @JSONSchema({
    description:
      'The Facebook Page ID returned by the locationSearch function. The Page ' +
      'must have location data, otherwise Instagram rejects the media container.',
  })
  id: string;

  @IsDefined()
  @IsString()
  @JSONSchema({
    description: 'Display name of the Page. Not sent to Instagram.',
  })
  name: string;

  @IsOptional()
  @IsString()
  @JSONSchema({
    description: 'Display-only address from the Page location. Not sent to Instagram.',
  })
  address?: string;
}

export class InstagramDto {
  @IsIn(['post', 'story'])
  @IsDefined()
  post_type: 'post' | 'story';

  @Type(() => InstagramLocation)
  @ValidateNested()
  @IsOptional()
  @JSONSchema({
    description:
      'Tags the post with a Facebook Page location (Facebook Login only). Applies ' +
      'to a single image, a single video/Reel, and the parent container of a ' +
      'carousel; ignored on a Story, on carousel children, and with Instagram ' +
      'Standalone (Instagram Login).',
  })
  location?: InstagramLocation;

  @IsOptional()
  is_trial_reel?: boolean;

  @IsOptionalJsonBoolean()
  @JSONSchema({
    description:
      'Labels the media as AI generated. Applies to a single image, a single ' +
      'video/Reel, and the parent container of a carousel only. Ignored on a ' +
      'Story and on carousel children. Available with both Instagram login types.',
  })
  is_ai_generated?: boolean;

  @IsIn(['MANUAL', 'SS_PERFORMANCE'])
  @IsOptional()
  graduation_strategy?: 'MANUAL' | 'SS_PERFORMANCE';

  @Type(() => Collaborators)
  @ValidateNested({ each: true })
  @IsArray()
  @IsOptional()
  collaborators: Collaborators[];

  @Type(() => InstagramAudio)
  @ValidateNested()
  @IsOptional()
  audio?: InstagramAudio;
}
