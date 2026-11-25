import sharp from 'sharp';

export function endDirectoryTiff() {
  return sharp({
    create: { width: 400, height: 400, channels: 3, background: 'red' },
  })
    .tiff({ compression: 'none' })
    .toBuffer();
}
