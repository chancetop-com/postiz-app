import { isBrowserChannel } from '@gitroom/helpers/utils/browser-publishing';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Validate,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { MediaDto } from '@gitroom/nestjs-libraries/dtos/media/media.dto';
import {
  allProviders,
  type AllProvidersSettings,
  EmptySettings,
} from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/all.providers.settings';
import { ValidContent } from '@gitroom/helpers/utils/valid.images';
import { sanitizePostContent } from '@gitroom/helpers/utils/sanitize.post.content';

export class Integration {
  @IsDefined()
  @IsString()
  id: string;

  @IsOptional()
  @IsString()
  bindingId?: string;
}

class BrowserDraftContent {
  @IsDefined()
  @IsString()
  @Transform(({ value }) => sanitizePostContent(value))
  content: string;

  @IsOptional()
  @IsString()
  id: string;

  @IsOptional()
  @IsNumber()
  delay: number;

  @IsArray()
  @Type(() => MediaDto)
  @ValidateNested({ each: true })
  image: MediaDto[];
}

export class BrowserDraftEditor {
  @IsBoolean()
  overridesShared: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @Type(() => BrowserDraftContent)
  @ValidateNested({ each: true })
  shared: BrowserDraftContent[];
}

export class PostContent extends BrowserDraftContent {
  @Validate(ValidContent)
  declare content: string;
}

export class Post {
  type?: string;

  @IsOptional()
  @Type(() => BrowserDraftEditor)
  @ValidateNested()
  draftEditor?: BrowserDraftEditor;

  @IsDefined()
  @Type(() => Integration)
  @ValidateNested()
  integration: Integration;

  @IsDefined()
  @ArrayMinSize(1)
  @IsArray()
  @Type((context) =>
    context?.object?.type === 'draft' && isBrowserChannel(context.object.settings?.__type)
      ? BrowserDraftContent
      : PostContent
  )
  @ValidateNested({ each: true })
  value: PostContent[];

  @IsOptional()
  @IsString()
  group: string;

  // a channel that keeps a date of its own, the others use the post date
  @IsOptional()
  @IsDateString()
  date?: string;

  @ValidateIf((o) => o.type !== 'draft')
  @ValidateNested()
  @Type(() => EmptySettings, {
    keepDiscriminatorProperty: true,
    discriminator: {
      property: '__type',
      subTypes: allProviders(EmptySettings),
    },
  })
  settings: AllProvidersSettings;
}

export class Tags {
  @IsDefined()
  @IsString()
  value: string;

  @IsDefined()
  @IsString()
  label: string;
}

export class CreatePostDto {
  @IsDefined()
  @IsIn(['draft', 'schedule', 'now', 'update'])
  type: 'draft' | 'schedule' | 'now' | 'update';

  @IsOptional()
  @IsString()
  order?: string;

  @IsDefined()
  @IsBoolean()
  shortLink: boolean;

  @IsOptional()
  @IsNumber()
  inter?: number;

  // explicit opt-in to publish an already-PUBLISHED post again; without it a
  // schedule/now save targeting a published post is rejected
  @IsOptional()
  @IsBoolean()
  republish?: boolean;

  @IsDefined()
  @IsDateString()
  date: string;

  @IsArray()
  @IsDefined()
  @ValidateNested({ each: true })
  tags: Tags[];

  @IsDefined()
  @Type(() => Post)
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  posts: Post[];
}
