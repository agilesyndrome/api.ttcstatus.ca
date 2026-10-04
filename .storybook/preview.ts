import type { Preview } from '@storybook/react-vite';
import '../web/ui/styles/main.css';
const preview: Preview = {
  parameters: { layout: 'fullscreen', controls: { expanded: true } },
};
export default preview;
