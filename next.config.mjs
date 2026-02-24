/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      { source: '/', destination: '/index.html' },
      { source: '/login', destination: '/index.html' },
      { source: '/welcome', destination: '/welcome.html' },
      { source: '/agent', destination: '/agent.html' },
      { source: '/admin-sellers', destination: '/admin-sellers.html' },
      { source: '/whatsapp-qr', destination: '/whatsapp-qr.html' },
      { source: '/setup-admin', destination: '/setup-admin.html' },
    ];
  },
  async redirects() {
    return [
      { source: '/index.html', destination: '/', permanent: false },
      { source: '/welcome.html', destination: '/welcome', permanent: true },
      { source: '/agent.html', destination: '/agent', permanent: true },
      { source: '/admin-sellers.html', destination: '/admin-sellers', permanent: true },
      { source: '/whatsapp-qr.html', destination: '/whatsapp-qr', permanent: true },
      { source: '/setup-admin.html', destination: '/setup-admin', permanent: true },
    ];
  },
};

export default nextConfig;
