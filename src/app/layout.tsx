import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import Navbar from '@/components/Navbar';
import { Toaster } from 'sonner';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Farmacia Oncológica — Pedidos y Consumo',
  description: 'Optimizador de compras y seguimiento de consumo — Hospital de Manacor',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Navbar />
        <main className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 py-6">
          {children}
        </main>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
