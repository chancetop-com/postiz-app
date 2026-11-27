type AuthoredMedia = {
  path: string;
  role: string;
  size?: number;
  type?: string;
};
const length = (value: string) => Array.from(value).length;

export function validateTikTokInstagram(
  platform: string,
  action: string,
  settings: Record<string, unknown>,
  caption: string,
  media: AuthoredMedia[]
): string | undefined {
  const instagram = platform === 'instagram';
  const note = action === 'upload-note';
  const booleans = [
    'noComments',
    ...(instagram ? ['aiGenerated'] : ['aigc', 'yourBrand', 'brandedContent']),
  ];
  if (!instagram && !note) booleans.push('disableReuse');
  const fields = new Set([
    ...booleans,
    'location',
    ...(instagram ? ['title', 'collaborators'] : ['privacy']),
  ]);
  if (note) fields.add(instagram ? 'altText' : 'title');
  const unknown = Object.keys(settings).find((key) => !fields.has(key));
  if (unknown) return `Unsupported option for this post: ${unknown}`;
  if (
    booleans.some(
      (key) => key in settings && typeof settings[key] !== 'boolean'
    )
  )
    return 'Use a boolean for the selected option';
  if (
    'location' in settings &&
    (typeof settings.location !== 'string' || !settings.location.trim())
  )
    return 'Enter a nonblank location';

  for (const item of media) {
    const suffix = item.path
      .split(/[?#]/, 1)[0]
      .match(/\.([a-z0-9]+)$/i)?.[1]
      .toLowerCase();
    const formats = instagram
      ? item.role === 'video'
        ? ['mp4', 'mov']
        : item.role === 'cover'
        ? ['jpg', 'jpeg', 'png']
        : ['jpg', 'jpeg', 'png', 'avif', 'heic', 'heif']
      : note
      ? ['jpg', 'jpeg', 'png', 'webp']
      : undefined;
    if (formats && suffix && !formats.includes(suffix))
      return `Choose a supported ${item.role} format (${formats.join(', ')})`;
  }

  if (!instagram) {
    if (
      'privacy' in settings &&
      !['public', 'friends', 'followers', 'only-me'].some(
        (p) => p === settings.privacy
      )
    )
      return 'Choose a supported TikTok privacy setting';
    if (settings.privacy === 'only-me' && settings.brandedContent)
      return 'Branded content is incompatible with Only me privacy';
    if (note) {
      if (
        'title' in settings &&
        (typeof settings.title !== 'string' ||
          length(settings.title) > 90 ||
          /[\r\n\t]/.test(settings.title))
      )
        return 'Use a single-line photo title of up to 90 characters';
      if (length(caption) > 4000)
        return 'The TikTok photo body can have up to 4,000 characters';
      if (media.length > 35) return 'TikTok supports up to 35 photos';
      if (media.some((item) => (item.size ?? 0) > 50 * 1024 * 1024))
        return 'Each TikTok photo must be 50 MiB or smaller';
    }
    return;
  }

  if (typeof settings.title !== 'string' || !settings.title.trim())
    return 'Enter an Instagram title';
  if (
    length(
      [settings.title.trim(), caption.trim()].filter(Boolean).join('\n\n')
    ) > 2200
  )
    return 'The composed Instagram caption can have up to 2,200 characters';
  if ('collaborators' in settings) {
    const list = settings.collaborators;
    if (!Array.isArray(list) || !list.length || list.length > 5)
      return 'Provide one to five collaborators';
    const normalized = list.map((name) =>
      typeof name === 'string'
        ? name.trim().replace(/^@/, '').toLowerCase()
        : ''
    );
    if (
      normalized.includes('') ||
      new Set(normalized).size !== normalized.length
    )
      return 'Enter a distinct username for each collaborator';
  }
  if ('altText' in settings) {
    const list = settings.altText;
    if (!Array.isArray(list) || list.length !== media.length)
      return 'Provide one alt text for each image, in order';
    if (
      list.some(
        (text) =>
          typeof text !== 'string' || !text.trim() || length(text.trim()) > 1000
      )
    )
      return 'Each alt text must contain 1 to 1,000 characters';
  }
}
