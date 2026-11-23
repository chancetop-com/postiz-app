import { getSchemaPath } from '@nestjs/swagger';
import {
  CreatePostDto,
  Post,
  Tags,
} from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import { InstagramDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/instagram.dto';
import { TikTokDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/tiktok.dto';
import { getOpenApiSchema } from '@gitroom/nestjs-libraries/chat/validation.schemas.helper';

export const publicPostSchemas = () => {
  const request = getOpenApiSchema(CreatePostDto);
  const post = getOpenApiSchema(Post);
  // The public controller uses the request date and resolves the settings
  // type from each integration ID rather than a caller-supplied discriminator.
  delete post.properties.date;
  post.properties.settings = {
    description:
      'Settings for the selected channel. Instagram and Instagram Standalone share InstagramDto. TikTok and TikTok Business share TikTokDto.',
    anyOf: [
      { $ref: getSchemaPath(InstagramDto) },
      { $ref: getSchemaPath(TikTokDto) },
      { type: 'object', description: 'Settings for other channels.' },
    ],
  };
  request.properties.posts = { ...request.properties.posts, items: post };
  request.properties.tags = {
    ...request.properties.tags,
    items: getOpenApiSchema(Tags),
  };
  return {
    PublicCreatePost: request,
    InstagramDto: getOpenApiSchema(InstagramDto),
    TikTokDto: getOpenApiSchema(TikTokDto),
  };
};
