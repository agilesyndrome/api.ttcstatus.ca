import type { ReactNode } from 'react';
import { Nav, type NavProps } from '../components/nav/Nav';

export interface AppTemplateProps {
  /** The destination highlighted in the shared app navigation. */
  current?: NavProps['current'];
  children: ReactNode;
}

/** The common page shell for URL shortcuts into the application. */
export function AppTemplate({ current, children }: AppTemplateProps) {
  return (
    <Nav variant="page" current={current}>
      {children}
    </Nav>
  );
}
