export function isPublishImageProcessingEnabled(): boolean {
  return !process.env.DISABLE_PUBLISH_IMAGE_PROCESSING;
}
