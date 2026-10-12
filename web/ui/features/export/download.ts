import { platform } from '../../services/platform';

export function downloadFile(contents: string, filename: string, type: string) {
  return platform().sharing.download(contents, filename, type);
}
