import { Metadata } from 'next';
import { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Connect Channel',
};

export default async function ConnectLinkLayout({
  children,
}: {
  children: ReactNode;
}) {
  // The fork's light surface: the consent page can be taller than a small
  // window, and w-screen then adds a horizontal scrollbar next to the vertical
  // one.
  return (
    <div className="light bg-primary flex flex-1 min-h-screen w-full text-textColor">
      {children}
    </div>
  );
}
