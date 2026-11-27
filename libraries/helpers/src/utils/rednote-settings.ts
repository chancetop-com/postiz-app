export const rednoteContentTypes = [
  'fiction',
  'ai',
  'marketing',
  'self-shot',
  'repost',
] as const;

const fields = new Set([
  'title',
  'location',
  'original',
  'contentType',
  'repostSource',
  'shootLocation',
  'shootDate',
]);

export function rednoteSettingsError(
  settings: Record<string, unknown>
): string | undefined {
  const {
    title,
    location,
    original,
    contentType,
    repostSource,
    shootLocation,
    shootDate,
  } = settings;
  if (Object.keys(settings).some((key) => !fields.has(key)))
    return 'Unsupported browser channel setting';
  if (typeof title !== 'string' || !title.trim() || /[\r\n\t]/.test(title))
    return 'Enter a single-line title';
  if (
    location !== undefined &&
    (typeof location !== 'string' || !location.trim())
  )
    return 'Enter a post location or clear the setting';
  if (original !== undefined && typeof original !== 'boolean')
    return 'Select a valid original declaration';
  if (
    contentType !== undefined &&
    !rednoteContentTypes.some((type) => type === contentType)
  )
    return 'Select one content declaration';
  if (contentType === 'repost') {
    if (typeof repostSource !== 'string' || !repostSource.trim())
      return 'Enter the repost source';
    if (original !== undefined)
      return 'Leave the original declaration at its default for reposts';
  } else if (repostSource !== undefined) {
    return 'A repost source applies only to reposts';
  }
  if (contentType === 'self-shot') {
    if (original === false)
      return 'A self-shot post cannot disable the original declaration';
    if (typeof shootLocation !== 'string' || !shootLocation.trim())
      return 'Enter the shooting location';
    if (
      typeof shootDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(shootDate) ||
      shootDate.startsWith('0000')
    )
      return 'Enter a shooting date in YYYY-MM-DD format';
    const date = new Date(shootDate + 'T00:00:00Z');
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== shootDate
    )
      return 'Enter a valid shooting date';
  } else if (shootLocation !== undefined || shootDate !== undefined) {
    return 'Shooting location and date apply only to self-shot posts';
  }
}
