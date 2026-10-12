import type { PlatformServices } from '../contracts';

export const browserSharing: PlatformServices['sharing'] = {
  async share(url, title) {
    if (navigator.share) {
      await navigator.share({ url, title });
      return 'shared';
    }
    await navigator.clipboard.writeText(url);
    return 'copied';
  },
  async download(contents, filename, type) {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
