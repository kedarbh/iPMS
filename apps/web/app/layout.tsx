import type { Metadata } from 'next';
import './styles.css';
import './system.css';
import { ToastProvider } from './components/toast';

export const metadata: Metadata = {
  title: 'Axiom | Project delivery',
  description: 'Integrated project management and quality operations.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><ToastProvider>{children}</ToastProvider></body>
    </html>
  );
}
