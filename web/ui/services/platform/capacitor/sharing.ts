import { Share } from '@capacitor/share';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { PlatformServices } from '../contracts';

export const nativeSharing: PlatformServices['sharing'] = {
  async share(url, title) {
    await Share.share({ url, title });
    return 'shared';
  },
  async download(contents, filename) {
    // The native share sheet lets the user choose Files or another application.
    const path = filename.replace(/[^\w.-]/g, '_');
    const file = await Filesystem.writeFile({
      path,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
      data: contents,
    });
    try {
      await Share.share({ files: [file.uri] });
    } finally {
      await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => {});
    }
  },
};
